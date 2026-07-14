import type { FuelUsageExportFilter } from "@/features/fleet/lib/fuelUsageDetailExport";

export const PENDING_FUEL_USAGE_GOOGLE_SHEET_EXPORT_KEY =
  "sts_pending_fuel_usage_google_sheet_export";

export type PendingFuelUsageGoogleSheetExport = {
  filter: FuelUsageExportFilter;
  savedAt: number;
};

export function savePendingFuelUsageGoogleSheetExport(
  pending: Omit<PendingFuelUsageGoogleSheetExport, "savedAt">,
): void {
  if (typeof window === "undefined") return;
  const payload: PendingFuelUsageGoogleSheetExport = {
    ...pending,
    savedAt: Date.now(),
  };
  sessionStorage.setItem(
    PENDING_FUEL_USAGE_GOOGLE_SHEET_EXPORT_KEY,
    JSON.stringify(payload),
  );
}

export function readPendingFuelUsageGoogleSheetExport(): PendingFuelUsageGoogleSheetExport | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(PENDING_FUEL_USAGE_GOOGLE_SHEET_EXPORT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingFuelUsageGoogleSheetExport;
    if (!parsed.filter?.farmIds || !Array.isArray(parsed.filter.kinds)) {
      clearPendingFuelUsageGoogleSheetExport();
      return null;
    }
    if (Date.now() - (parsed.savedAt ?? 0) > 1000 * 60 * 30) {
      clearPendingFuelUsageGoogleSheetExport();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingFuelUsageGoogleSheetExport(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(PENDING_FUEL_USAGE_GOOGLE_SHEET_EXPORT_KEY);
}

export function startFuelUsageGoogleSheetOAuth(returnTo?: string): void {
  const target =
    returnTo ??
    (typeof window !== "undefined"
      ? `${window.location.pathname}${window.location.search}`
      : "/fleet/fuel-usage");
  const url = `/api/projects/export/google-sheet/oauth/authorize?returnTo=${encodeURIComponent(target)}`;
  window.location.assign(url);
}
