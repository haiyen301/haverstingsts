import { NextResponse } from "next/server";

import { getStsApiUrl, STS_LOGIN_PATHS } from "@/shared/api/stsLogin";
import { AUTH_COOKIE_NAME } from "@/shared/lib/authCookie";
import { AUTH_COOKIE_OPTIONS } from "@/shared/server/stsAuthBearer";

function stripTokenFromRegisterJson(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const o = data as Record<string, unknown>;
  if (typeof o.token === "string") {
    const next = { ...o };
    delete next.token;
    return next;
  }
  if (!o.data || typeof o.data !== "object") return data;
  const inner = { ...(o.data as Record<string, unknown>) };
  delete inner.token;
  return { ...o, data: inner };
}

function extractRegisterToken(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const o = raw as Record<string, unknown>;
  if (typeof o.token === "string" && o.token.trim()) return o.token.trim();
  const d = o.data;
  if (d && typeof d === "object" && "token" in d) {
    const t = (d as { token?: unknown }).token;
    if (typeof t === "string" && t.trim()) return t.trim();
  }
  return "";
}

type Body = {
  first_name?: string;
  last_name?: string;
  account_type?: string;
  email?: string;
  password?: string;
  company_name?: string;
};

export async function POST(req: Request) {
  const upstreamUrl = getStsApiUrl(STS_LOGIN_PATHS.register);
  if (!upstreamUrl) {
    return NextResponse.json(
      {
        success: false,
        message: "Missing env NEXT_PUBLIC_STS_API_BASE_URL.",
      },
      { status: 500 },
    );
  }

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const first_name = body.first_name?.trim() ?? "";
  const last_name = body.last_name?.trim() ?? "";
  const account_type = body.account_type?.trim() ?? "";
  const email = body.email?.trim() ?? "";
  const password = body.password ?? "";
  const company_name = body.company_name?.trim() ?? "";

  if (!first_name || !last_name || !account_type || !email || !password) {
    return NextResponse.json(
      {
        success: false,
        message: "first_name, last_name, account_type, email, password are required.",
      },
      { status: 400 },
    );
  }

  const form = new URLSearchParams();
  form.append("first_name", first_name);
  form.append("last_name", last_name);
  form.append("account_type", account_type);
  form.append("email", email);
  form.append("password", password);
  if (company_name) form.append("company_name", company_name);

  const upstreamRes = await fetch(upstreamUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: form.toString(),
  });

  const data = await upstreamRes
    .json()
    .catch(async () => ({ success: false, message: "Invalid upstream JSON." }));

  const token = extractRegisterToken(data);
  if (
    upstreamRes.ok &&
    data &&
    typeof data === "object" &&
    (data as { success?: boolean }).success === true &&
    token
  ) {
    const res = NextResponse.json(stripTokenFromRegisterJson(data), {
      status: upstreamRes.status,
    });
    res.cookies.set(AUTH_COOKIE_NAME, token, AUTH_COOKIE_OPTIONS);
    return res;
  }

  return NextResponse.json(data, { status: upstreamRes.status });
}
