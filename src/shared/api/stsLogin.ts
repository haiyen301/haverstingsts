/**
 * Đường dẫn API auth trên STSPortal (upstream). Dùng với `getStsApiUrl()` trong Route Handlers.
 */
export const STS_LOGIN_PATHS = {
  login: "/api/authentication/login",
  register: "/api/authentication/register",
  /** Khớp `Authentication::forgetPassword` trên STSPortal. */
  forgetPassword: "/api/authentication/forgetPassword",
} as const;

/** Route Next.js proxy quên mật khẩu (folder `forget-password`), khác segment upstream `forgetPassword`. */
const INTERNAL_FORGET_PASSWORD_PATH = "/api/authentication/forget-password" as const;

/**
 * Route nội bộ Next.js (browser `fetch`). Lấy từ `STS_LOGIN_PATHS`, chỉ thay đường dẫn forgot-password.
 */
export const INTERNAL_API = {
  authentication: {
    ...STS_LOGIN_PATHS,
    forgetPassword: INTERNAL_FORGET_PASSWORD_PATH,
  },
} as const;

export function getStsApiBaseUrl() {
  return process.env.NEXT_PUBLIC_STS_API_BASE_URL ?? "";
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
  const baseUrl = getStsApiBaseUrl().replace(/\/$/, "");
  if (!baseUrl) return "";
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${p}`;
}

/** Full upstream URL for STSPortal login (empty if base URL is not configured). */
export function getStsLoginUrl() {
  const baseUrl = getStsApiBaseUrl();
  if (!baseUrl) return "";
  const path = STS_LOGIN_PATHS.login;
  return `${baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
}
