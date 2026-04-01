import { NextResponse } from "next/server";

import { getStsApiUrl, STS_LOGIN_PATHS } from "@/shared/api/stsLogin";

export async function POST(req: Request) {
  const upstreamUrl = getStsApiUrl(STS_LOGIN_PATHS.forgetPassword);
  if (!upstreamUrl) {
    return NextResponse.json(
      {
        success: false,
        message: "Missing env NEXT_PUBLIC_STS_API_BASE_URL.",
      },
      { status: 500 },
    );
  }

  let body: { email?: string } = {};
  try {
    body = (await req.json()) as { email?: string };
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const email = body.email?.trim() ?? "";
  if (!email) {
    return NextResponse.json(
      { success: false, message: "Email is required." },
      { status: 400 },
    );
  }

  const form = new URLSearchParams();
  form.append("email", email);

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

  return NextResponse.json(data, { status: upstreamRes.status });
}
