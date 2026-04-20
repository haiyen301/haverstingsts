import { NextResponse } from "next/server";

import { getStsApiUrlCandidates, STS_LOGIN_PATHS } from "@/shared/api/stsLogin";
import { fetchJsonWithBaseUrlFallback } from "@/shared/server/stsUpstreamFetch";

export async function POST(req: Request) {
  const upstreamUrls = getStsApiUrlCandidates(STS_LOGIN_PATHS.resetPassword);
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

  let body: { key?: string; password?: string } = {};
  try {
    body = (await req.json()) as { key?: string; password?: string };
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const key = body.key?.trim() ?? "";
  const password = body.password ?? "";
  if (!key || !password) {
    return NextResponse.json(
      { success: false, message: "Key and password are required." },
      { status: 400 },
    );
  }

  const form = new URLSearchParams();
  form.append("key", key);
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

  const data = upstream.data;
  const upstreamRes = upstream.response;

  return NextResponse.json(data, { status: upstreamRes.status });
}
