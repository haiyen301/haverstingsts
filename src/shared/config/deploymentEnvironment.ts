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
 * APK filename suffix auto-detected in STSPortal `assets/apk/` for the current host.
 * Production → `*_production.apk`; test / staging / local dev → `*_staging.apk`.
 */
export function getAndroidApkFilenameSuffixForHost(host: string): string | null {
  if (isProductionDeploymentHost(host)) return "_production.apk";

  if (isTestDeploymentHost(host) || isTestDeploymentFromEnv()) {
    return "_staging.apk";
  }

  const hostname = normalizeHostname(host);
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".local")
  ) {
    return "_staging.apk";
  }

  return null;
}

/** Footer may query `/api/mobile-app/android-apk` when a suffix applies for this host. */
export function shouldOfferAndroidApkForHost(host: string): boolean {
  return getAndroidApkFilenameSuffixForHost(host) != null;
}
