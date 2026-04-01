import { NextResponse } from "next/server";

type LoginRequestBody = {
  email?: string;
  password?: string;
};

import { getStsLoginUrl } from "@/shared/api/stsLogin";

export async function POST(req: Request) {
  const upstreamUrl = getStsLoginUrl();
  if (!upstreamUrl) {
    return NextResponse.json(
      {
        success: false,
        message: "Missing env NEXT_PUBLIC_STS_API_BASE_URL.",
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

  const upstreamRes = await fetch(upstreamUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: form.toString(),
  });

  // Try to pass through JSON payload
  const data = await upstreamRes
    .json()
    .catch(async () => ({ success: false, message: "Invalid upstream JSON." }));

  return NextResponse.json(data, { status: upstreamRes.status });
}

