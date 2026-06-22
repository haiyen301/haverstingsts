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
  regrowth_kg?: number | string;
  harvest_kg?: number | string;
  before_harvest_kg?: number | string;
  available_kg?: number | string;
  raw_available_kg?: number | string;
  calculated_kg?: number | string;
  capacity_cap_kg?: number | string;
  overlimit_kg?: number | string;
  has_manual_override?: number | boolean | string;
};

export type SnapshotDateBounds = {
  min_date: string;
  max_date: string;
  count: number;
};

export type ForecastMetaResponse = {
  period?: { id?: number; opening_balance_date?: string; period_code?: string };
  requested_period?: { id?: number; opening_balance_date?: string };
  last_run?: { input_hash?: string; completed_at?: string };
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

export async function fetchForecastSnapshots(params: {
  dateFrom: string;
  dateTo: string;
  anchorDate?: string;
  periodId?: number;
  zoneKey?: string;
  farmId?: number;
  grassId?: number;
}): Promise<DbSnapshotRow[]> {
  const query: Record<string, string | number> = {
    date_from: params.dateFrom,
    date_to: params.dateTo,
    limit: 100000,
  };
  if (params.periodId != null && params.periodId > 0) {
    query.period_id = params.periodId;
  }
  // Never pass anchor_date — snapshot rows keep rebuild anchor, not UI anchor.
  if (params.zoneKey) query.zone_key = params.zoneKey;
  if (params.farmId) query.farm_id = params.farmId;
  if (params.grassId) query.grass_id = params.grassId;

  const res = await stsProxyGetWithParamsOptional<DbSnapshotRow[]>(
    STS_API_PATHS.forecastSnapshots,
    query,
  );
  return Array.isArray(res) ? res : [];
}

export async function fetchRegrowthStats(params: {
  dateFrom: string;
  dateTo: string;
  anchorDate?: string;
}): Promise<Record<string, RegrowthDayStats>> {
  const query: Record<string, string> = {
    date_from: params.dateFrom,
    date_to: params.dateTo,
  };
  if (params.anchorDate) query.anchor = params.anchorDate;

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
