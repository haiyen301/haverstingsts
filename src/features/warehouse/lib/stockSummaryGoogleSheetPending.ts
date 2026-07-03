import type { StockSummaryExportFilter } from "@/features/warehouse/lib/stockSummaryExport";

export const PENDING_STOCK_SUMMARY_GOOGLE_SHEET_EXPORT_KEY =
  "sts_pending_stock_summary_google_sheet_export";

export type PendingStockSummaryGoogleSheetExport = {
  selectedColumns: string[];
  filter: StockSummaryExportFilter;
  savedAt: number;
};

export function savePendingStockSummaryGoogleSheetExport(
  pending: Omit<PendingStockSummaryGoogleSheetExport, "savedAt">,
): void {
  if (typeof window === "undefined") return;
  const payload: PendingStockSummaryGoogleSheetExport = {
    ...pending,
    savedAt: Date.now(),
  };
  sessionStorage.setItem(
    PENDING_STOCK_SUMMARY_GOOGLE_SHEET_EXPORT_KEY,
    JSON.stringify(payload),
  );
}

export function readPendingStockSummaryGoogleSheetExport(): PendingStockSummaryGoogleSheetExport | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(PENDING_STOCK_SUMMARY_GOOGLE_SHEET_EXPORT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingStockSummaryGoogleSheetExport;
    if (!Array.isArray(parsed.selectedColumns) || !parsed.filter) return null;
    if (Date.now() - (parsed.savedAt ?? 0) > 1000 * 60 * 30) {
      clearPendingStockSummaryGoogleSheetExport();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingStockSummaryGoogleSheetExport(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(PENDING_STOCK_SUMMARY_GOOGLE_SHEET_EXPORT_KEY);
}

export function startStockSummaryGoogleSheetOAuth(returnTo?: string): void {
  const path =
    typeof window !== "undefined" ? window.location.pathname : "/stock-summary";
  const target = returnTo ?? `${path}?googleSheetExport=resume`;
  const url = `/api/projects/export/google-sheet/oauth/authorize?returnTo=${encodeURIComponent(target)}`;
  window.location.assign(url);
}
