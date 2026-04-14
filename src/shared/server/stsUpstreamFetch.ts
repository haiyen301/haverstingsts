type FetchWithFallbackResult = {
  response: Response;
  upstreamUrl: string;
};

type UpstreamNetworkError = {
  cause?: { code?: string; message?: string };
  message?: string;
};

function isRetryableUpstreamError(err: unknown): boolean {
  const e = err as UpstreamNetworkError;
  const code = e?.cause?.code;
  const msg = e?.cause?.message ?? e?.message ?? String(err);
  if (!msg) return false;
  if (code === "EHOSTUNREACH" || /EHOSTUNREACH/i.test(msg)) return true;
  if (code === "ECONNREFUSED" || /ECONNREFUSED/i.test(msg)) return true;
  if (code === "ETIMEDOUT" || /ETIMEDOUT/i.test(msg)) return true;
  return false;
}

export function upstreamFetchErrorMessage(err: unknown): string {
  const e = err as UpstreamNetworkError;
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

export async function parseUpstreamJsonOrError(
  upstreamRes: Response,
): Promise<{ ok: true; data: unknown } | { ok: false; payload: Record<string, unknown> }> {
  const rawBody = await upstreamRes.text();
  try {
    return { ok: true, data: JSON.parse(rawBody) as unknown };
  } catch {
    const contentType = upstreamRes.headers.get("content-type") ?? "";
    const payload: Record<string, unknown> = {
      success: false,
      message: "Invalid upstream JSON.",
      upstreamStatus: upstreamRes.status,
    };

    if (process.env.NODE_ENV === "development") {
      payload.upstreamContentType = contentType;
      payload.upstreamBodyPreview = rawBody.slice(0, 4000);
    }
    return { ok: false, payload };
  }
}

type FetchJsonFallbackSuccess = {
  ok: true;
  response: Response;
  data: unknown;
  upstreamUrl: string;
};

type FetchJsonFallbackError = {
  ok: false;
  status: number;
  payload: Record<string, unknown>;
};

export async function fetchJsonWithBaseUrlFallback(
  upstreamUrls: string[],
  init: RequestInit,
): Promise<FetchJsonFallbackSuccess | FetchJsonFallbackError> {
  if (!upstreamUrls.length) {
    return {
      ok: false,
      status: 500,
      payload: { success: false, message: "No upstream URLs configured." },
    };
  }

  let lastNetworkError: unknown;
  let lastInvalidJson:
    | {
        upstreamUrl: string;
        upstreamStatus: number;
        upstreamContentType: string;
        upstreamBodyPreview: string;
      }
    | undefined;

  for (const upstreamUrl of upstreamUrls) {
    let res: Response;
    try {
      res = await fetch(upstreamUrl, init);
    } catch (err) {
      lastNetworkError = err;
      if (!isRetryableUpstreamError(err)) {
        return {
          ok: false,
          status: 502,
          payload: {
            success: false,
            message: upstreamFetchErrorMessage(err),
            upstreamUrl,
          },
        };
      }
      continue;
    }

    const rawBody = await res.text();
    try {
      const data = JSON.parse(rawBody) as unknown;
      return { ok: true, response: res, data, upstreamUrl };
    } catch {
      lastInvalidJson = {
        upstreamUrl,
        upstreamStatus: res.status,
        upstreamContentType: res.headers.get("content-type") ?? "",
        upstreamBodyPreview: rawBody.slice(0, 4000),
      };
      // Continue trying next base URL when upstream body is non-JSON.
      continue;
    }
  }

  if (lastInvalidJson) {
    const payload: Record<string, unknown> = {
      success: false,
      message: "Invalid upstream JSON.",
      upstreamStatus: lastInvalidJson.upstreamStatus,
      upstreamUrl: lastInvalidJson.upstreamUrl,
    };
    if (process.env.NODE_ENV === "development") {
      payload.upstreamContentType = lastInvalidJson.upstreamContentType;
      payload.upstreamBodyPreview = lastInvalidJson.upstreamBodyPreview;
    }
    return { ok: false, status: 502, payload };
  }

  return {
    ok: false,
    status: 502,
    payload: {
      success: false,
      message: upstreamFetchErrorMessage(lastNetworkError),
      upstreamUrl: upstreamUrls[0],
    },
  };
}

export async function fetchWithBaseUrlFallback(
  upstreamUrls: string[],
  init: RequestInit,
): Promise<FetchWithFallbackResult> {
  if (!upstreamUrls.length) {
    throw new Error("No upstream URLs configured.");
  }

  let lastError: unknown;
  for (const upstreamUrl of upstreamUrls) {
    try {
      const response = await fetch(upstreamUrl, init);
      return { response, upstreamUrl };
    } catch (err) {
      lastError = err;
      if (!isRetryableUpstreamError(err)) {
        throw err;
      }
    }
  }

  throw lastError ?? new Error("All upstream URLs failed.");
}
