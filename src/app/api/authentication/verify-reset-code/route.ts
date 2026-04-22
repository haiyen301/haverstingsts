import { NextResponse } from "next/server";

import { getStsApiUrlCandidates, STS_LOGIN_PATHS } from "@/shared/api/stsLogin";
import { fetchJsonWithBaseUrlFallback } from "@/shared/server/stsUpstreamFetch";

export async function POST(req: Request) {
  const upstreamUrls = getStsApiUrlCandidates(STS_LOGIN_PATHS.verifyResetCode);
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

  let body: { key?: string; email?: string } = {};
  try {
    body = (await req.json()) as { key?: string; email?: string };
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const key = body.key?.trim() ?? "";
  const email = body.email?.trim() ?? "";
  if (!key || !email) {
    return NextResponse.json(
      { success: false, message: "Key and email are required." },
      { status: 400 },
    );
  }

  const form = new URLSearchParams();
  form.append("key", key);
  form.append("email", email);

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

  return NextResponse.json(upstream.data, { status: upstream.response.status });
}
