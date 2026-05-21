import {
  computeRegrowthDaysForHarvest,
  type RegrowthReferenceConfig,
} from "@/features/forecasting/forecastingRegrowth";
import type { ZoneConfigurationRow } from "@/features/admin/api/adminApi";
import type { ForecastHarvestRow } from "@/features/forecasting/forecastingTypes";

function toNum(v: string | number | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeYmd(value: string): string {
  return value.trim().slice(0, 10);
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
  return Number.isFinite(row.inventoryKg) ? row.inventoryKg : row.quantity;
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
  return `${farmId}|${String(zone ?? "").trim().toLowerCase()}|${productId}`;
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
    const key = forecastZoneKeyFromRow(row);
    const maxKg = rowZoneMaxKg(row);
    if (maxKg <= 0) continue;
    byZone.set(key, Math.max(byZone.get(key) ?? 0, maxKg));
  }
  return byZone;
}

/** Max kg per zone from `sts_zone_configurations` (same keys as harvest / manual balance rows). */
export function buildZoneConfigurationCapacityMap(
  rows: ZoneConfigurationRow[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const sizeM2 = toNum(row.size_m2);
    const inventoryKgPerM2 = toNum(row.inventory_kg_per_m2);
    const maxKgRaw = toNum(row.max_inventory_kg);
    const maxKg = maxKgRaw > 0 ? maxKgRaw : sizeM2 * inventoryKgPerM2;
    const key = forecastZoneKeyFromParts(row.farm_id, String(row.zone ?? ""), row.grass_id);
    out.set(key, Math.max(out.get(key) ?? 0, maxKg));
  }
  return out;
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
    if (zoneSeg === "nozone") continue;
    const n = Number(max);
    if (Number.isFinite(n) && n > 0) sum += n;
  }
  return sum;
}

export function computeCappedAvailableByZoneAtDate(
  rows: ForecastHarvestRow[],
  regrowthConfig: RegrowthReferenceConfig,
  forecastDate: Date,
): Map<string, number> {
  const rawByZone = new Map<string, number>();
  const maxByZone = computeZoneCapacityMap(rows);

  for (const h of rows) {
    const regrowDate = getRegrowthDateFromHarvest(h, regrowthConfig);
    if (!regrowDate || regrowDate > forecastDate) continue;
    const key = forecastZoneKeyFromRow(h);
    rawByZone.set(key, (rawByZone.get(key) ?? 0) + rowInventoryKg(h));
  }

  const out = new Map<string, number>();
  for (const [key, raw] of rawByZone) {
    const max = maxByZone.get(key) ?? 0;
    out.set(key, max > 0 ? Math.min(raw, max) : Math.max(0, raw));
  }
  return out;
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
    const harvestDate = parseYmdLocal(normalizeYmd(h.harvestDate));
    if (!harvestDate) continue;
    const regrowDays = computeRegrowthDaysForHarvest(regrowthConfig, h);
    if (!Number.isFinite(regrowDays) || regrowDays <= 0) continue;
    const regrowDate = addDays(harvestDate, regrowDays);
    const key = forecastZoneKeyFromRow(h);
    if (regrowDate.getTime() <= todayMs) continue;
    const elapsedDays = (todayMs - harvestDate.getTime()) / (1000 * 60 * 60 * 24);
    const progress = Math.min(Math.max(elapsedDays / regrowDays, 0), 1);
    const d = rowInventoryKg(h) * (1 - progress);
    depleted.set(key, (depleted.get(key) ?? 0) + d);
  }
  return depleted;
}
