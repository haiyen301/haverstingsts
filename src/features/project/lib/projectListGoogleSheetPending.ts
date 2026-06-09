import type { ProjectListExportFilter } from "@/features/project/lib/projectListExport";

export const PENDING_GOOGLE_SHEET_EXPORT_KEY = "sts_pending_google_sheet_export";

export type PendingGoogleSheetExport = {
  selectedColumns: string[];
  filter: ProjectListExportFilter;
  savedAt: number;
};

export function savePendingGoogleSheetExport(
  pending: Omit<PendingGoogleSheetExport, "savedAt">,
): void {
  if (typeof window === "undefined") return;
  const payload: PendingGoogleSheetExport = {
    ...pending,
    savedAt: Date.now(),
  };
  sessionStorage.setItem(PENDING_GOOGLE_SHEET_EXPORT_KEY, JSON.stringify(payload));
}

export function readPendingGoogleSheetExport(): PendingGoogleSheetExport | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(PENDING_GOOGLE_SHEET_EXPORT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingGoogleSheetExport;
    if (!Array.isArray(parsed.selectedColumns) || !parsed.filter) return null;
    if (Date.now() - (parsed.savedAt ?? 0) > 1000 * 60 * 30) {
      clearPendingGoogleSheetExport();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingGoogleSheetExport(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(PENDING_GOOGLE_SHEET_EXPORT_KEY);
}

export function startGoogleSheetOAuth(returnTo?: string): void {
  const target =
    returnTo ??
    (typeof window !== "undefined"
      ? `${window.location.pathname}${window.location.search}`
      : "/projects");
  const url = `/api/projects/export/google-sheet/oauth/authorize?returnTo=${encodeURIComponent(target)}`;
  window.location.assign(url);
}
