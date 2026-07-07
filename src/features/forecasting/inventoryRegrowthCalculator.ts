import {
  computeRegrowthDaysForHarvest,
  type RegrowthReferenceConfig,
} from "@/features/forecasting/forecastingRegrowth";
import type { ZoneConfigurationRow } from "@/features/admin/api/adminApi";
import type { ForecastHarvestRow } from "@/features/forecasting/forecastingTypes";
import {
  forecastHarvestRowInventoryKg,
  isForecastExcludedZone,
  isMappedForecastZoneKey,
} from "@/features/forecasting/forecastingInventoryConversion";
import { canonicalZoneBucketKey } from "@/features/forecasting/zoneKeyNormalization";

function toNum(v: string | number | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeYmd(value: string): string {
  return value.trim().slice(0, 10);
}

export function ymdFromDateLocal(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function zoneConfigYmdSlice(value: string | null | undefined): string {
  return String(value ?? "").trim().slice(0, 10);
}

/** True when the row defines an explicit validity window (either boundary set). */
export function zoneConfigHasPeriod(input: {
  effective_from?: string | null;
  effective_to?: string | null;
}): boolean {
  return Boolean(zoneConfigYmdSlice(input.effective_from) || zoneConfigYmdSlice(input.effective_to));
}

/** Period rows only: inclusive yyyy-MM-dd window. Always-on rows (no dates) return false here. */
export function zoneConfigCoversYmd(row: ZoneConfigurationRow, ymd: string): boolean {
  const from = zoneConfigYmdSlice(row.effective_from);
  const to = zoneConfigYmdSlice(row.effective_to);
  if (!from && !to) return false;
  if (from && ymd < from) return false;
  if (to && ymd > to) return false;
  return true;
}

/** Active at `ymd`: always-on configs apply throughout; period configs only inside their window. */
export function zoneConfigIsActiveAtYmd(row: ZoneConfigurationRow, ymd: string): boolean {
  if (!zoneConfigHasPeriod(row)) return true;
  return zoneConfigCoversYmd(row, ymd);
}

/** Inclusive overlap between two setup windows (open-ended bounds use sentinels). */
export function zoneConfigPeriodsOverlap(
  a: { effective_from?: string | null; effective_to?: string | null },
  b: { effective_from?: string | null; effective_to?: string | null },
): boolean {
  const aFrom = zoneConfigYmdSlice(a.effective_from) || "0000-01-01";
  const aTo = zoneConfigYmdSlice(a.effective_to) || "9999-12-31";
  const bFrom = zoneConfigYmdSlice(b.effective_from) || "0000-01-01";
  const bTo = zoneConfigYmdSlice(b.effective_to) || "9999-12-31";
  return aFrom <= bTo && bFrom <= aTo;
}

export function zoneConfigIsActiveAtDate(row: ZoneConfigurationRow, date: Date): boolean {
  return zoneConfigIsActiveAtYmd(row, ymdFromDateLocal(date));
}

export function zoneConfigurationMaxKg(row: ZoneConfigurationRow): number {
  const sizeM2 = toNum(row.size_m2);
  const inventoryKgPerM2 = toNum(row.inventory_kg_per_m2);
  const maxKgRaw = toNum(row.max_inventory_kg);
  return maxKgRaw > 0 ? maxKgRaw : sizeM2 * inventoryKgPerM2;
}

function normalizeZoneForConfigMatch(zone: string): string {
  return canonicalZoneBucketKey(zone);
}

function zoneConfigBucketKey(zone: string): string {
  return canonicalZoneBucketKey(zone);
}

function zoneConfigsMatchingIdentity(
  zoneConfigs: ZoneConfigurationRow[],
  params: { farmId?: number; zone: string; productId?: number },
): ZoneConfigurationRow[] {
  const z = zoneConfigBucketKey(params.zone);
  const farm = Number.isFinite(params.farmId ?? NaN) ? Number(params.farmId) : undefined;
  const productIdNorm = Number.isFinite(params.productId ?? NaN) ? Number(params.productId) : undefined;
  if (productIdNorm === undefined) return [];

  return zoneConfigs.filter((row) => {
    if (Number(row.grass_id) !== productIdNorm) return false;
    if (zoneConfigBucketKey(String(row.zone ?? "")) !== z) return false;
    if (farm !== undefined && Number(row.farm_id) !== farm) return false;
    return true;
  });
}

/**
 * Resolve the zone setup that applies on `ymd`.
 * Period-specific rows win over always-on rows; overlapping periods prefer the latest `effective_from`.
 */
export function findActiveZoneConfiguration(
  zoneConfigs: ZoneConfigurationRow[],
  params: { farmId?: number; zone: string; productId?: number; ymd: string },
): ZoneConfigurationRow | null {
  const matches = zoneConfigsMatchingIdentity(zoneConfigs, params);
  if (matches.length === 0) return null;

  const periodMatches = matches
    .filter((row) => zoneConfigHasPeriod(row) && zoneConfigCoversYmd(row, params.ymd))
    .sort((a, b) =>
      zoneConfigYmdSlice(b.effective_from).localeCompare(zoneConfigYmdSlice(a.effective_from)),
    );
  if (periodMatches.length > 0) return periodMatches[0] ?? null;

  return matches.find((row) => !zoneConfigHasPeriod(row)) ?? null;
}

function parseYmdLocal(ymd: string): Date | null {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function rowInventoryKg(row: ForecastHarvestRow): number {
  return forecastHarvestRowInventoryKg(row);
}

function rowZoneMaxKg(row: ForecastHarvestRow): number {
  const n = Number(row.zoneMaxInventoryKg);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Same key shape everywhere harvest rows meet zone config / capacity maps (matches forecast UI). */
export function forecastZoneKeyFromParts(
  farmId: number,
  zone: string | undefined,
  productId: number,
): string {
  return `${farmId}|${canonicalZoneBucketKey(String(zone ?? ""))}|${productId}`;
}

/** Normalize legacy keys (`1|1|5`) and canonical keys (`1|zid:1|5`) to one form. */
export function canonicalForecastZoneKey(zoneKey: string): string {
  const parts = String(zoneKey ?? "").split("|");
  if (parts.length !== 3) return String(zoneKey ?? "");
  const farmId = Number(parts[0]);
  const productId = Number(parts[2]);
  const zoneSeg = String(parts[1] ?? "").trim();
  if (!Number.isFinite(farmId) || !Number.isFinite(productId)) {
    return String(zoneKey ?? "");
  }
  if (zoneSeg.startsWith("zid:") || zoneSeg.startsWith("zlabel:")) {
    return `${farmId}|${zoneSeg}|${productId}`;
  }
  return forecastZoneKeyFromParts(farmId, zoneSeg, productId);
}

export function forecastZoneKeysEqual(a: string, b: string): boolean {
  return canonicalForecastZoneKey(a) === canonicalForecastZoneKey(b);
}

export function forecastZoneKeyFromRow(row: ForecastHarvestRow): string {
  return forecastZoneKeyFromParts(row.farmId, row.zone, row.productId);
}

/**
 * `rowsToMockHarvestRows` tách một plan thành nhiều dòng theo zone (`1612~z0`, `1612~z1`…).
 * Hàm này trả về id plan gốc để gộp hiển thị / nhóm theo một đợt gặt.
 */
export function forecastLogicalPlanRowId(rowId: string): string {
  return String(rowId ?? "").replace(/~z\d+$/u, "");
}

export function getRegrowthDateFromHarvest(
  row: ForecastHarvestRow,
  regrowthConfig: RegrowthReferenceConfig,
): Date | null {
  const harvestDate = parseYmdLocal(normalizeYmd(row.harvestDate));
  if (!harvestDate) return null;
  return addDays(harvestDate, computeRegrowthDaysForHarvest(regrowthConfig, row));
}

export function computeZoneCapacityMap(rows: ForecastHarvestRow[]): Map<string, number> {
  const byZone = new Map<string, number>();
  for (const row of rows) {
    if (isForecastExcludedZone(row.zone)) continue;
    const key = forecastZoneKeyFromRow(row);
    if (!isMappedForecastZoneKey(key)) continue;
    const maxKg = rowZoneMaxKg(row);
    if (maxKg <= 0) continue;
    byZone.set(key, Math.max(byZone.get(key) ?? 0, maxKg));
  }
  return byZone;
}

/** Max kg per zone from active `sts_zone_configurations` at `asOf` (same keys as harvest rows). */
export function buildZoneConfigurationCapacityMapAtDate(
  rows: ZoneConfigurationRow[],
  asOf: Date | string,
): Map<string, number> {
  const ymd = typeof asOf === "string" ? normalizeYmd(asOf) : ymdFromDateLocal(asOf);
  const out = new Map<string, number>();
  const seenKeys = new Set<string>();

  for (const row of rows) {
    if (!zoneConfigIsActiveAtYmd(row, ymd)) continue;
    if (isForecastExcludedZone(row.zone)) continue;
    const key = forecastZoneKeyFromParts(row.farm_id, String(row.zone ?? ""), row.grass_id);
    if (!isMappedForecastZoneKey(key)) continue;
    if (seenKeys.has(key)) continue;

    const active = findActiveZoneConfiguration(rows, {
      farmId: Number(row.farm_id),
      zone: String(row.zone ?? ""),
      productId: Number(row.grass_id),
      ymd,
    });
    if (!active) continue;

    seenKeys.add(key);
    const maxKg = zoneConfigurationMaxKg(active);
    if (maxKg > 0) out.set(key, maxKg);
  }

  return out;
}

/** Max kg per zone from `sts_zone_configurations` (same keys as harvest / manual balance rows). */
export function buildZoneConfigurationCapacityMap(
  rows: ZoneConfigurationRow[],
): Map<string, number> {
  return buildZoneConfigurationCapacityMapAtDate(rows, new Date());
}

/** Harvest-derived caps merged with zone configuration caps (used by inventory + forecasting). */
export function mergeZoneCapacityMaps(
  harvestCaps: Map<string, number>,
  configCaps: Map<string, number>,
): Map<string, number> {
  const out = new Map<string, number>(harvestCaps);
  for (const [key, maxKg] of configCaps) {
    out.set(key, Math.max(out.get(key) ?? 0, maxKg));
  }
  return out;
}

/**
 * Tổng trần kg (max) trên tất cả các zone-key có cấu hình cho cùng farm + product,
 * không gồm bucket `nozone` (dùng cho giải thích UI vs tổng tái sinh).
 */
export function sumConfiguredZoneCapKgForFarmProduct(
  maxByZone: Map<string, number>,
  farmId: number,
  productId: number,
): number {
  const prefix = `${farmId}|`;
  const suffix = `|${productId}`;
  let sum = 0;
  for (const [key, max] of maxByZone) {
    if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
    const zoneSeg = key.slice(prefix.length, key.length - suffix.length);
    if (isForecastExcludedZone(zoneSeg)) continue;
    const n = Number(max);
    if (Number.isFinite(n) && n > 0) sum += n;
  }
  return sum;
}

/** True when zone-config has at least one mapped (non–no-zone) row for farm + grass on `ymd`. */
export function farmProductHasMappedZoneConfigAtYmd(
  zoneConfigs: ZoneConfigurationRow[],
  farmId: number,
  productId: number,
  ymd: string,
): boolean {
  for (const row of zoneConfigs) {
    if (!zoneConfigIsActiveAtYmd(row, ymd)) continue;
    if (Number(row.farm_id) !== farmId || Number(row.grass_id) !== productId) continue;
    if (isForecastExcludedZone(row.zone)) continue;
    return true;
  }
  return false;
}

/** Capacity keys for forecasting / inventory series — zone-config only (never harvest row fallback). */
export function mergeZoneCapacityMapsAtDate(
  _rows: ForecastHarvestRow[],
  zoneConfigs: ZoneConfigurationRow[],
  asOf: Date | string,
): Map<string, number> {
  return zoneConfigs.length > 0
    ? buildZoneConfigurationCapacityMapAtDate(zoneConfigs, asOf)
    : new Map();
}

/**
 * Same idea as Harvesting Portal `computeInventory`: while a harvest is still within its
 * regrowth window, it depletes `maxInventoryKg` by `inventoryKg * (1 - progress)`.
 * Fully recovered harvests (`regrowDate <= asOf`) contribute 0 depletion.
 */
export function computeDepletedKgByZoneAtDate(
  rows: ForecastHarvestRow[],
  regrowthConfig: RegrowthReferenceConfig,
  asOf: Date,
): Map<string, number> {
  const depleted = new Map<string, number>();
  const todayMs = new Date(
    asOf.getFullYear(),
    asOf.getMonth(),
    asOf.getDate(),
  ).getTime();

  for (const h of rows) {
    if (isForecastExcludedZone(h.zone)) continue;
    const harvestDate = parseYmdLocal(normalizeYmd(h.harvestDate));
    if (!harvestDate) continue;
    const regrowDays = computeRegrowthDaysForHarvest(regrowthConfig, h);
    if (!Number.isFinite(regrowDays) || regrowDays <= 0) continue;
    const regrowDate = addDays(harvestDate, regrowDays);
    const key = forecastZoneKeyFromRow(h);
    if (!isMappedForecastZoneKey(key)) continue;
    if (regrowDate.getTime() <= todayMs) continue;
    const elapsedDays = (todayMs - harvestDate.getTime()) / (1000 * 60 * 60 * 24);
    const progress = Math.min(Math.max(elapsedDays / regrowDays, 0), 1);
    const d = rowInventoryKg(h) * (1 - progress);
    depleted.set(key, (depleted.get(key) ?? 0) + d);
  }
  return depleted;
}

function collectFarmProductKeysAtYmd(
  forecastRows: ForecastHarvestRow[],
  zoneConfigs: ZoneConfigurationRow[],
  ymd: string,
  farmProductFilter?: (farmId: number, productId: number) => boolean,
): Set<string> {
  const keys = new Set<string>();
  for (const row of zoneConfigs) {
    if (!zoneConfigIsActiveAtYmd(row, ymd)) continue;
    if (isForecastExcludedZone(row.zone)) continue;
    const farmId = Number(row.farm_id);
    const productId = Number(row.grass_id);
    if (!Number.isFinite(farmId) || !Number.isFinite(productId) || farmId <= 0 || productId <= 0) {
      continue;
    }
    if (farmProductFilter && !farmProductFilter(farmId, productId)) continue;
    keys.add(`${farmId}|${productId}`);
  }
  for (const row of forecastRows) {
    if (row.farmId <= 0 || row.productId <= 0) continue;
    if (isForecastExcludedZone(row.zone)) continue;
    if (farmProductFilter && !farmProductFilter(row.farmId, row.productId)) continue;
    if (!farmProductHasMappedZoneConfigAtYmd(zoneConfigs, row.farmId, row.productId, ymd)) {
      continue;
    }
    const zoneKey = forecastZoneKeyFromRow(row);
    if (!isMappedForecastZoneKey(zoneKey)) continue;
    keys.add(`${row.farmId}|${row.productId}`);
  }
  return keys;
}

/** Σ zone-config max kg for distinct farm+grass groups active on `asOf` (excl. nozone). */
export function sumFarmProductCapacityCapsFromZoneConfigAtDate(
  zoneConfigs: ZoneConfigurationRow[],
  asOf: Date,
  farmProductFilter?: (farmId: number, productId: number) => boolean,
): number {
  const ymd = ymdFromDateLocal(asOf);
  const configCaps = buildZoneConfigurationCapacityMapAtDate(zoneConfigs, asOf);
  const keys = collectFarmProductKeysAtYmd([], zoneConfigs, ymd, farmProductFilter);
  let sum = 0;
  for (const key of keys) {
    const [farmIdStr, productIdStr] = key.split("|");
    sum += sumConfiguredZoneCapKgForFarmProduct(
      configCaps,
      Number(farmIdStr),
      Number(productIdStr),
    );
  }
  return sum;
}
