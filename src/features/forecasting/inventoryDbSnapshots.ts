import { pickInventoryOverrideForExactDate } from "@/features/forecasting/inventoryAvailableOverrides";
import type { ZoneInventoryDaySnapshot } from "@/features/forecasting/forecastDbTypes";
import {
  AGGREGATE_ZONE_KEY,
  type DbSnapshotRow,
} from "@/features/forecasting/forecastSnapshotApi";
import type { ZoneConfigurationRow } from "@/features/admin/api/adminApi";
import type { ForecastHarvestRow } from "@/features/forecasting/forecastingTypes";
import {
  canonicalForecastZoneKey,
  findActiveZoneConfiguration,
  forecastZoneKeyFromParts,
  forecastZoneKeyFromRow,
  forecastZoneKeysEqual,
  zoneConfigIsActiveAtYmd,
  zoneConfigurationMaxKg,
} from "@/features/forecasting/inventoryRegrowthCalculator";
import { isForecastExcludedZone } from "@/features/forecasting/forecastingInventoryConversion";
import type { InventoryAvailableOverrideEntry } from "@/shared/store/inventoryAvailableOverrideStore";

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeYmd(value: string): string {
  return value.trim().slice(0, 10);
}

/** Per-zone rows only (excludes chart aggregate). */
export function zoneLevelSnapshotRows(rows: DbSnapshotRow[]): DbSnapshotRow[] {
  return rows.filter((row) => String(row.zone_key ?? "") !== AGGREGATE_ZONE_KEY);
}

export function snapshotsForDate(rows: DbSnapshotRow[], asOfYmd: string): DbSnapshotRow[] {
  const ymd = normalizeYmd(asOfYmd);
  return zoneLevelSnapshotRows(rows).filter(
    (row) => normalizeYmd(String(row.snapshot_date ?? "")) === ymd,
  );
}

export function buildZoneSnapshotMapAtDate(
  rows: DbSnapshotRow[],
  asOfYmd: string,
): Map<string, DbSnapshotRow> {
  const out = new Map<string, DbSnapshotRow>();
  for (const row of snapshotsForDate(rows, asOfYmd)) {
    const key = canonicalForecastZoneKey(String(row.zone_key ?? "").trim());
    if (!key) continue;
    out.set(key, row);
  }
  return out;
}

function snapshotForZoneKey(
  dayByZone: Map<string, DbSnapshotRow>,
  zoneKey: string,
): DbSnapshotRow | undefined {
  const canonical = canonicalForecastZoneKey(zoneKey);
  if (dayByZone.has(canonical)) return dayByZone.get(canonical);
  for (const [key, row] of dayByZone) {
    if (forecastZoneKeysEqual(key, zoneKey)) return row;
  }
  return undefined;
}

/** Chart metric per day — `0|__aggregate__|0` (parity forecasting chart). */
export function buildAggregateAvailableByDate(rows: DbSnapshotRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    if (String(row.zone_key ?? "") !== AGGREGATE_ZONE_KEY) continue;
    const date = normalizeYmd(String(row.snapshot_date ?? ""));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    out.set(date, Math.round(num(row.available_kg)));
  }
  return out;
}

export function aggregateAvailableKgForDate(
  rows: DbSnapshotRow[],
  asOfYmd: string,
): number | null {
  return buildAggregateAvailableByDate(rows).get(normalizeYmd(asOfYmd)) ?? null;
}

export function buildOverlimitByFarmProductFromDbSnapshots(
  rows: DbSnapshotRow[],
  asOfYmd: string,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of snapshotsForDate(rows, asOfYmd)) {
    const overlimit = num(row.overlimit_kg);
    if (overlimit <= 0) continue;
    const farmId = num(row.farm_id);
    const grassId = num(row.grass_id);
    if (farmId <= 0 || grassId <= 0) continue;
    const fpKey = `${farmId}|${grassId}`;
    out.set(fpKey, (out.get(fpKey) ?? 0) + overlimit);
  }
  return out;
}

/** Engine stores system value in calculated_kg and manual value in available_kg. */
export function hasDbManualSplitInSnapshot(params: {
  calculatedKg: number | null;
  availableKg: number;
}): boolean {
  if (params.calculatedKg == null) return false;
  return Math.round(params.calculatedKg) !== Math.round(params.availableKg);
}

/** available_kg unchanged from previous while harvest was logged — not an intentional manual set. */
export function isStaleHarvestBalanceInDbSnapshot(params: {
  previousKg: number;
  harvestKg: number;
  availableKg: number;
  hasDbManualSplit?: boolean;
}): boolean {
  if (params.harvestKg <= 0) return false;
  if (params.hasDbManualSplit) return false;
  return Math.round(params.availableKg) === Math.round(params.previousKg);
}

export function resolveDbSnapshotSystemKg(
  row: DbSnapshotRow,
  arithmeticRolledKg: number,
): number {
  const raw = num(row.raw_available_kg);
  if (Number.isFinite(raw)) {
    return Math.round(raw);
  }
  if (row.calculated_kg != null && Number.isFinite(num(row.calculated_kg))) {
    return Math.round(num(row.calculated_kg));
  }
  return arithmeticRolledKg;
}

export function dbSnapshotToZoneInventoryDaySnapshot(
  row: DbSnapshotRow,
  overridesByZone: Record<string, InventoryAvailableOverrideEntry>,
  asOfYmd: string,
): ZoneInventoryDaySnapshot {
  const zoneKey = String(row.zone_key ?? "").trim();
  const maxKg = Math.round(num(row.capacity_cap_kg));
  const previousKg = Math.round(num(row.previous_available_kg));
  const regrowthKg = Math.round(num(row.regrowth_kg));
  const harvestKg = Math.round(num(row.harvest_kg));
  const systemRolledKg = Math.max(0, previousKg + regrowthKg - harvestKg);
  const systemKg = resolveDbSnapshotSystemKg(row, systemRolledKg);
  const calculatedKg = Math.round(num(row.calculated_kg ?? systemKg));
  const effectiveKg = Math.round(num(row.available_kg));
  const hasDbOverride = Boolean(row.has_manual_override);
  const exactOverride = pickInventoryOverrideForExactDate(overridesByZone, zoneKey, asOfYmd);
  const dbCalculatedKg =
    row.calculated_kg != null && Number.isFinite(num(row.calculated_kg))
      ? Math.round(num(row.calculated_kg))
      : null;
  const hasDbManualSplit = hasDbManualSplitInSnapshot({
    calculatedKg: dbCalculatedKg,
    availableKg: effectiveKg,
  });
  const staleHarvestBalance = isStaleHarvestBalanceInDbSnapshot({
    previousKg,
    harvestKg,
    availableKg: effectiveKg,
    hasDbManualSplit,
  });
  const clientOverrideStaleOnHarvest =
    !!exactOverride &&
    harvestKg > 0 &&
    !hasDbOverride &&
    !hasDbManualSplit &&
    Math.round(Math.max(0, exactOverride.availableKg)) === Math.round(previousKg);
  const isManualOverrideActive =
    (hasDbOverride || !!exactOverride) && !clientOverrideStaleOnHarvest;
  const candidateManualKg = isManualOverrideActive
    ? Math.round(Math.max(0, exactOverride?.availableKg ?? effectiveKg))
    : null;
  const hasRealManualOverride =
    !staleHarvestBalance &&
    isManualOverrideActive &&
    candidateManualKg != null &&
    Math.round(candidateManualKg) !== Math.round(systemKg);
  const manualOverrideKg = hasRealManualOverride ? candidateManualKg : null;
  const pct = maxKg > 0 ? Math.round((effectiveKg / maxKg) * 100) : 0;

  return {
    previousKg,
    regrowthKg,
    harvestKg,
    rollingBeforeManualSetKg: hasRealManualOverride ? systemKg : null,
    calculatedKg,
    effectiveKg,
    maxKg,
    pct,
    isManualOverrideActive: hasRealManualOverride,
    manualOverrideDate: hasRealManualOverride ? asOfYmd : null,
    manualOverrideKg,
    exactManualSetToday: hasRealManualOverride,
    isOpeningDay: false,
  };
}

export type InventoryDbZoneRow = {
  key: string;
  zoneConfigurationId: number | null;
  forecastZoneKey: string;
  farmId: number;
  grassId: number;
  farmName: string;
  turfgrass: string;
  zone: string;
  sizeM2: number;
  inventoryKgPerM2: number;
  maxKg: number;
  calculatedKg: number;
  currentKg: number;
  pct: number;
  manualOverrideKg: number | null;
  manualOverrideDate: string | null;
  systemKgAtManualOverride: number | null;
  isManualOverrideActive: boolean;
};

export type InventoryDbBuildResult = {
  rows: InventoryDbZoneRow[];
  overlimitByFarmProduct: Map<string, number>;
};

function toNum(v: string | number | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function resolveZoneMeta(
  zoneKey: string,
  row: DbSnapshotRow,
  zoneConfigurations: ZoneConfigurationRow[],
  forecastRows: ForecastHarvestRow[],
  asOfYmd: string,
): {
  zoneConfigurationId: number | null;
  farmId: number;
  grassId: number;
  farmName: string;
  turfgrass: string;
  zone: string;
  sizeM2: number;
  inventoryKgPerM2: number;
  maxKg: number;
} {
  const farmId = num(row.farm_id);
  const grassId = num(row.grass_id);
  const zone = String(row.zone ?? "").trim();

  const active = findActiveZoneConfiguration(zoneConfigurations, {
    farmId,
    zone,
    productId: grassId,
    ymd: asOfYmd,
  });

  if (active) {
    return {
      zoneConfigurationId: Number(active.id) || null,
      farmId: Number(active.farm_id) || farmId,
      grassId: Number(active.grass_id) || grassId,
      farmName: String(active.farm_name ?? "").trim(),
      turfgrass: String(active.turfgrass ?? "").trim(),
      zone: String(active.zone ?? "").trim(),
      sizeM2: toNum(active.size_m2),
      inventoryKgPerM2: toNum(active.inventory_kg_per_m2),
      maxKg: zoneConfigurationMaxKg(active),
    };
  }

  let farmName = "";
  let turfgrass = "";
  for (const r of forecastRows) {
    if (r.farmId !== farmId || r.productId !== grassId) continue;
    if (!farmName && r.farm) farmName = String(r.farm).trim();
    if (!turfgrass && r.grassType) turfgrass = String(r.grassType).trim();
    if (farmName && turfgrass) break;
  }

  const maxKg = Math.round(num(row.capacity_cap_kg));

  return {
    zoneConfigurationId: null,
    farmId,
    grassId,
    farmName,
    turfgrass,
    zone,
    sizeM2: 0,
    inventoryKgPerM2: 0,
    maxKg,
  };
}

function mapDbSnapshotToInventoryRow(
  row: DbSnapshotRow,
  zoneConfigurations: ZoneConfigurationRow[],
  forecastRows: ForecastHarvestRow[],
  overridesByZone: Record<string, InventoryAvailableOverrideEntry>,
  asOfYmd: string,
): InventoryDbZoneRow | null {
  const zoneKey = canonicalForecastZoneKey(String(row.zone_key ?? "").trim());
  if (!zoneKey) return null;

  const meta = resolveZoneMeta(zoneKey, row, zoneConfigurations, forecastRows, asOfYmd);
  // Trust snapshot balances from DB — same source as forecasting aggregate chart.
  const snapshotCapKg = Math.round(num(row.capacity_cap_kg));
  const maxKg = snapshotCapKg > 0 ? snapshotCapKg : meta.maxKg;
  const calculatedKg = Math.round(Math.max(0, num(row.calculated_kg ?? row.available_kg)));
  const currentKg = Math.round(Math.max(0, num(row.available_kg)));
  const pct = maxKg > 0 ? Math.round((currentKg / maxKg) * 100) : 0;

  const hasDbOverride = Boolean(row.has_manual_override);
  const exactOverride = pickInventoryOverrideForExactDate(overridesByZone, zoneKey, asOfYmd);
  const isManualOverrideActive = hasDbOverride || !!exactOverride;

  return {
    key: meta.zoneConfigurationId != null ? String(meta.zoneConfigurationId) : `db:${zoneKey}`,
    zoneConfigurationId: meta.zoneConfigurationId,
    forecastZoneKey: zoneKey,
    farmId: meta.farmId,
    grassId: meta.grassId,
    farmName: meta.farmName,
    turfgrass: meta.turfgrass,
    zone: meta.zone,
    sizeM2: meta.sizeM2,
    inventoryKgPerM2: meta.inventoryKgPerM2,
    maxKg,
    calculatedKg,
    currentKg,
    pct,
    manualOverrideKg: isManualOverrideActive
      ? Math.round(Math.max(0, exactOverride?.availableKg ?? currentKg))
      : null,
    manualOverrideDate: isManualOverrideActive ? asOfYmd : null,
    systemKgAtManualOverride: isManualOverrideActive
      ? Math.round(Math.max(0, num(exactOverride?.calculatedKg ?? row.calculated_kg ?? calculatedKg)))
      : null,
    isManualOverrideActive,
  };
}

/** Build /inventory rows from zone-level DB snapshots for one date. */
export function buildInventoryRowsFromDbSnapshots(params: {
  snapshotRows: DbSnapshotRow[];
  asOfYmd: string;
  zoneConfigurations: ZoneConfigurationRow[];
  forecastRows: ForecastHarvestRow[];
  overridesByZone: Record<string, InventoryAvailableOverrideEntry>;
}): InventoryDbBuildResult | null {
  const dayByZone = buildZoneSnapshotMapAtDate(params.snapshotRows, params.asOfYmd);
  if (dayByZone.size === 0) return null;

  const { zoneConfigurations, forecastRows, overridesByZone, asOfYmd } = params;
  const seenKeys = new Set<string>();
  const rows: InventoryDbZoneRow[] = [];

  for (const config of zoneConfigurations) {
    if (!zoneConfigIsActiveAtYmd(config, asOfYmd)) continue;
    if (isForecastExcludedZone(config.zone)) continue;
    const key = forecastZoneKeyFromParts(config.farm_id, String(config.zone ?? ""), config.grass_id);
    if (seenKeys.has(key)) continue;
    const snap = snapshotForZoneKey(dayByZone, key);
    if (!snap) continue;
    seenKeys.add(key);
    const mapped = mapDbSnapshotToInventoryRow(
      snap,
      zoneConfigurations,
      forecastRows,
      overridesByZone,
      asOfYmd,
    );
    if (mapped) rows.push(mapped);
  }

  if (rows.length === 0) {
    for (const [key, snap] of dayByZone) {
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const mapped = mapDbSnapshotToInventoryRow(
        snap,
        zoneConfigurations,
        forecastRows,
        overridesByZone,
        asOfYmd,
      );
      if (mapped) rows.push(mapped);
    }
  }

  if (rows.length === 0) return null;

  return {
    rows,
    overlimitByFarmProduct: buildOverlimitByFarmProductFromDbSnapshots(params.snapshotRows, asOfYmd),
  };
}

/** Zone daily snapshots keyed by date → zone_key (for balance breakdown). */
export function buildZoneDailySnapshotsFromDb(
  snapshotRows: DbSnapshotRow[],
  overridesByZone: Record<string, InventoryAvailableOverrideEntry>,
  dateFromYmd: string,
  dateToYmd: string,
): Map<string, Map<string, ZoneInventoryDaySnapshot>> {
  const from = normalizeYmd(dateFromYmd);
  const to = normalizeYmd(dateToYmd);
  const out = new Map<string, Map<string, ZoneInventoryDaySnapshot>>();

  for (const row of zoneLevelSnapshotRows(snapshotRows)) {
    const dateYmd = normalizeYmd(String(row.snapshot_date ?? ""));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) continue;
    if (dateYmd < from || dateYmd > to) continue;
    const zoneKey = canonicalForecastZoneKey(String(row.zone_key ?? "").trim());
    if (!zoneKey) continue;

    if (!out.has(dateYmd)) out.set(dateYmd, new Map());
    out.get(dateYmd)!.set(zoneKey, dbSnapshotToZoneInventoryDaySnapshot(row, overridesByZone, dateYmd));
  }

  return out;
}

/** Lookup today's (or any day) snapshot map by canonical forecast zone key. */
export function lookupZoneSnapshotInDayMap(
  dayMap: Map<string, ZoneInventoryDaySnapshot> | undefined,
  forecastZoneKey: string,
): ZoneInventoryDaySnapshot | undefined {
  if (!dayMap || dayMap.size === 0) return undefined;
  const canonical = canonicalForecastZoneKey(forecastZoneKey);
  if (dayMap.has(canonical)) return dayMap.get(canonical);
  for (const [key, snap] of dayMap) {
    if (forecastZoneKeysEqual(key, forecastZoneKey)) return snap;
  }
  return undefined;
}

/** Raw DB `zone_key` for API filter — matches canonical inventory row key. */
export function resolveDbZoneKeyFromSnapshotRows(
  snapshotRows: DbSnapshotRow[],
  forecastZoneKey: string,
): string | undefined {
  for (const row of zoneLevelSnapshotRows(snapshotRows)) {
    const raw = String(row.zone_key ?? "").trim();
    if (!raw) continue;
    if (forecastZoneKeysEqual(raw, forecastZoneKey)) return raw;
  }
  return undefined;
}

/** Rows for one zone (canonical match) from a snapshot list. */
export function filterSnapshotRowsForZoneKey(
  snapshotRows: DbSnapshotRow[],
  forecastZoneKey: string,
): DbSnapshotRow[] {
  return zoneLevelSnapshotRows(snapshotRows).filter((row) =>
    forecastZoneKeysEqual(String(row.zone_key ?? ""), forecastZoneKey),
  );
}

export function harvestMetaByZoneKey(
  forecastRows: ForecastHarvestRow[],
): Map<string, { farmId: number; grassId: number; farmName: string; turfgrass: string; zone: string }> {
  const meta = new Map<
    string,
    { farmId: number; grassId: number; farmName: string; turfgrass: string; zone: string }
  >();
  for (const r of forecastRows) {
    const k = forecastZoneKeyFromRow(r);
    if (!meta.has(k)) {
      meta.set(k, {
        farmId: Number(r.farmId) || 0,
        grassId: Number(r.productId) || 0,
        farmName: String(r.farm ?? "").trim(),
        turfgrass: String(r.grassType ?? "").trim(),
        zone: String(r.zone ?? "").trim(),
      });
    }
  }
  return meta;
}
