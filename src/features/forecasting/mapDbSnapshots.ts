import type { RollingDailyAvailableDay } from "@/features/forecasting/forecastDbTypes";
import {
  AGGREGATE_ZONE_KEY,
  type DbSnapshotRow,
  type RegrowthDayStats,
} from "@/features/forecasting/forecastSnapshotApi";

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function mapDbSnapshotToRollingDay(row: DbSnapshotRow): RollingDailyAvailableDay {
  const previous = num(row.previous_available_kg);
  const regrowth = num(row.regrowth_kg);
  const harvest = num(row.harvest_kg);

  return {
    date: String(row.snapshot_date ?? "").slice(0, 10),
    previousAvailableKg: previous,
    regrowthKg: regrowth,
    harvestKg: harvest,
    beforeHarvestKg: num(row.before_harvest_kg) || previous + regrowth,
    availableKg: num(row.available_kg),
    rawAvailableKg: num(row.raw_available_kg),
    capacityCapKg: num(row.capacity_cap_kg),
    overlimitKg: num(row.overlimit_kg),
  };
}

function mergeRollingDay(
  byDate: Map<string, RollingDailyAvailableDay>,
  date: string,
  mapped: RollingDailyAvailableDay,
): void {
  const existing = byDate.get(date);
  if (!existing) {
    byDate.set(date, { ...mapped });
    return;
  }
  existing.previousAvailableKg += mapped.previousAvailableKg;
  existing.regrowthKg += mapped.regrowthKg;
  existing.harvestKg += mapped.harvestKg;
  existing.beforeHarvestKg += mapped.beforeHarvestKg;
  existing.availableKg += mapped.availableKg;
  existing.rawAvailableKg += mapped.rawAvailableKg;
  existing.capacityCapKg += mapped.capacityCapKg;
  existing.overlimitKg += mapped.overlimitKg;
}

function sumZoneSnapshotsByDate(
  rows: DbSnapshotRow[],
  permissionScopeFarmIds: Set<string>,
): Map<string, RollingDailyAvailableDay> {
  const byDate = new Map<string, RollingDailyAvailableDay>();
  for (const row of rows) {
    const zoneKey = String(row.zone_key ?? "");
    if (zoneKey === AGGREGATE_ZONE_KEY) continue;
    const farmId = String(row.farm_id ?? "").trim();
    if (permissionScopeFarmIds.size > 0 && !permissionScopeFarmIds.has(farmId)) continue;
    const date = String(row.snapshot_date ?? "").slice(0, 10);
    if (!date) continue;
    mergeRollingDay(byDate, date, mapDbSnapshotToRollingDay(row));
  }
  return byDate;
}

/**
 * Filtered forecasting chart (today+): Cap A live roll — parity PHP
 * ForecastAvailableSourceAudit when farm/grass filters are on.
 *
 * Zone rows store Cap C (per-zone). Summing them under-counts when a zone is at
 * Cap C and rejects regrowth that Cap A (farm+grass pool) would still accept.
 * Past days (&lt; anchor) keep Σ zone Cap C (v14).
 */
export function applyFilteredForecastingCapALiveRoll(
  byDate: Map<string, RollingDailyAvailableDay>,
  anchorYmd: string,
): Map<string, RollingDailyAvailableDay> {
  const anchor = String(anchorYmd ?? "").slice(0, 10);
  if (!anchor || byDate.size === 0) return byDate;

  const dates = Array.from(byDate.keys()).sort((a, b) => a.localeCompare(b));
  let rollingKg: number | null = null;

  for (const date of dates) {
    const day = byDate.get(date);
    if (!day) continue;

    if (date < anchor) {
      // Past: leave Σ zone Cap C; next today+ day re-opens from that day's previous.
      rollingKg = null;
      continue;
    }

    const openingKg =
      rollingKg !== null ? rollingKg : Math.max(0, day.previousAvailableKg);
    const rawKg = Math.max(0, openingKg + day.regrowthKg - day.harvestKg);
    const cap = Math.max(0, day.capacityCapKg);
    const availableKg = cap > 0 ? Math.min(rawKg, cap) : rawKg;

    day.previousAvailableKg = openingKg;
    day.beforeHarvestKg = openingKg + day.regrowthKg;
    day.rawAvailableKg = rawKg;
    // Engine / audit display: whole kg (e.g. 95,364 not 95,364.18).
    day.availableKg = Math.round(availableKg);
    day.overlimitKg = Math.max(0, rawKg - (cap > 0 ? cap : rawKg));
    rollingKg = availableKg;
  }

  return byDate;
}

export function aggregateSnapshotsByDate(
  rows: DbSnapshotRow[],
  farmIdSet: Set<string>,
  grassIdSet: Set<string>,
  permissionScopeFarmIds: Set<string> = new Set(),
  options?: { anchorYmd?: string; applyCapALiveRoll?: boolean },
): Map<string, RollingDailyAvailableDay> {
  const byDate = new Map<string, RollingDailyAvailableDay>();
  const useChartAggregateOnly = farmIdSet.size === 0 && grassIdSet.size === 0;
  const hasPermissionFarmScope = permissionScopeFarmIds.size > 0;
  const applyCapA =
    Boolean(options?.applyCapALiveRoll) && Boolean(options?.anchorYmd);

  if (useChartAggregateOnly) {
    if (!hasPermissionFarmScope) {
      // Prefer persisted aggregate rows (v14 engine writes past/future split into available_kg).
      for (const row of rows) {
        const zoneKey = String(row.zone_key ?? "");
        if (zoneKey !== AGGREGATE_ZONE_KEY) continue;
        const day = mapDbSnapshotToRollingDay(row);
        byDate.set(day.date, day);
      }
      if (byDate.size > 0) return byDate;
    }
    // farm_user_id scope: sum zone rows, then Cap A live roll for today+ (parity audit).
    const scoped = sumZoneSnapshotsByDate(rows, permissionScopeFarmIds);
    return applyCapA
      ? applyFilteredForecastingCapALiveRoll(scoped, options!.anchorYmd!)
      : scoped;
  }

  for (const row of rows) {
    const zoneKey = String(row.zone_key ?? "");

    if (zoneKey === AGGREGATE_ZONE_KEY) continue;

    if (farmIdSet.size > 0 && !farmIdSet.has(String(row.farm_id ?? ""))) continue;
    if (grassIdSet.size > 0 && !grassIdSet.has(String(row.grass_id ?? ""))) continue;

    const date = String(row.snapshot_date ?? "").slice(0, 10);
    mergeRollingDay(byDate, date, mapDbSnapshotToRollingDay(row));
  }

  return applyCapA
    ? applyFilteredForecastingCapALiveRoll(byDate, options!.anchorYmd!)
    : byDate;
}

export function buildFarmProductMapFromSnapshots(
  rows: DbSnapshotRow[],
  farmIdSet: Set<string>,
  grassIdSet: Set<string>,
  options?: { anchorYmd?: string; applyCapALiveRoll?: boolean },
): Map<string, Map<string, RollingDailyAvailableDay>> {
  const out = new Map<string, Map<string, RollingDailyAvailableDay>>();

  for (const row of rows) {
    const zoneKey = String(row.zone_key ?? "");
    if (zoneKey === AGGREGATE_ZONE_KEY) continue;

    const farmId = num(row.farm_id);
    const grassId = num(row.grass_id);
    if (farmId <= 0 || grassId <= 0) continue;
    if (farmIdSet.size > 0 && !farmIdSet.has(String(farmId))) continue;
    if (grassIdSet.size > 0 && !grassIdSet.has(String(grassId))) continue;

    const fpKey = `${farmId}|${grassId}`;
    const date = String(row.snapshot_date ?? "").slice(0, 10);
    const mapped = mapDbSnapshotToRollingDay(row);

    if (!out.has(fpKey)) out.set(fpKey, new Map());
    const dateMap = out.get(fpKey)!;
    const existing = dateMap.get(date);
    if (!existing) {
      dateMap.set(date, mapped);
      continue;
    }
    existing.previousAvailableKg += mapped.previousAvailableKg;
    existing.regrowthKg += mapped.regrowthKg;
    existing.harvestKg += mapped.harvestKg;
    existing.beforeHarvestKg += mapped.beforeHarvestKg;
    existing.availableKg += mapped.availableKg;
    existing.rawAvailableKg += mapped.rawAvailableKg;
    existing.capacityCapKg += mapped.capacityCapKg;
    existing.overlimitKg += mapped.overlimitKg;
  }

  if (options?.applyCapALiveRoll && options.anchorYmd) {
    for (const dateMap of out.values()) {
      applyFilteredForecastingCapALiveRoll(dateMap, options.anchorYmd);
    }
  }

  return out;
}

export type DbDailySeriesResult = {
  aggregate: RollingDailyAvailableDay[];
  byFarmProduct: Map<string, Map<string, RollingDailyAvailableDay>>;
  regrowthStatsByDate: Map<string, RegrowthDayStats>;
};

export function buildDbDailySeriesResult(
  snapshotRows: DbSnapshotRow[],
  regrowthStats: Record<string, RegrowthDayStats>,
  farmIds: string[],
  grassIds: string[],
  permissionScopeFarmIds: string[] = [],
  options?: { anchorYmd?: string },
): DbDailySeriesResult {
  const farmIdSet = new Set(farmIds);
  const grassIdSet = new Set(grassIds);
  const permissionScope = new Set(
    permissionScopeFarmIds.map((x) => String(x).trim()).filter(Boolean),
  );
  // Filtered (or permission-scoped) series: Cap A live roll for today+ — parity forecast_audit.
  const applyCapALiveRoll =
    Boolean(options?.anchorYmd) &&
    (farmIdSet.size > 0 || grassIdSet.size > 0 || permissionScope.size > 0);
  const rollOpts = {
    anchorYmd: options?.anchorYmd,
    applyCapALiveRoll,
  };
  const byDate = aggregateSnapshotsByDate(
    snapshotRows,
    farmIdSet,
    grassIdSet,
    permissionScope,
    rollOpts,
  );
  const aggregate = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  const effectiveFarmScope =
    farmIds.length > 0 ? farmIdSet : permissionScope;
  const byFarmProduct = buildFarmProductMapFromSnapshots(
    snapshotRows,
    effectiveFarmScope,
    grassIdSet,
    rollOpts,
  );
  const regrowthStatsByDate = new Map(Object.entries(regrowthStats));

  return { aggregate, byFarmProduct, regrowthStatsByDate };
}
