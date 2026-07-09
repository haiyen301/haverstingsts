import type { FertilizerBalanceExportFilter } from "@/features/fertilizer/lib/fertilizerBalanceExport";

export const PENDING_FERTILIZER_GOOGLE_SHEET_EXPORT_KEY =
  "sts_pending_fertilizer_google_sheet_export";

export type PendingFertilizerGoogleSheetExport = {
  filter: FertilizerBalanceExportFilter;
  exportKind?: "summary" | "detail";
  savedAt: number;
};

type LegacyPendingFilter = {
  farms?: FertilizerBalanceExportFilter["farms"];
  year?: number;
  month?: number;
  fromYear?: number;
  fromMonth?: number;
  toYear?: number;
  toMonth?: number;
};

function normalizePendingFilter(raw: LegacyPendingFilter): FertilizerBalanceExportFilter | null {
  if (!raw.farms?.length) return null;
  const legacyYear = raw.year;
  const legacyMonth = raw.month;
  const fromYear = raw.fromYear ?? legacyYear;
  const fromMonth = raw.fromMonth ?? legacyMonth;
  const toYear = raw.toYear ?? legacyYear ?? fromYear;
  const toMonth = raw.toMonth ?? legacyMonth ?? fromMonth;
  if (
    !Number.isFinite(fromYear) ||
    !Number.isFinite(fromMonth) ||
    !Number.isFinite(toYear) ||
    !Number.isFinite(toMonth)
  ) {
    return null;
  }
  return {
    farms: raw.farms,
    fromYear: Number(fromYear),
    fromMonth: Number(fromMonth),
    toYear: Number(toYear),
    toMonth: Number(toMonth),
  };
}

export function savePendingFertilizerGoogleSheetExport(
  pending: Omit<PendingFertilizerGoogleSheetExport, "savedAt">,
): void {
  if (typeof window === "undefined") return;
  const payload: PendingFertilizerGoogleSheetExport = {
    ...pending,
    savedAt: Date.now(),
  };
  sessionStorage.setItem(PENDING_FERTILIZER_GOOGLE_SHEET_EXPORT_KEY, JSON.stringify(payload));
}

export function readPendingFertilizerGoogleSheetExport(): PendingFertilizerGoogleSheetExport | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(PENDING_FERTILIZER_GOOGLE_SHEET_EXPORT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingFertilizerGoogleSheetExport;
    const filter = normalizePendingFilter(parsed.filter ?? {});
    if (!filter) return null;
    if (Date.now() - (parsed.savedAt ?? 0) > 1000 * 60 * 30) {
      clearPendingFertilizerGoogleSheetExport();
      return null;
    }
    return { ...parsed, filter };
  } catch {
    return null;
  }
}

export function clearPendingFertilizerGoogleSheetExport(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(PENDING_FERTILIZER_GOOGLE_SHEET_EXPORT_KEY);
}

export function startFertilizerGoogleSheetOAuth(returnTo?: string): void {
  const target =
    returnTo ??
    (typeof window !== "undefined"
      ? `${window.location.pathname}${window.location.search}`
      : "/harvest/fertilizer-usage");
  const url = `/api/projects/export/google-sheet/oauth/authorize?returnTo=${encodeURIComponent(target)}`;
  window.location.assign(url);
}
