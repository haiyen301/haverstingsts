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

/** When upstream is not JSON (e.g. PHP var_dump, HTML error), help debug in dev. */
function invalidUpstreamJsonPayload(
  upstreamRes: Response,
  rawBody: string,
): Record<string, unknown> {
  const ct = upstreamRes.headers.get("content-type") ?? "";
  const looksLikePhpDump =
    /^\s*object\s*\(/i.test(rawBody) ||
    /^\s*array\s*\(/i.test(rawBody) ||
    /\b(?:var_dump|print_r)\s*\(/i.test(rawBody);

  let message = "Invalid upstream JSON.";
  if (looksLikePhpDump) {
    message =
      "Invalid upstream JSON: body looks like PHP var_dump/print_r. Remove debug output in STSPortal and return JSON via respond() only.";
  } else if (ct.includes("text/html")) {
    message =
      "Invalid upstream JSON: body is HTML (not JSON). Check PHP fatal errors or wrong route.";
  }

  const base: Record<string, unknown> = {
    success: false,
    message,
    upstreamStatus: upstreamRes.status,
  };
  if (process.env.NODE_ENV === "development") {
    base.upstreamContentType = ct;
    base.upstreamBodyPreview = rawBody.slice(0, 4000);
    /** One string per line — easier to read in DevTools than a single escaped \\n string. */
    base.upstreamBodyLines = rawBody
      .split(/\r?\n/)
      .slice(0, 150)
      .map((line) => line.slice(0, 600));
  }
  return base;
}

function tryParseScalarLikeBody(rawBody: string): unknown | undefined {
  const text = rawBody.trim();
  if (!text) return undefined;

  // First try regular JSON (object/array/scalar).
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Continue with tolerant scalar parsing.
  }

  const dumpString = text.match(/^string\(\d+\)\s*"([\s\S]*)"\s*$/i);
  if (dumpString) return dumpString[1];

  const dumpInt = text.match(/^int\(([-+]?\d+)\)\s*$/i);
  if (dumpInt) return Number(dumpInt[1]);

  const dumpFloat = text.match(
    /^float\(([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\)\s*$/i,
  );
  if (dumpFloat) return Number(dumpFloat[1]);

  const dumpBool = text.match(/^bool\((true|false)\)\s*$/i);
  if (dumpBool) return dumpBool[1].toLowerCase() === "true";

  if (/^null$/i.test(text)) return null;
  if (/^[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(text)) {
    return Number(text);
  }

  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  const parsed = tryParseScalarLikeBody(text);
  if (!isPlainObject(parsed)) {
    return NextResponse.json(
      {
        ...invalidUpstreamJsonPayload(upstreamRes, text),
        message:
          "Invalid upstream JSON: expected JSON object, got scalar/text. Keep raw text for debugging.",
        upstreamRawText: text.slice(0, 4000),
      },
      {
        status: 502,
      },
    );
  }
  data = parsed;
  if (!data) {
    return NextResponse.json(invalidUpstreamJsonPayload(upstreamRes, text), {
      status: 502,
    });
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
  const parsed = tryParseScalarLikeBody(text);
  if (!isPlainObject(parsed)) {
    return NextResponse.json(
      {
        ...invalidUpstreamJsonPayload(upstreamRes, text),
        message:
          "Invalid upstream JSON: expected JSON object, got scalar/text. Keep raw text for debugging.",
        upstreamRawText: text.slice(0, 4000),
      },
      {
        status: 502,
      },
    );
  }
  data = parsed;
  if (!data) {
    return NextResponse.json(invalidUpstreamJsonPayload(upstreamRes, text), {
      status: 502,
    });
  }

  return NextResponse.json(data, { status: upstreamRes.status });
}
