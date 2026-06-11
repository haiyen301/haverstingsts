export const PENDING_PROJECT_DETAIL_HARVEST_GOOGLE_SHEET_EXPORT_KEY =
  "sts_pending_project_detail_harvest_google_sheet_export";

export type PendingProjectDetailHarvestGoogleSheetExport = {
  selectedColumns: string[];
  projectId: string;
  savedAt: number;
};

export function savePendingProjectDetailHarvestGoogleSheetExport(
  pending: Omit<PendingProjectDetailHarvestGoogleSheetExport, "savedAt">,
): void {
  if (typeof window === "undefined") return;
  const payload: PendingProjectDetailHarvestGoogleSheetExport = {
    ...pending,
    savedAt: Date.now(),
  };
  sessionStorage.setItem(
    PENDING_PROJECT_DETAIL_HARVEST_GOOGLE_SHEET_EXPORT_KEY,
    JSON.stringify(payload),
  );
}

export function readPendingProjectDetailHarvestGoogleSheetExport(): PendingProjectDetailHarvestGoogleSheetExport | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(
    PENDING_PROJECT_DETAIL_HARVEST_GOOGLE_SHEET_EXPORT_KEY,
  );
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingProjectDetailHarvestGoogleSheetExport;
    if (!Array.isArray(parsed.selectedColumns) || !parsed.projectId) return null;
    if (Date.now() - (parsed.savedAt ?? 0) > 1000 * 60 * 30) {
      clearPendingProjectDetailHarvestGoogleSheetExport();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingProjectDetailHarvestGoogleSheetExport(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(PENDING_PROJECT_DETAIL_HARVEST_GOOGLE_SHEET_EXPORT_KEY);
}

export function startProjectDetailHarvestGoogleSheetOAuth(returnTo?: string): void {
  const target =
    returnTo ??
    (typeof window !== "undefined"
      ? `${window.location.pathname}${window.location.search}`
      : "/projects/detail");
  const url = `/api/projects/export/google-sheet/oauth/authorize?returnTo=${encodeURIComponent(target)}`;
  window.location.assign(url);
}
