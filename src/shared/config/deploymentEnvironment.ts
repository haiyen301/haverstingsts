import { getStsApiBaseUrl, getStsSiteRootUrl } from "@/shared/api/stsLogin";

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

/** @deprecated Prefer direct STSPortal URL from {@link getAndroidApkPublicBaseUrl}. */
export const ANDROID_APK_DOWNLOAD_PATH = "/api/mobile-app/android-apk/download";

const ANDROID_APK_ASSETS_PATH = "/assets/apk";

const TEST_DEPLOY_ENV_VALUES = new Set(["test", "staging"]);

function normalizeHostname(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (!trimmed) return "";
  const withoutPort = trimmed.split(":")[0] ?? trimmed;
  return withoutPort;
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
 * `NEXT_PUBLIC_STS_API_BASE_URLS` when this Next.js deploy serves production APK (`*_production.apk`).
 * APK files live on that STSPortal host under `assets/apk/`.
 */
export const STS_APK_PRODUCTION_API_BASE_URL =
  "https://staging.sportsturfsolutions.com/stsportal";

/**
 * `NEXT_PUBLIC_STS_API_BASE_URLS` when this Next.js deploy serves staging APK (`*_staging.apk`).
 * Example portal: https://staging-test.sportsturfsolutions.com/signin
 */
export const STS_APK_STAGING_API_BASE_URL =
  "https://staging-test.sportsturfsolutions.com/stsportal";

export type AndroidApkDeployTier = "production" | "staging" | "dev";

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

/**
 * APK tier from `NEXT_PUBLIC_STS_API_BASE_URLS` (first entry):
 * - production base → `*_production.apk`
 * - staging-test base → `*_staging.apk`
 * - anything else (local IP, localhost) → dev (`*_staging.apk`)
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

/** APK filename suffix for the current deploy (`NEXT_PUBLIC_STS_API_BASE_URLS`). */
export function getAndroidApkFilenameSuffixFromEnv(): string {
  if (getAndroidApkDeployTierFromEnv() === "production") return "_production.apk";
  return "_staging.apk";
}

export function getAndroidApkFilenameSuffixesFromEnv(): readonly string[] {
  return [getAndroidApkFilenameSuffixFromEnv()];
}

/**
 * Public STSPortal folder for APK downloads (browser hits this URL directly).
 * - production API base → `{siteRoot}/assets/apk` e.g. `https://staging.sportsturfsolutions.com/stsportal/assets/apk`
 * - staging-test or local dev → `{staging-test origin}/assets/apk` e.g. `https://staging-test.sportsturfsolutions.com/assets/apk`
 */
export function getAndroidApkPublicBaseUrl(): string {
  const tier = getAndroidApkDeployTierFromEnv();

  if (tier === "production") {
    const root = getStsSiteRootUrl();
    return root ? `${root}${ANDROID_APK_ASSETS_PATH}` : "";
  }

  try {
    const origin = new URL(STS_APK_STAGING_API_BASE_URL).origin;
    return `${origin}${ANDROID_APK_ASSETS_PATH}`;
  } catch {
    return "";
  }
}

/**
 * APK filename suffixes on STSPortal `assets/apk/` for the current deploy env.
 * @deprecated Prefer {@link getAndroidApkFilenameSuffixesFromEnv}.
 */
export function getAndroidApkFilenameSuffixesForHost(_host: string): readonly string[] {
  return getAndroidApkFilenameSuffixesFromEnv();
}

/** @deprecated Prefer {@link getAndroidApkFilenameSuffixFromEnv}. */
export function getAndroidApkFilenameSuffixForHost(_host: string): string {
  return getAndroidApkFilenameSuffixFromEnv();
}

/** Footer may query `/api/mobile-app/android-apk` for this host. */
export function shouldOfferAndroidApkForHost(_host: string): boolean {
  return true;
}
