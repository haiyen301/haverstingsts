/**
 * Google OAuth export — user grants access, data is written to **their** Google Drive.
 *
 * ## Redirect URI domain (≠ API server)
 *
 * OAuth callback uses **`NEXT_PUBLIC_STS_RENEW_APP_URL`** — the public URL of this Next.js app
 * (browser + Google Console). STSPortal API stays on **`NEXT_PUBLIC_STS_API_BASE_URLS`**
 * (may be a private IP such as `http://192.168.0.159`).
 *
 * ```
 * {NEXT_PUBLIC_STS_RENEW_APP_URL}/api/projects/export/google-sheet/oauth/callback
 * ```
 *
 * **Local dev example**
 *
 * ```env
 * NEXT_PUBLIC_STS_API_BASE_URLS=http://192.168.0.159
 * NEXT_PUBLIC_STS_RENEW_APP_URL=http://localhost:3000
 * ```
 *
 * → Google redirect: `http://localhost:3000/api/projects/export/google-sheet/oauth/callback`
 *
 * **Staging / production** (same host for Next + API):
 *
 * ```env
 * NEXT_PUBLIC_STS_API_BASE_URLS=https://staging.sportsturfsolutions.com/stsportal
 * NEXT_PUBLIC_STS_RENEW_APP_URL=https://staging.sportsturfsolutions.com/stsportal
 * ```
 *
 * Fallback order: `NEXT_PUBLIC_STS_RENEW_APP_URL` → public `NEXT_PUBLIC_STS_API_BASE_URLS`
 * (skips private IPs) → request origin.
 *
 * ## Google Cloud Console
 *
 * Register **Authorized redirect URIs** matching {@link resolveGoogleSheetOAuthRedirectUri}
 * (from `NEXT_PUBLIC_STS_RENEW_APP_URL`, not the API IP).
 *
 * After consent → callback route → HttpOnly token cookie →
 * `/projects?googleSheetExport=resume`.
 */

import {
  getStsRenewFrontendBaseUrl,
  getStsSiteRootUrl,
} from "@/shared/api/stsLogin";

export type ProjectListGoogleSheetConfig = {
  clientId: string;
  clientSecret: string;
  /** Full callback URL registered in Google Cloud Console. */
  redirectUri: string;
  sheetTabName: string;
  enabled: boolean;
};

export const GOOGLE_SHEETS_EXPORT_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
] as const;

export const GOOGLE_SHEET_OAUTH_CALLBACK_PATH =
  "/api/projects/export/google-sheet/oauth/callback";

export const GOOGLE_SHEET_OAUTH_AUTHORIZE_PATH =
  "/api/projects/export/google-sheet/oauth/authorize";

export const GOOGLE_SHEET_EXPORT_RESUME_QUERY = "googleSheetExport";

export const GOOGLE_SHEET_EXPORT_RESUME_VALUE = "resume";

const DEFAULT_TAB_NAME = "Projects Export";

export function buildGoogleSheetOAuthRedirectUri(publicBaseUrl: string): string {
  const base = publicBaseUrl.replace(/\/$/, "");
  if (!base) return "";
  return `${base}${GOOGLE_SHEET_OAUTH_CALLBACK_PATH}`;
}

function isLikelyPrivateHost(baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl);
    const host = u.hostname;
    if (host === "localhost" || host === "127.0.0.1") return false;
    if (/^192\.168\./.test(host)) return true;
    if (/^10\./.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Public Next.js app base for OAuth — `NEXT_PUBLIC_STS_RENEW_APP_URL` first (not API IP).
 */
export function resolveGoogleSheetOAuthPublicBaseUrl(
  requestOrigin?: string,
): string {
  const fromRenewApp = getStsRenewFrontendBaseUrl();
  if (fromRenewApp) return fromRenewApp;

  const fromStsEnv = getStsSiteRootUrl();
  if (fromStsEnv && !isLikelyPrivateHost(fromStsEnv)) return fromStsEnv;

  return (requestOrigin ?? "").replace(/\/$/, "");
}

export function resolveGoogleSheetOAuthRedirectUri(
  requestOrigin?: string,
): string {
  const base = resolveGoogleSheetOAuthPublicBaseUrl(requestOrigin);
  return buildGoogleSheetOAuthRedirectUri(base);
}

export function getProjectListGoogleSheetConfig(
  requestOrigin?: string,
): ProjectListGoogleSheetConfig {
  const clientId = String(process.env.GOOGLE_OAUTH_CLIENT_ID ?? "").trim();
  const clientSecret = String(process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "").trim();
  const redirectUri = resolveGoogleSheetOAuthRedirectUri(requestOrigin);
  const sheetTabName =
    String(process.env.PROJECT_LIST_GOOGLE_SHEETS_TAB_NAME ?? "").trim() ||
    DEFAULT_TAB_NAME;
  const enabledFlag = String(
    process.env.PROJECT_LIST_GOOGLE_SHEETS_ENABLED ?? "true",
  )
    .trim()
    .toLowerCase();
  const enabled = enabledFlag !== "false" && enabledFlag !== "0";
  return {
    clientId,
    clientSecret,
    redirectUri,
    sheetTabName,
    enabled,
  };
}

export function isProjectListGoogleSheetOAuthConfigured(
  requestOrigin?: string,
): boolean {
  const config = getProjectListGoogleSheetConfig(requestOrigin);
  return (
    config.enabled &&
    Boolean(config.clientId && config.clientSecret && config.redirectUri)
  );
}
