import { getStsApiBaseUrl, getStsApiUrl } from "@/shared/api/stsLogin";

/** Production STS Portal (Next) — https://stsportal.sportsturfsolutions.com/ */
export const STS_PORTAL_PRODUCTION_HOST = "stsportal.sportsturfsolutions.com";

/** Test / staging STS Portal — https://stsportal-test.sportsturfsolutions.com/ */
export const STS_PORTAL_TEST_HOST = "stsportal-test.sportsturfsolutions.com";

/** TestFlight public link for the iOS beta — shown on every portal host except production. */
export const IOS_TESTFLIGHT_TEST_URL =
  "https://testflight.apple.com/join/EusHpaf2";

/** TestFlight public link for the iOS app on production — https://stsportal.sportsturfsolutions.com/ */
export const IOS_TESTFLIGHT_PRODUCTION_URL =
  "https://testflight.apple.com/join/wky3RQAG";

const TEST_DEPLOY_ENV_VALUES = new Set(["test", "staging"]);

/**
 * `NEXT_PUBLIC_STS_API_BASE_URLS` when this Next.js deploy serves production APK (`*_production.apk`).
 */
export const STS_APK_PRODUCTION_API_BASE_URL =
  "https://staging.sportsturfsolutions.com/stsportal";

/**
 * `NEXT_PUBLIC_STS_API_BASE_URLS` when this Next.js deploy serves staging APK (`*_staging.apk`).
 */
export const STS_APK_STAGING_API_BASE_URL =
  "https://staging-test.sportsturfsolutions.com/stsportal";

export type AndroidApkDeployTier = "production" | "staging" | "dev";

function normalizeHostname(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (!trimmed) return "";
  const withoutPort = trimmed.split(":")[0] ?? trimmed;
  return withoutPort;
}

function normalizeApiBaseUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    let pathname = parsed.pathname.replace(/\/$/, "") || "";
    pathname = pathname.replace(/\/(signin|login)$/, "");
    return `${parsed.origin}${pathname}`.toLowerCase();
  } catch {
    return trimmed
      .toLowerCase()
      .replace(/\/$/, "")
      .replace(/\/(signin|login)$/, "");
  }
}

function apiBaseHostname(url: string): string {
  try {
    return new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** `NEXT_PUBLIC_STS_DEPLOY_ENV=test` on the test server (optional; hostname also works). */
export function isTestDeploymentFromEnv(): boolean {
  const raw = process.env.NEXT_PUBLIC_STS_DEPLOY_ENV?.trim().toLowerCase();
  return raw != null && TEST_DEPLOY_ENV_VALUES.has(raw);
}

export function isTestDeploymentHost(host: string): boolean {
  const hostname = normalizeHostname(host);
  if (!hostname) return false;
  if (hostname === STS_PORTAL_TEST_HOST) return true;
  return hostname.endsWith(`.${STS_PORTAL_TEST_HOST}`);
}

export function isProductionDeploymentHost(host: string): boolean {
  const hostname = normalizeHostname(host);
  if (!hostname) return false;
  if (hostname === STS_PORTAL_PRODUCTION_HOST) return true;
  return hostname.endsWith(`.${STS_PORTAL_PRODUCTION_HOST}`);
}

/** Show the red test-server banner when true. Production host never shows it unless env forces test (local QA). */
export function shouldShowTestServerBanner(host: string): boolean {
  if (isTestDeploymentFromEnv()) return true;
  if (isTestDeploymentHost(host)) return true;
  return false;
}

/**
 * Footer iOS TestFlight link.
 * Production → production beta; all other hosts (test, localhost, LAN) → test beta.
 */
export function getIosTestFlightUrlForHost(host: string): string {
  if (isProductionDeploymentHost(host)) {
    return IOS_TESTFLIGHT_PRODUCTION_URL;
  }
  return IOS_TESTFLIGHT_TEST_URL;
}

/**
 * APK tier from `NEXT_PUBLIC_STS_API_BASE_URLS` — used only for footer badge copy.
 * File discovery runs on STSPortal: GET /api/mobile_app/android_apk_download
 */
export function getAndroidApkDeployTierFromEnv(): AndroidApkDeployTier {
  const configured = getStsApiBaseUrl();
  if (!configured) return "dev";

  const normalized = normalizeApiBaseUrl(configured);
  const host = apiBaseHostname(configured);

  if (normalized === normalizeApiBaseUrl(STS_APK_PRODUCTION_API_BASE_URL)) {
    return "production";
  }

  if (
    normalized === normalizeApiBaseUrl(STS_APK_STAGING_API_BASE_URL) ||
    host === "staging-test.sportsturfsolutions.com"
  ) {
    return "staging";
  }

  return "dev";
}

/**
 * Footer Android button — STSPortal backend scans `assets/apk/` and redirects to the newest APK.
 * Driven by `NEXT_PUBLIC_STS_API_BASE_URL(S)` (which STSPortal host holds the APK files).
 */
export function getAndroidApkDownloadUrl(): string {
  return getStsApiUrl("/api/mobile_app/android_apk_download");
}

/** Footer always offers Android APK when an API base URL is configured. */
export function shouldOfferAndroidApkForHost(_host: string): boolean {
  return Boolean(getStsApiBaseUrl());
}
