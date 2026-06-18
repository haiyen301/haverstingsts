import type { ForecastMetaResponse } from "@/features/forecasting/forecastSnapshotApi";

const DEFAULT_DB_HISTORY_START = "2019-01-01";

function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Earliest snapshot date available in DB (e.g. 2019+) for balance breakdown history. */
export function resolveDbBreakdownHistoryStartYmd(
  meta: ForecastMetaResponse | null | undefined,
  fallbackYmd: string = DEFAULT_DB_HISTORY_START,
): string {
  const candidates = [
    meta?.data_start_date,
    meta?.selectable_bounds?.min_date,
    meta?.snapshot_date_bounds?.all?.min_date,
    meta?.snapshot_date_bounds?.aggregate?.min_date,
  ];

  for (const candidate of candidates) {
    const ymd = String(candidate ?? "").trim().slice(0, 10);
    if (isYmd(ymd)) return ymd;
  }

  return isYmd(fallbackYmd) ? fallbackYmd : DEFAULT_DB_HISTORY_START;
}
