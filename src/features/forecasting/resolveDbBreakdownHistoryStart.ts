import type { ForecastMetaResponse } from "@/features/forecasting/forecastSnapshotApi";

const DEFAULT_DB_HISTORY_START = "2019-01-01";

function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Balance breakdown history start = earliest snapshot_date actually stored in DB
 * (falls back to forecast data epoch).
 */
export function resolveDbBreakdownHistoryStartYmd(
  meta: ForecastMetaResponse | null | undefined,
  fallbackYmd: string = DEFAULT_DB_HISTORY_START,
): string {
  const boundsMin = String(meta?.snapshot_date_bounds?.all?.min_date ?? "")
    .trim()
    .slice(0, 10);
  if (isYmd(boundsMin)) return boundsMin;

  const dataStart = String(meta?.data_start_date ?? "").trim().slice(0, 10);
  if (isYmd(dataStart)) return dataStart;

  return isYmd(fallbackYmd) ? fallbackYmd : DEFAULT_DB_HISTORY_START;
}
