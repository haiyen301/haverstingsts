export type FetchJsonDebug = {
  requestUrl: string;
  pageOrigin: string;
  status: number;
  statusText: string;
  contentType: string;
  looksLikeHtml: boolean;
  bodyPreview: string;
  bodyLength: number;
  /** Parsed JSON error payload from Next proxy (upstream debug). */
  upstream?: Record<string, unknown>;
};

export type FetchJsonResult<T> =
  | { ok: true; data: T; status: number; debug: FetchJsonDebug }
  | { ok: false; error: string; status: number; debug: FetchJsonDebug };

function looksLikeHtmlBody(text: string): boolean {
  const head = text.trimStart().slice(0, 64).toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html");
}

export function resolveSameOriginApiUrl(path: string): string {
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).href;
}

function buildFetchJsonDebug(
  res: Response,
  requestUrl: string,
  text: string,
  upstream?: Record<string, unknown>,
): FetchJsonDebug {
  return {
    requestUrl,
    pageOrigin: typeof window !== "undefined" ? window.location.origin : "",
    status: res.status,
    statusText: res.statusText,
    contentType: res.headers.get("content-type") ?? "",
    looksLikeHtml: looksLikeHtmlBody(text),
    bodyPreview: text.slice(0, 800),
    bodyLength: text.length,
    upstream,
  };
}

function upstreamDebugFromJson(data: unknown): Record<string, unknown> | undefined {
  if (!data || typeof data !== "object") return undefined;
  const o = data as Record<string, unknown>;
  const keys = [
    "upstreamUrl",
    "upstreamStatus",
    "upstreamContentType",
    "upstreamBodyPreview",
    "upstreamBodyLines",
    "upstreamRawText",
    "message",
  ] as const;
  const out: Record<string, unknown> = {};
  let has = false;
  for (const k of keys) {
    if (o[k] !== undefined) {
      out[k] = o[k];
      has = true;
    }
  }
  return has ? out : undefined;
}

function errorMessageForNonJson(
  status: number,
  contentType: string,
  looksLikeHtml: boolean,
): string {
  if (looksLikeHtml || contentType.includes("text/html")) {
    if (status === 404) {
      return (
        "Login API route not found (404). Port/host may not be stsrenew Next.js — " +
        "run `npm run dev` in stsrenew and open that URL (not STSPortal PHP)."
      );
    }
    return (
      "Server returned HTML instead of JSON. Check NEXT_PUBLIC_STS_API_BASE_URLS " +
      "and that STSPortal is reachable from the Next.js server."
    );
  }
  return `Invalid server response (HTTP ${status}).`;
}

/**
 * Parse a fetch `Response` as JSON; return debug details when the body is HTML or invalid JSON.
 */
export async function readFetchJson<T = unknown>(
  res: Response,
  requestUrl: string,
): Promise<FetchJsonResult<T>> {
  const status = res.status;
  const text = await res.text();
  const looksLikeHtml = looksLikeHtmlBody(text);

  try {
    const data = JSON.parse(text) as T;
    const upstream = upstreamDebugFromJson(data);
    return {
      ok: true,
      data,
      status,
      debug: buildFetchJsonDebug(res, requestUrl, text, upstream),
    };
  } catch {
    return {
      ok: false,
      status,
      error: errorMessageForNonJson(
        status,
        res.headers.get("content-type") ?? "",
        looksLikeHtml,
      ),
      debug: buildFetchJsonDebug(res, requestUrl, text),
    };
  }
}

/** Lightweight GET probe — logs and returns debug info (e.g. session route on login page). */
export async function probeApiRoute(path: string): Promise<FetchJsonDebug> {
  const requestUrl = resolveSameOriginApiUrl(path);
  const res = await fetch(path, { credentials: "same-origin", cache: "no-store" });
  const text = await res.text();
  let upstream: Record<string, unknown> | undefined;
  try {
    upstream = upstreamDebugFromJson(JSON.parse(text) as unknown);
  } catch {
    /* non-json */
  }
  const debug = buildFetchJsonDebug(res, requestUrl, text, upstream);
  if (process.env.NODE_ENV === "development") {
    console.info(`[api-probe] ${path}`, debug);
  }
  return debug;
}
