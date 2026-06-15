import { NextResponse } from "next/server";

import {
  AUTH_ACL_COOKIE_NAME,
  AUTH_COOKIE_NAME,
  AUTH_USER_ID_COOKIE_NAME,
} from "@/shared/lib/authCookie";
import { getStsApiUrlCandidates, STS_LOGIN_PATHS } from "@/shared/api/stsLogin";
import { AUTH_COOKIE_OPTIONS } from "@/shared/server/stsAuthBearer";
import {
  parsePrivilegedAdminUserId,
  userIdIsPrivilegedAdmin,
} from "@/shared/auth/privilegedAdminAccess";
import { fetchMaintenanceStatusFromUpstream } from "@/shared/server/maintenanceUpstream";
import {
  fetchJsonWithBaseUrlFallback,
} from "@/shared/server/stsUpstreamFetch";

type LoginRequestBody = {
  email?: string;
  password?: string;
};

const TOUCH_LAST_ONLINE_PATH = "/api/base/react_touch_last_online";

function stripTokenFromLoginJson(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const o = data as Record<string, unknown>;
  if (!o.data || typeof o.data !== "object") return data;
  const inner = { ...(o.data as Record<string, unknown>) };
  delete inner.token;
  return { ...o, data: inner };
}

export async function POST(req: Request) {
  try {
  const upstreamUrls = getStsApiUrlCandidates(STS_LOGIN_PATHS.login);
  if (!upstreamUrls.length) {
    return NextResponse.json(
      {
        success: false,
        message:
          "Missing env NEXT_PUBLIC_STS_API_BASE_URLS (or NEXT_PUBLIC_STS_API_BASE_URL).",
      },
      { status: 500 },
    );
  }

  let body: LoginRequestBody = {};
  try {
    body = (await req.json()) as LoginRequestBody;
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const email = body.email?.trim();
  const password = body.password ?? "";

  if (!email || !password) {
    return NextResponse.json(
      { success: false, message: "Email and password are required." },
      { status: 400 },
    );
  }

  // STSPortal expects application/x-www-form-urlencoded (email, password)
  const form = new URLSearchParams();
  form.append("email", email);
  form.append("password", password);

  const upstream = await fetchJsonWithBaseUrlFallback(upstreamUrls, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: form.toString(),
  });
  if (!upstream.ok) {
    return NextResponse.json(upstream.payload, { status: upstream.status });
  }

  const upstreamRes = upstream.response;
  const data = upstream.data;

  const token =
    data &&
    typeof data === "object" &&
    "data" in data &&
    data.data &&
    typeof data.data === "object" &&
    "token" in (data.data as object)
      ? String((data.data as { token?: unknown }).token ?? "").trim()
      : "";

  if (
    upstreamRes.ok &&
    data &&
    typeof data === "object" &&
    (data as { success?: boolean }).success === true &&
    token
  ) {
    // Best-effort: update `sts_users.last_online` right after successful login.
    // Do not fail login flow if this side-effect endpoint is unavailable.
    try {
      const touchUrls = getStsApiUrlCandidates(TOUCH_LAST_ONLINE_PATH);
      if (touchUrls.length) {
        await fetchJsonWithBaseUrlFallback(touchUrls, {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
        });
      }
    } catch {
      // Swallow intentionally.
    }

    const profile = (data as { data?: unknown }).data;
    const profileObj =
      profile && typeof profile === "object"
        ? (profile as Record<string, unknown>)
        : null;
    const userId = parsePrivilegedAdminUserId(
      profileObj?.id ?? profileObj?.user_id ?? profileObj?.userId,
    );
    const maintenance = await fetchMaintenanceStatusFromUpstream();
    if (maintenance.enabled && !userIdIsPrivilegedAdmin(userId)) {
      return NextResponse.json(
        {
          success: false,
          message:
            "The application is under maintenance. Please try again later.",
        },
        { status: 503 },
      );
    }

    const res = NextResponse.json(stripTokenFromLoginJson(data), {
      status: upstreamRes.status,
    });
    res.cookies.set(AUTH_COOKIE_NAME, token, AUTH_COOKIE_OPTIONS);
    // ACL is not stored in cookies (avoids nginx header limits). Server guards use fetchTrustedAclByToken().
    res.cookies.delete(AUTH_ACL_COOKIE_NAME);
    if (userId != null) {
      res.cookies.set(AUTH_USER_ID_COOKIE_NAME, String(userId), AUTH_COOKIE_OPTIONS);
    }
    return res;
  }

  return NextResponse.json(data, { status: upstreamRes.status });
  } catch (err) {
    console.error("[api/authentication/login]", err);
    return NextResponse.json(
      {
        success: false,
        message:
          err instanceof Error ? err.message : "Login handler failed unexpectedly.",
      },
      { status: 500 },
    );
  }
}

