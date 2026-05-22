/** Production STS Portal (Next) — https://stsportal.sportsturfsolutions.com/ */
export const STS_PORTAL_PRODUCTION_HOST = "stsportal.sportsturfsolutions.com";

/** Test / staging STS Portal — https://stsportal-test.sportsturfsolutions.com/ */
export const STS_PORTAL_TEST_HOST = "stsportal-test.sportsturfsolutions.com";

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
