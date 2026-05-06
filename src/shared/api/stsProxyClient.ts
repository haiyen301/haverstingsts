/** Same-origin fetch: HttpOnly `sts_token` cookie is sent automatically. */
const SAME_ORIGIN: RequestCredentials = "same-origin";

/** Detect server-side auth failure (invalid/expired token, etc.). */
function isStsUnauthorizedResponse(
  message: string | undefined,
  httpStatus: number,
): boolean {
  if (httpStatus === 401) return true;
  const m = (message ?? "").toLowerCase();
  return (
    m.includes("unauthorized") ||
    m.includes("token is missing") ||
    m.includes("invalid token") ||
    (m.includes("invalid") && m.includes("token"))
  );
}

/**
 * Clears session and sends user to login (`/`). Dynamic import avoids a static
 * cycle: authUserStore → harvestingDataStore → this module.
 */
async function redirectToLoginIfUnauthorized(
  message: string | undefined,
  httpStatus: number,
): Promise<void> {
  if (typeof window === "undefined") return;
  if (!isStsUnauthorizedResponse(message, httpStatus)) return;
  const { clearAuthSession } = await import("@/shared/store/authUserStore");
  await clearAuthSession();
  window.location.assign("/");
}

type StsJsonResponse<T = unknown> = {
  success?: boolean;
  data?: T;
  message?: string;
};

async function assertStsSuccessOrThrow<T>(
  json: StsJsonResponse<T>,
  res: Response,
): Promise<void> {
  if (json?.success) return;
  const message = json?.message ?? `Request failed (${res.status})`;
  await redirectToLoginIfUnauthorized(json?.message, res.status);
  throw new Error(message);
}

/**
 * Next.js route `/api/[...path]` forwards to STSPortal `/api/...` using the session JWT cookie.
 */
export function getInternalStsProxyUrl(upstreamApiPath: string): string {
  const trimmed = upstreamApiPath.replace(/^\/api\/?/, "");
  return `/api/${trimmed}`;
}

/** Same-origin URL for proxy GET with upstream query string (e.g. `page`, `search`). */
export function buildStsProxyGetUrl(
  upstreamApiPath: string,
  searchParams?: Record<string, string | number | undefined>,
): string {
  const base = getInternalStsProxyUrl(upstreamApiPath);
  if (!searchParams) return base;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (v !== undefined && v !== "") sp.set(k, String(v));
  }
  const q = sp.toString();
  return q ? `${base}?${q}` : base;
}

/**
 * GET returning the full JSON object after `success` is true (e.g. endpoints that add
 * keys besides `data`, such as `unscheduled` on `/api/timeline`).
 */
export async function stsProxyGetFullJson(
  /** Full path including query, e.g. `/api/timeline?from=…&to=…`. */
  pathWithOptionalQuery: string,
): Promise<Record<string, unknown>> {
  if (typeof window === "undefined") {
    throw new Error("stsProxyGetFullJson is client-only");
  }
  const url = pathWithOptionalQuery.startsWith("/api/")
    ? pathWithOptionalQuery
    : getInternalStsProxyUrl(pathWithOptionalQuery);
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    credentials: SAME_ORIGIN,
  });
  let json: StsJsonResponse;
  try {
    json = (await res.json()) as StsJsonResponse;
  } catch {
    throw new Error("Invalid JSON response");
  }
  await assertStsSuccessOrThrow(json, res);
  return json as Record<string, unknown>;
}

/** GET via same-origin proxy; requires HttpOnly session cookie from login. */
export async function stsProxyGet<T = unknown>(upstreamApiPath: string): Promise<T> {
  if (typeof window === "undefined") {
    throw new Error("stsProxyGet is client-only");
  }
  const url = getInternalStsProxyUrl(upstreamApiPath);
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    credentials: SAME_ORIGIN,
  });
  let json: StsJsonResponse<T>;
  try {
    json = (await res.json()) as StsJsonResponse<T>;
  } catch {
    throw new Error("Invalid JSON response");
  }
  await assertStsSuccessOrThrow(json, res);
  return json.data as T;
}

type HarvestingIndexJson = {
  success?: boolean;
  data?: unknown;
  message?: string;
  total_m2?: string;
  total_kg?: string;
  /** Last page number (PHP `ceil(total / per_page)`). */
  total?: number;
  /** Row count matching filters (PHP `get_total_by_params`). */
  total_records?: number;
};

/**
 * GET harvesting list (`Harvesting::index`): full JSON (rows + totals + pagination meta).
 * `stsProxyGet` only returns `data`; this keeps `total_m2`, `total_kg`, `total` (pages), `total_records`.
 */
export async function stsProxyGetHarvestingIndex(
  searchParams?: Record<string, string | number | undefined>,
): Promise<{
  rows: unknown[];
  totalPages: number;
  totalM2: string;
  totalKg: string;
  /** Row count from API; `null` if upstream omits `total_records` (legacy). */
  totalRecords: number | null;
  message?: string;
}> {
  if (typeof window === "undefined") {
    throw new Error("stsProxyGetHarvestingIndex is client-only");
  }
  const url = buildStsProxyGetUrl("/api/harvesting", searchParams);
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    credentials: SAME_ORIGIN,
  });
  let json: HarvestingIndexJson;
  try {
    json = (await res.json()) as HarvestingIndexJson;
  } catch {
    throw new Error("Invalid JSON response");
  }
  await assertStsSuccessOrThrow(json, res);
  const rows = Array.isArray(json.data) ? json.data : [];
  const totalPages = Math.max(1, Number(json.total) || 1);
  const hasTotalRecords =
    Object.prototype.hasOwnProperty.call(json, "total_records") &&
    json.total_records != null;
  const tr = Number(json.total_records);
  const totalRecords: number | null =
    hasTotalRecords && Number.isFinite(tr) && tr >= 0 ? Math.floor(tr) : null;
  return {
    rows,
    totalPages,
    totalM2: String(json.total_m2 ?? "0"),
    totalKg: String(json.total_kg ?? "0"),
    totalRecords,
    message: json.message,
  };
}

/**
 * POST multipart/form-data via same-origin proxy (e.g. harvesting save + images).
 * Do not set Content-Type manually — browser sets boundary for FormData.
 */
export async function stsProxyPostFormData<T = unknown>(
  upstreamApiPath: string,
  formData: FormData,
): Promise<T> {
  if (typeof window === "undefined") {
    throw new Error("stsProxyPostFormData is client-only");
  }
  const url = getInternalStsProxyUrl(upstreamApiPath);
  const res = await fetch(url, {
    method: "POST",
    credentials: SAME_ORIGIN,
    body: formData,
  });
  let json: StsJsonResponse<T>;
  try {
    json = (await res.json()) as StsJsonResponse<T>;
  } catch {
    throw new Error("Invalid JSON response");
  }
  await assertStsSuccessOrThrow(json, res);
  return json.data as T;
}

/** POST JSON via same-origin proxy (for endpoints expecting raw JSON body). */
export async function stsProxyPostJson<T = unknown>(
  upstreamApiPath: string,
  payload: unknown,
): Promise<T> {
  if (typeof window === "undefined") {
    throw new Error("stsProxyPostJson is client-only");
  }
  const url = getInternalStsProxyUrl(upstreamApiPath);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: SAME_ORIGIN,
    body: JSON.stringify(payload),
  });
  let json: StsJsonResponse<T>;
  try {
    json = (await res.json()) as StsJsonResponse<T>;
  } catch {
    throw new Error("Invalid JSON response");
  }
  await assertStsSuccessOrThrow(json, res);
  return json.data as T;
}
