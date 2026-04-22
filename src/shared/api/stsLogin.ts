/**
 * Đường dẫn API auth trên STSPortal (upstream). Dùng với `getStsApiUrl()` trong Route Handlers.
 */
export const STS_LOGIN_PATHS = {
  login: "/api/authentication/login",
  register: "/api/authentication/register",
  /** Khớp `Authentication::forget_password` trên STSPortal. */
  forgetPassword: "/api/authentication/forget_password",
  /** Khớp `Authentication::verify_reset_code` trên STSPortal. */
  verifyResetCode: "/api/authentication/verify_reset_code",
  /** Khớp `Authentication::reset_password` trên STSPortal. */
  resetPassword: "/api/authentication/reset_password",
} as const;

/** Route Next.js proxy quên mật khẩu (folder `forget-password`), khác segment upstream `forgetPassword`. */
const INTERNAL_FORGET_PASSWORD_PATH = "/api/authentication/forget-password" as const;

/** Route Next.js proxy đặt lại mật khẩu (folder `reset-password`). */
const INTERNAL_RESET_PASSWORD_PATH = "/api/authentication/reset-password" as const;
/** Route Next.js proxy kiểm tra mã reset. */
const INTERNAL_VERIFY_RESET_CODE_PATH = "/api/authentication/verify-reset-code" as const;

const INTERNAL_SESSION_PATH = "/api/authentication/session" as const;
const INTERNAL_LOGOUT_PATH = "/api/authentication/logout" as const;

/**
 * Route nội bộ Next.js (browser `fetch`). Lấy từ `STS_LOGIN_PATHS`, chỉ thay đường dẫn forgot-password.
 */
export const INTERNAL_API = {
  authentication: {
    ...STS_LOGIN_PATHS,
    forgetPassword: INTERNAL_FORGET_PASSWORD_PATH,
    verifyResetCode: INTERNAL_VERIFY_RESET_CODE_PATH,
    resetPassword: INTERNAL_RESET_PASSWORD_PATH,
    session: INTERNAL_SESSION_PATH,
    logout: INTERNAL_LOGOUT_PATH,
  },
} as const;

const STS_API_BASE_URLS_ENV_KEY = "NEXT_PUBLIC_STS_API_BASE_URLS";

/**
 * Public URL of the stsrenew app (no trailing slash). Sent to STSPortal as `frontend_base_url`
 * so reset-password emails link to `/login/reset-password` on this host instead of the API IP.
 * Example: `http://192.168.0.50:3000` or `https://renew.example.com`
 */
export function getStsRenewFrontendBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_STS_RENEW_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}`.replace(/\/$/, "");
  return "";
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/$/, "");
}

/**
 * Parse all configured STS API base URLs.
 * Priority:
 * 1) `NEXT_PUBLIC_STS_API_BASE_URLS` (comma/newline/space separated)
 * 2) `NEXT_PUBLIC_STS_API_BASE_URL` (single fallback)
 */
export function getStsApiBaseUrls(): string[] {
  const listRaw = process.env[STS_API_BASE_URLS_ENV_KEY] ?? "";
  const primary = process.env.NEXT_PUBLIC_STS_API_BASE_URL ?? "";

  const parsed = listRaw
    .split(/[\s,]+/)
    .map(normalizeBaseUrl)
    .filter(Boolean);

  const merged = [...parsed, normalizeBaseUrl(primary)].filter(Boolean);
  return Array.from(new Set(merged));
}

export function getStsApiBaseUrl() {
  return getStsApiBaseUrls()[0] ?? "";
}

/**
 * Site root without trailing `/api` — derived from `NEXT_PUBLIC_STS_API_BASE_URL`.
 * For **public file URLs** (images under `/files/...`), prefer `getStsDomainUrl()` in
 * `@/shared/config/stsUrls` (supports `NEXT_PUBLIC_STS_DOMAIN_URL` = Flutter `domainUrl`).
 */
export function getStsSiteRootUrl(): string {
  const base = getStsApiBaseUrl().replace(/\/$/, "");
  if (!base) return "";
  return base.replace(/\/api$/, "");
}

/** Build absolute URL to STSPortal (e.g. `/api/base/...`). Empty if base URL missing. */
export function getStsApiUrl(path: string) {
  const baseUrl = getStsApiBaseUrl();
  if (!baseUrl) return "";
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${p}`;
}

/** Build all API URL candidates from configured base URLs. */
export function getStsApiUrlCandidates(path: string): string[] {
  const bases = getStsApiBaseUrls();
  if (!bases.length) return [];
  const p = path.startsWith("/") ? path : `/${path}`;
  return bases.map((baseUrl) => `${baseUrl}${p}`);
}

/** Full upstream URL for STSPortal login (empty if base URL is not configured). */
export function getStsLoginUrl() {
  return getStsApiUrl(STS_LOGIN_PATHS.login);
}
