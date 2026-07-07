import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import {
  getInternalStsProxyUrl,
  stsProxyGetWithParamsOptional,
  stsProxyPostJson,
} from "@/shared/api/stsProxyClient";

export const AGGREGATE_ZONE_KEY = "0|__aggregate__|0";

export type DbSnapshotRow = {
  snapshot_date: string;
  zone_key: string;
  farm_id?: number | string;
  grass_id?: number | string;
  zone?: string;
  previous_available_kg?: number | string;
  raw_previous_available_kg?: number | string;
  regrowth_kg?: number | string;
  harvest_kg?: number | string;
  before_harvest_kg?: number | string;
  available_kg?: number | string;
  raw_available_kg?: number | string;
  calculated_kg?: number | string;
  capacity_cap_kg?: number | string;
  overlimit_kg?: number | string;
  is_cap_applied?: number | boolean | string;
  has_manual_override?: number | boolean | string;
  snapshot_kind?: string;
  source?: string;
  period_id?: number | string;
};

export type SnapshotDateBounds = {
  min_date: string;
  max_date: string;
  count: number;
};

export type ForecastMetaResponse = {
  period?: { id?: number; opening_balance_date?: string; period_code?: string };
  requested_period?: { id?: number; opening_balance_date?: string };
  last_run?: {
    input_hash?: string;
    completed_at?: string;
    run_type?: string;
    simulation_start_date?: string;
    snapshot_count?: number | string;
  };
  snapshot_count?: number;
  total_snapshot_count?: number;
  logic_version?: number;
  is_stale?: boolean;
  pending_queue_jobs?: number;
  queue_processing?: boolean;
  data_start_date?: string;
  horizon_months?: number;
  snapshot_date_bounds?: {
    all?: SnapshotDateBounds | null;
    aggregate?: SnapshotDateBounds | null;
  };
  selectable_bounds?: {
    min_date: string;
    max_date: string;
    min_year?: number;
    max_year?: number;
  };
};

export type RegrowthDayStats = {
  source_count: number;
  gross_kg: number;
  credited_kg: number;
  overlimit_kg: number;
};

export type ForecastDayDetailRow = Record<string, unknown>;

export async function fetchForecastMeta(anchorDate?: string): Promise<ForecastMetaResponse | null> {
  const params = anchorDate ? { anchor_date: anchorDate } : undefined;
  return stsProxyGetWithParamsOptional<ForecastMetaResponse>(
    STS_API_PATHS.forecastMeta,
    params,
  );
}

  const ALL_PERIODS_ZONE_LIMIT = 6000;
  const ALL_PERIODS_FARM_GRASS_LIMIT = 20000;

export type InventoryTotalsRow = {
  snapshot_date: string;
  zone_sum_available_kg?: number | string;
  zone_sum_raw_available_kg?: number | string;
  scope_type?: string;
  farm_id?: number | string;
  grass_id?: number | string;
};

export async function fetchInventoryTotals(params: {
  dateFrom: string;
  dateTo: string;
  scopeType: "farm" | "farm_grass";
  rollup?: "company";
  farmId?: number;
  grassId?: number;
  farmIds?: string[];
  scopeModule?: "forecasting" | "inventory";
}): Promise<InventoryTotalsRow[]> {
  const query: Record<string, string | number> = {
    date_from: params.dateFrom,
    date_to: params.dateTo,
    scope_type: params.scopeType,
    limit: 100000,
  };
  if (params.rollup === "company") query.rollup = "company";
  if (params.farmId) query.farm_id = params.farmId;
  if (params.grassId) query.grass_id = params.grassId;
  const farmIdsCsv = (params.farmIds ?? [])
    .map((x) => String(x).trim())
    .filter(Boolean)
    .join(",");
  if (farmIdsCsv) query.farm_ids = farmIdsCsv;
  if (params.scopeModule) query.scope_module = params.scopeModule;

  const res = await stsProxyGetWithParamsOptional<InventoryTotalsRow[]>(
    STS_API_PATHS.forecastInventoryTotals,
    query,
  );
  return Array.isArray(res) ? res : [];
}

export async function fetchForecastSnapshots(params: {
  dateFrom: string;
  dateTo: string;
  anchorDate?: string;
  periodId?: number;
  /** Merge all periods in range; newest period/run wins per (date, zone_key). */
  allPeriods?: boolean;
  zoneKey?: string;
  farmId?: number;
  grassId?: number;
  /** Comma-separated farm ids — optional UI filter; server applies permission scope via scope_module. */
  farmIds?: string[];
  scopeModule?: "forecasting" | "inventory";
  /** Only days with harvest, regrowth, manual override, or cap change (balance trace). */
  impactOnly?: boolean;
}): Promise<DbSnapshotRow[]> {
  const hasZoneKey = Boolean(params.zoneKey?.trim());
  const query: Record<string, string | number> = {
    date_from: params.dateFrom,
    date_to: params.dateTo,
    limit: params.allPeriods
      ? hasZoneKey
        ? ALL_PERIODS_ZONE_LIMIT
        : ALL_PERIODS_FARM_GRASS_LIMIT
      : 100000,
  };
  if (params.allPeriods) {
    query.all_periods = 1;
  } else if (params.periodId != null && params.periodId > 0) {
    query.period_id = params.periodId;
  }
  if (params.impactOnly) {
    query.impact_only = 1;
  }
  // Never pass anchor_date — snapshot rows keep rebuild anchor, not UI anchor.
  if (params.zoneKey) query.zone_key = params.zoneKey;
  if (params.farmId) query.farm_id = params.farmId;
  if (params.grassId) query.grass_id = params.grassId;
  const farmIdsCsv = (params.farmIds ?? [])
    .map((x) => String(x).trim())
    .filter(Boolean)
    .join(",");
  if (farmIdsCsv) query.farm_ids = farmIdsCsv;
  if (params.scopeModule) query.scope_module = params.scopeModule;

  const res = await stsProxyGetWithParamsOptional<DbSnapshotRow[]>(
    STS_API_PATHS.forecastSnapshots,
    query,
  );
  return Array.isArray(res) ? res : [];
}

function snapshotPeriodId(row: DbSnapshotRow): number {
  const n = Number(row.period_id ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Newest period wins per (snapshot_date, zone_key) — parity PHP all_periods. */
export function mergeSnapshotRowsByDate(rows: DbSnapshotRow[]): DbSnapshotRow[] {
  const byKey = new Map<string, DbSnapshotRow>();
  for (const row of rows) {
    const dateYmd = String(row.snapshot_date ?? "").trim().slice(0, 10);
    const zoneKey = String(row.zone_key ?? "").trim();
    const key = `${dateYmd}|${zoneKey}`;
    const existing = byKey.get(key);
    if (!existing || snapshotPeriodId(row) >= snapshotPeriodId(existing)) {
      byKey.set(key, row);
    }
  }
  return Array.from(byKey.values()).sort((a, b) =>
    String(a.snapshot_date ?? "").localeCompare(String(b.snapshot_date ?? "")),
  );
}

/**
 * Balance breakdown history: all_periods merge, with fallback when API errors or
 * only the forward period is returned (e.g. period 6 without full_history period 1).
 */
export async function fetchZoneBalanceHistorySnapshots(params: {
  dateFrom: string;
  dateTo: string;
  zoneKey: string;
  farmId?: number;
  grassId?: number;
  farmIds?: string[];
  scopeModule?: "forecasting" | "inventory";
  impactOnly?: boolean;
  anchorDate?: string;
}): Promise<DbSnapshotRow[]> {
  const base = {
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    zoneKey: params.zoneKey,
    farmId: params.farmId,
    grassId: params.grassId,
    farmIds: params.farmIds,
    scopeModule: params.scopeModule,
    impactOnly: params.impactOnly,
  };

  try {
    const allPeriodRows = await fetchForecastSnapshots({ ...base, allPeriods: true });
    if (allPeriodRows.length > 0) {
      const spanDays = countYmdSpanDays(params.dateFrom, params.dateTo);
      // Forward-only period returns a handful of rows; full history has hundreds+ impact days.
      if (spanDays <= 400 || allPeriodRows.length >= 30 || params.impactOnly) {
        return allPeriodRows;
      }
    }
  } catch {
    // fall through to period merge
  }

  const meta = await fetchForecastMeta(params.anchorDate);
  const activePeriodId = Number(meta?.period?.id ?? 0);
  const historyPeriodId = resolveFullHistoryPeriodId(meta);

  const fetches: Promise<DbSnapshotRow[]>[] = [
    fetchForecastSnapshots({ ...base, periodId: historyPeriodId }),
  ];
  if (activePeriodId > 0 && activePeriodId !== historyPeriodId) {
    fetches.push(fetchForecastSnapshots({ ...base, periodId: activePeriodId }));
  }

  const parts = await Promise.all(fetches);
  return mergeSnapshotRowsByDate(parts.flat());
}

function countYmdSpanDays(fromYmd: string, toYmd: string): number {
  const from = Date.parse(`${fromYmd.slice(0, 10)}T00:00:00`);
  const to = Date.parse(`${toYmd.slice(0, 10)}T00:00:00`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 0;
  return Math.round((to - from) / 86_400_000);
}

/** Period that stores simulate-from-2019 rows (fallback: 1). */
function resolveFullHistoryPeriodId(meta: ForecastMetaResponse | null): number {
  const lastRunType = String(meta?.last_run?.run_type ?? "").trim();
  const simStart = String(meta?.last_run?.simulation_start_date ?? "").slice(0, 10);
  if (lastRunType === "full_history" || simStart === "2019-01-01") {
    const periodId = Number(meta?.period?.id ?? 0);
    if (periodId > 0) return periodId;
  }
  return 1;
}

export async function fetchRegrowthStats(params: {
  dateFrom: string;
  dateTo: string;
  anchorDate?: string;
  scopeModule?: "forecasting" | "inventory";
}): Promise<Record<string, RegrowthDayStats>> {
  const query: Record<string, string> = {
    date_from: params.dateFrom,
    date_to: params.dateTo,
  };
  if (params.anchorDate) query.anchor = params.anchorDate;
  if (params.scopeModule) query.scope_module = params.scopeModule;

  const res = await stsProxyGetWithParamsOptional<{
    stats?: Record<string, RegrowthDayStats>;
  }>(STS_API_PATHS.forecastRegrowthStats, query);

  return res?.stats ?? {};
}

export async function fetchForecastDayDetail(params: {
  date: string;
  kind: "harvest" | "regrowth";
  anchorDate?: string;
}): Promise<{
  kind: string;
  date: string;
  total_kg: number;
  gross_kg?: number;
  overlimit_kg?: number;
  rows: ForecastDayDetailRow[];
}> {
  const query: Record<string, string> = {
    date: params.date,
    kind: params.kind,
  };
  if (params.anchorDate) query.anchor = params.anchorDate;

  const res = await stsProxyGetWithParamsOptional<{
    kind: string;
    date: string;
    total_kg: number;
    gross_kg?: number;
    overlimit_kg?: number;
    rows: ForecastDayDetailRow[];
  }>(STS_API_PATHS.forecastDayDetail, query);

  return (
    res ?? {
      kind: params.kind,
      date: params.date,
      total_kg: 0,
      rows: [],
    }
  );
}

export async function queueForecastForwardRebuild(fromDate: string): Promise<void> {
  await stsProxyPostJson(STS_API_PATHS.forecastRebuild, {
    run_type: "forward",
    from_date: fromDate,
    queue: true,
  });
}

export type ForecastSnapshotMechanism =
  | "harvest_plan"
  | "harvest_estimate"
  | "harvest_actual"
  | "project_pace"
  | "regrowth_rules"
  | "zone_configuration"
  | "inventory_balance"
  | "grass_catalog"
  | "farm_remove"
  | "zone_remove"
  | "bootstrap_initial"
  | "full_reseed"
  | "harvest_import";

export type ForecastSnapshotUpdateRequest = {
  mechanism: ForecastSnapshotMechanism;
  from_date?: string;
  to_date?: string;
  scope?: Record<string, unknown>;
};

/** Queue a mechanism-specific snapshot update on the server (always async). */
export async function queueForecastSnapshotUpdate(
  body: ForecastSnapshotUpdateRequest,
): Promise<void> {
  await stsProxyPostJson(STS_API_PATHS.forecastSnapshotUpdate, body);
}

/** Queue one full-history forecast rebuild after a successful harvest import batch. */
export async function queueForecastFullRebuildAfterHarvestImport(
  importSessionId: string,
): Promise<void> {
  await queueForecastSnapshotUpdate({
    mechanism: "harvest_import",
    scope: { import_session_id: importSessionId.trim() },
  });
}

export type ForecastQueueStatus = {
  queue: string;
  pending_jobs: number;
  reserved_jobs: number;
  is_processing: boolean;
  is_stale: boolean;
};

export type ForecastProcessQueueResult = ForecastQueueStatus & {
  outcome: "completed" | "failed" | "busy" | "empty";
  message?: string;
  job_id?: number;
  job_key?: string;
  error?: string | null;
};

export async function fetchForecastQueueStatus(): Promise<ForecastQueueStatus | null> {
  return stsProxyGetWithParamsOptional<ForecastQueueStatus>(STS_API_PATHS.forecastQueueStatus);
}

/** Run exactly one forecast queue job (blocks until the job finishes or fails). */
export async function processForecastQueueJob(): Promise<ForecastProcessQueueResult> {
  if (typeof window === "undefined") {
    throw new Error("processForecastQueueJob is client-only");
  }

  const url = getInternalStsProxyUrl(STS_API_PATHS.forecastProcessQueue);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({}),
  });

  let json: { success?: boolean; data?: ForecastProcessQueueResult; message?: string };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    throw new Error("Invalid JSON response");
  }

  if (json.data) {
    return json.data;
  }

  throw new Error(json.message ?? `Request failed (${res.status})`);
}
