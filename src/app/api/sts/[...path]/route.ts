import { NextResponse } from "next/server";

import { getStsApiUrlCandidates } from "@/shared/api/stsLogin";
import { resolveStsBearerFromRequest } from "@/shared/server/stsAuthBearer";
import { fetchWithBaseUrlFallback } from "@/shared/server/stsUpstreamFetch";

function upstreamFetchErrorMessage(err: unknown): string {
  const e = err as { cause?: { code?: string; message?: string }; message?: string };
  const code = e?.cause?.code;
  const msg = e?.cause?.message ?? e?.message ?? String(err);
  if (code === "EHOSTUNREACH" || /EHOSTUNREACH/i.test(msg)) {
    return "Cannot reach API server (host unreachable). Check NEXT_PUBLIC_STS_API_BASE_URLS (or NEXT_PUBLIC_STS_API_BASE_URL), VPN, and that the STSPortal host is on the same network.";
  }
  if (code === "ECONNREFUSED" || /ECONNREFUSED/i.test(msg)) {
    return "Connection refused by API server. Is STSPortal running and the port correct?";
  }
  if (code === "ETIMEDOUT" || /ETIMEDOUT/i.test(msg)) {
    return "API request timed out. Check network and firewall.";
  }
  return `Upstream request failed: ${msg}`;
}

export async function GET(
  req: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  if (!path?.length) {
    return NextResponse.json(
      { success: false, message: "Missing path." },
      { status: 400 },
    );
  }

  const upstreamPath = `/api/${path.join("/")}`;
  const upstreamCandidates = getStsApiUrlCandidates(upstreamPath);
  if (!upstreamCandidates.length) {
    return NextResponse.json(
      {
        success: false,
        message:
          "Missing env NEXT_PUBLIC_STS_API_BASE_URLS (or NEXT_PUBLIC_STS_API_BASE_URL).",
      },
      { status: 500 },
    );
  }

  const search = new URL(req.url).search;
  const upstreamUrls = upstreamCandidates.map((base) => `${base}${search}`);

  const auth = await resolveStsBearerFromRequest(req);
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json(
      { success: false, message: "Authorization required." },
      { status: 401 },
    );
  }

  let upstreamRes: Response;
  try {
    const result = await fetchWithBaseUrlFallback(upstreamUrls, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: auth,
      },
    });
    upstreamRes = result.response;
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        message: upstreamFetchErrorMessage(err),
        upstreamUrl: upstreamUrls[0],
      },
      { status: 502 },
    );
  }

  const text = await upstreamRes.text();
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid upstream JSON." },
      { status: 502 },
    );
  }

  return NextResponse.json(data, { status: upstreamRes.status });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  if (!path?.length) {
    return NextResponse.json(
      { success: false, message: "Missing path." },
      { status: 400 },
    );
  }

  const upstreamUrls = getStsApiUrlCandidates(`/api/${path.join("/")}`);
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

  const auth = await resolveStsBearerFromRequest(req);
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json(
      { success: false, message: "Authorization required." },
      { status: 401 },
    );
  }

  const contentType = req.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const body = isJson ? await req.text() : await req.formData();

  let upstreamRes: Response;
  try {
    const result = await fetchWithBaseUrlFallback(upstreamUrls, {
      method: "POST",
      headers: isJson
        ? {
            Authorization: auth,
            "Content-Type": "application/json",
          }
        : {
            Authorization: auth,
          },
      body,
    });
    upstreamRes = result.response;
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        message: upstreamFetchErrorMessage(err),
        upstreamUrl: upstreamUrls[0],
      },
      { status: 502 },
    );
  }

  const text = await upstreamRes.text();
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid upstream JSON." },
      { status: 502 },
    );
  }

  return NextResponse.json(data, { status: upstreamRes.status });
}
