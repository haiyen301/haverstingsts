import { NextResponse } from "next/server";

import { AUTH_COOKIE_NAME } from "@/shared/lib/authCookie";
import { getStsApiUrlCandidates, STS_LOGIN_PATHS } from "@/shared/api/stsLogin";
import { AUTH_COOKIE_OPTIONS } from "@/shared/server/stsAuthBearer";
import {
  fetchJsonWithBaseUrlFallback,
} from "@/shared/server/stsUpstreamFetch";

type LoginRequestBody = {
  email?: string;
  password?: string;
};

function stripTokenFromLoginJson(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const o = data as Record<string, unknown>;
  if (!o.data || typeof o.data !== "object") return data;
  const inner = { ...(o.data as Record<string, unknown>) };
  delete inner.token;
  return { ...o, data: inner };
}

export async function POST(req: Request) {
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
    const res = NextResponse.json(stripTokenFromLoginJson(data), {
      status: upstreamRes.status,
    });
    res.cookies.set(AUTH_COOKIE_NAME, token, AUTH_COOKIE_OPTIONS);
    return res;
  }

  return NextResponse.json(data, { status: upstreamRes.status });
}

