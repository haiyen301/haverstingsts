import type { HarvestListExportFilter } from "@/features/harvest/lib/harvestListExport";

export const PENDING_HARVEST_GOOGLE_SHEET_EXPORT_KEY =
  "sts_pending_harvest_google_sheet_export";

export type PendingHarvestGoogleSheetExport = {
  selectedColumns: string[];
  filter: HarvestListExportFilter;
  savedAt: number;
};

export function savePendingHarvestGoogleSheetExport(
  pending: Omit<PendingHarvestGoogleSheetExport, "savedAt">,
): void {
  if (typeof window === "undefined") return;
  const payload: PendingHarvestGoogleSheetExport = {
    ...pending,
    savedAt: Date.now(),
  };
  sessionStorage.setItem(
    PENDING_HARVEST_GOOGLE_SHEET_EXPORT_KEY,
    JSON.stringify(payload),
  );
}

export function readPendingHarvestGoogleSheetExport(): PendingHarvestGoogleSheetExport | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(PENDING_HARVEST_GOOGLE_SHEET_EXPORT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingHarvestGoogleSheetExport;
    if (!Array.isArray(parsed.selectedColumns) || !parsed.filter) return null;
    if (Date.now() - (parsed.savedAt ?? 0) > 1000 * 60 * 30) {
      clearPendingHarvestGoogleSheetExport();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingHarvestGoogleSheetExport(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(PENDING_HARVEST_GOOGLE_SHEET_EXPORT_KEY);
}

export function startHarvestGoogleSheetOAuth(returnTo?: string): void {
  const target =
    returnTo ??
    (typeof window !== "undefined"
      ? `${window.location.pathname}${window.location.search}`
      : "/harvest");
  const url = `/api/projects/export/google-sheet/oauth/authorize?returnTo=${encodeURIComponent(target)}`;
  window.location.assign(url);
}
