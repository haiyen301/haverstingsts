import { NextResponse } from "next/server";

import { getStsApiUrlCandidates, STS_LOGIN_PATHS } from "@/shared/api/stsLogin";
import {
  fetchJsonWithBaseUrlFallback,
} from "@/shared/server/stsUpstreamFetch";

export async function POST(req: Request) {
  const upstreamUrls = getStsApiUrlCandidates(STS_LOGIN_PATHS.forgetPassword);
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

  const data = upstream.data;
  const upstreamRes = upstream.response;

  return NextResponse.json(data, { status: upstreamRes.status });
}
