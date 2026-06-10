/**
 * ONLY `/test/harvest-export` is public (no STS login).
 * Every other route — projects, harvest list, OAuth with returnTo elsewhere — requires STS auth.
 * Do not widen this allowlist without an explicit product decision.
 */
export const DEMO_HARVEST_GOOGLE_SHEET_RETURN_PATH = "/test/harvest-export";

/** True only for the internal harvest-export demo page (and subpaths). */
export function isPublicHarvestExportDemoOAuthReturnPath(returnTo: string): boolean {
  const trimmed = returnTo.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return false;
  const pathname = trimmed.split("?")[0]?.split("#")[0] ?? "";
  return (
    pathname === DEMO_HARVEST_GOOGLE_SHEET_RETURN_PATH ||
    pathname.startsWith(`${DEMO_HARVEST_GOOGLE_SHEET_RETURN_PATH}/`)
  );
}
