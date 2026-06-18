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

export function aggregateSnapshotsByDate(
  rows: DbSnapshotRow[],
  farmIdSet: Set<string>,
  grassIdSet: Set<string>,
): Map<string, RollingDailyAvailableDay> {
  const byDate = new Map<string, RollingDailyAvailableDay>();
  const useChartAggregateOnly = farmIdSet.size === 0 && grassIdSet.size === 0;

  for (const row of rows) {
    const zoneKey = String(row.zone_key ?? "");

    if (useChartAggregateOnly) {
      // Chart metric = single row per day (0|__aggregate__|0). Never sum zone rows.
      if (zoneKey !== AGGREGATE_ZONE_KEY) continue;
      const day = mapDbSnapshotToRollingDay(row);
      byDate.set(day.date, day);
      continue;
    }

    if (zoneKey === AGGREGATE_ZONE_KEY) continue;

    if (farmIdSet.size > 0 && !farmIdSet.has(String(row.farm_id ?? ""))) continue;
    if (grassIdSet.size > 0 && !grassIdSet.has(String(row.grass_id ?? ""))) continue;

    const date = String(row.snapshot_date ?? "").slice(0, 10);
    const mapped = mapDbSnapshotToRollingDay(row);
    const existing = byDate.get(date);
    if (!existing) {
      byDate.set(date, { ...mapped });
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

  return byDate;
}

export function buildFarmProductMapFromSnapshots(
  rows: DbSnapshotRow[],
  farmIdSet: Set<string>,
  grassIdSet: Set<string>,
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
): DbDailySeriesResult {
  const farmIdSet = new Set(farmIds);
  const grassIdSet = new Set(grassIds);
  const byDate = aggregateSnapshotsByDate(snapshotRows, farmIdSet, grassIdSet);
  const aggregate = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  const byFarmProduct = buildFarmProductMapFromSnapshots(snapshotRows, farmIdSet, grassIdSet);
  const regrowthStatsByDate = new Map(Object.entries(regrowthStats));

  return { aggregate, byFarmProduct, regrowthStatsByDate };
}
