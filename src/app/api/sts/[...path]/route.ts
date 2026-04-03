import { NextResponse } from "next/server";

import { getStsApiUrl } from "@/shared/api/stsLogin";
import { resolveStsBearerFromRequest } from "@/shared/server/stsAuthBearer";

function upstreamFetchErrorMessage(err: unknown): string {
  const e = err as { cause?: { code?: string; message?: string }; message?: string };
  const code = e?.cause?.code;
  const msg = e?.cause?.message ?? e?.message ?? String(err);
  if (code === "EHOSTUNREACH" || /EHOSTUNREACH/i.test(msg)) {
    return "Cannot reach API server (host unreachable). Check NEXT_PUBLIC_STS_API_BASE_URL, VPN, and that the STSPortal host is on the same network.";
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
  const upstreamBase = getStsApiUrl(upstreamPath);
  if (!upstreamBase) {
    return NextResponse.json(
      {
        success: false,
        message: "Missing env NEXT_PUBLIC_STS_API_BASE_URL.",
      },
      { status: 500 },
    );
  }

  const search = new URL(req.url).search;
  const upstreamUrl = `${upstreamBase}${search}`;

  const auth = await resolveStsBearerFromRequest(req);
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json(
      { success: false, message: "Authorization required." },
      { status: 401 },
    );
  }

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: auth,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        message: upstreamFetchErrorMessage(err),
        upstreamUrl,
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

  const upstreamUrl = getStsApiUrl(`/api/${path.join("/")}`);
  if (!upstreamUrl) {
    return NextResponse.json(
      {
        success: false,
        message: "Missing env NEXT_PUBLIC_STS_API_BASE_URL.",
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
    upstreamRes = await fetch(upstreamUrl, {
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
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        message: upstreamFetchErrorMessage(err),
        upstreamUrl,
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
