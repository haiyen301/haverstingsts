import type { ZoneConfigurationRow } from "@/features/admin/api/adminApi";
import {
  canonicalZoneBucketKey,
  FORECAST_NOZONE_ZONE,
  isForecastNoZoneBucketKey,
} from "@/features/forecasting/zoneKeyNormalization";
import {
  findActiveZoneConfiguration,
  ymdFromDateLocal,
} from "@/features/forecasting/inventoryRegrowthCalculator";
import { isValidHarvestDateString } from "@/shared/lib/harvestPlanDates";
import { normalizeHarvestTypeStorageKey } from "@/shared/lib/harvestType";
import type { ForecastHarvestRow } from "./forecastingTypes";

export const DEFAULT_FALLBACK_INVENTORY_KG_PER_M2 = 1;
/** @deprecated Do not use for capacity / chart — only zone-config caps apply. Kept as 0. */
export const DEFAULT_FALLBACK_MAX_INVENTORY_KG = 0;

/**
 * Helper quy đổi m² → kg dựa trên Zone Configuration.
 *
 * Đầu vào là 1 raw harvesting plan row (như từ harvesting index API)
 * cùng với danh sách cấu hình zone hiện tại.
 *
 * Nếu UOM đã là kg thì trả lại quantity gốc.
 * Nếu là m² mà không match config thì vẫn convert theo fallback mặc định.
 */
export function convertPlanRowQuantityToKgFromZones(params: {
  rawPlanRow: Record<string, unknown>;
  zoneConfigs: ZoneConfigurationRow[];
}): {
  quantityKg: number;
  isCapped: boolean;
  usedConfig: ZoneConfigurationRow | null;
  maxInventoryKgUsed: number;
} {
  const { rawPlanRow, zoneConfigs } = params;

  const farmId = toNumber(rawPlanRow.farm_id);
  const productId = harvestPlanProductIdFromRaw(rawPlanRow);
  const zone = String(rawPlanRow.zone ?? "").trim();
  const canTryMatch = !!zone && !!productId;
  const config = canTryMatch
    ? findBestZoneConfigMatch({
        zoneConfigs,
        farmId,
        zone,
        productId,
      })
    : null;
  const maxInventoryKgUsed = config
    ? normalizeMaxInventoryKg(toNumber(config.max_inventory_kg))
    : 0;

  const requestedKg = harvestPlanInventoryKgFromRaw(rawPlanRow, { zoneConfigs });
  const finalKg =
    maxInventoryKgUsed > 0 ? Math.min(requestedKg, maxInventoryKgUsed) : requestedKg;

  return {
    quantityKg: finalKg,
    isCapped: requestedKg > maxInventoryKgUsed,
    usedConfig: config,
    maxInventoryKgUsed,
  };
}

function normalizeMaxInventoryKg(v: number): number {
  return v > 0 ? v : 0;
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v == null) return 0;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function harvestQuantityCellPresent(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "number") return Number.isFinite(v);
  return String(v).trim() !== "";
}

/**
 * Parse plan scalars from harvesting index JSON. Removes grouping commas so `"2,000"` → 2000
 * (unlike {@link toNumber}, which treats a single comma as a decimal separator).
 */
export function harvestPlanScalarFromRaw(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  const s = String(raw ?? "").trim();
  if (!s) return 0;
  const n = Number.parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Resolve harvest quantity from `quantity` or nullable split columns (`quantity_kg` / `quantity_m2`).
 */
export function harvestPlanQuantityFromRaw(rawPlanRow: Record<string, unknown>): number {
  if (harvestQuantityCellPresent(rawPlanRow.quantity)) {
    return harvestPlanScalarFromRaw(rawPlanRow.quantity);
  }
  if (harvestQuantityCellPresent(rawPlanRow.quantity_kg)) {
    return harvestPlanScalarFromRaw(rawPlanRow.quantity_kg);
  }
  if (harvestQuantityCellPresent(rawPlanRow.quantity_m2)) {
    return harvestPlanScalarFromRaw(rawPlanRow.quantity_m2);
  }
  return 0;
}

export function resolvePlanRowUomFromRaw(rawPlanRow: Record<string, unknown>): string {
  return String(
    rawPlanRow.uom ??
      rawPlanRow.UOM ??
      rawPlanRow.unit ??
      rawPlanRow.Unit ??
      rawPlanRow.quantity_uom ??
      rawPlanRow.quantityUom ??
      "",
  ).trim();
}

function planRowHarvestTypeKeyFromRaw(
  rawPlanRow: Record<string, unknown>,
): ReturnType<typeof normalizeHarvestTypeStorageKey> | null {
  const candidates = [
    rawPlanRow.harvest_type,
    rawPlanRow.load_type,
    rawPlanRow.turf_type,
    rawPlanRow.type,
  ];
  return candidates.map((v) => normalizeHarvestTypeStorageKey(v)).find(Boolean) ?? null;
}

export function resolvePlanRowHarvestTypeForForecast(
  rawPlanRow: Record<string, unknown>,
): "sod" | "sprig" | "sod_for_sprig" {
  const key = planRowHarvestTypeKeyFromRaw(rawPlanRow);
  if (key === "sod_to_sprig") return "sod_for_sprig";
  if (key === "sprig") return "sprig";
  if (key === "sod") return "sod";
  if (isKgUom(resolvePlanRowUomFromRaw(rawPlanRow))) return "sprig";
  return "sod";
}

/** Sprig/Kg plan with only `estimated_harvest_date` (no actual harvest yet). */
export function isSprigKgEstimateOnlyPlanRow(
  rawPlanRow: Record<string, unknown>,
): boolean {
  if (resolvePlanRowHarvestTypeForForecast(rawPlanRow) !== "sprig") return false;
  if (!isKgUom(resolvePlanRowUomFromRaw(rawPlanRow))) return false;
  if (isValidHarvestDateString(rawPlanRow.actual_harvest_date)) return false;
  return isValidHarvestDateString(rawPlanRow.estimated_harvest_date);
}

/** Sprig/Kg forecast row not yet harvested (estimate / effective date only). */
export function isSprigKgEstimateOnlyForecastRow(row: ForecastHarvestRow): boolean {
  if (row.harvestType !== "sprig") return false;
  if (!isKgUom(String(row.uom ?? ""))) return false;
  if (isValidHarvestDateString(row.actualHarvestDate)) return false;
  return isValidHarvestDateString(row.harvestDate);
}

/** Sprig estimate-only: Yield (kg/m²) by farm + grass only — same across all zones. */
function resolveFarmGrassYieldKgPerM2FromZoneConfig(
  zoneConfigs: ZoneConfigurationRow[],
  farmId: number,
  productId: number,
): number {
  if (farmId <= 0 || productId <= 0 || !zoneConfigs.length) return 0;

  for (const cfg of zoneConfigs) {
    if (Number(cfg.farm_id) !== farmId || Number(cfg.grass_id) !== productId) {
      continue;
    }
    if (isForecastExcludedZone(String(cfg.zone ?? ""))) continue;
    const yieldKgPerM2 = toNumber(cfg.inventory_kg_per_m2);
    if (yieldKgPerM2 > 0) return yieldKgPerM2;
  }

  return 0;
}

/**
 * Resolve kg/m² for forecast/regrowth:
 * - Sprig/Kg + estimate only → **only** Zone Configuration Yield (farm + grass); no fallbacks
 * - Sprig/Kg + actual date → `quantity ÷ harvested_area` (legacy)
 * - Otherwise → API `kg_per_m2`, then generic fallbacks
 */
export function resolveForecastPlanRowKgPerM2(
  rawPlanRow: Record<string, unknown>,
  harvestType: "sod" | "sprig" | "sod_for_sprig",
  options: {
    zoneConfigs?: ZoneConfigurationRow[];
    harvestedAreaM2?: number;
    inventoryKgEst?: number;
  } = {},
): number {
  const zoneConfigs = options.zoneConfigs ?? [];

  /** Estimate only: zone-config Yield only — never API `kg_per_m2` or quantity÷area. */
  if (isSprigKgEstimateOnlyPlanRow(rawPlanRow)) {
    if (zoneConfigs.length === 0) return 0;
    const farmId = toNumber(rawPlanRow.farm_id);
    const productId = harvestPlanProductIdFromRaw(rawPlanRow);
    return resolveFarmGrassYieldKgPerM2FromZoneConfig(
      zoneConfigs,
      farmId,
      productId,
    );
  }

  const kgPerM2Raw = Number(rawPlanRow.kg_per_m2);
  if (Number.isFinite(kgPerM2Raw) && kgPerM2Raw > 0) return kgPerM2Raw;

  const harvestedAreaM2 =
    options.harvestedAreaM2 ?? harvestPlanHarvestedAreaFromRaw(rawPlanRow);
  const isSprigKg =
    harvestType === "sprig" && isKgUom(resolvePlanRowUomFromRaw(rawPlanRow));
  const hasActualHarvestDate = isValidHarvestDateString(
    rawPlanRow.actual_harvest_date,
  );

  /** Actual harvest: Sprig/Kg always uses plan quantity ÷ harvested area (m²). */
  if (isSprigKg && hasActualHarvestDate) {
    if (harvestedAreaM2 > 0) {
      return harvestPlanQuantityFromRaw(rawPlanRow) / harvestedAreaM2;
    }
    return 0;
  }

  const inventoryKgEst =
    options.inventoryKgEst ??
    harvestPlanInventoryKgFromRaw(rawPlanRow, { zoneConfigs });

  if (harvestedAreaM2 > 0 && inventoryKgEst > 0) {
    return inventoryKgEst / harvestedAreaM2;
  }
  if (harvestType === "sprig" && harvestedAreaM2 > 0) {
    return harvestPlanQuantityFromRaw(rawPlanRow) / harvestedAreaM2;
  }

  return 0;
}

function planRowHasNoHarvestZone(rawPlanRow: Record<string, unknown>): boolean {
  const planZoneNorm = normalizeZone(String(rawPlanRow.zone ?? ""));
  return !planZoneNorm || isForecastNoZoneBucketKey(planZoneNorm);
}

/**
 * kg/m² from zone **1** when the harvest plan has no zone (not an average of all zones).
 */
export function resolveZone1InventoryKgPerM2(params: {
  zoneConfigs: ZoneConfigurationRow[];
  farmId: number;
  productId: number;
  buckets?: Map<string, ZoneBucket>;
}): number | null {
  const { zoneConfigs, farmId, productId, buckets } = params;
  if (farmId <= 0 || productId <= 0) return null;

  const bucketKg = (key: string): number | null => {
    const b = buckets?.get(key);
    return b && b.kgPerM2 > 0 ? b.kgPerM2 : null;
  };

  const direct =
    bucketKg("zid:1") ??
    bucketKg("1") ??
    bucketKg("zone-1") ??
    bucketKg("zone 1");
  if (direct != null) return direct;

  if (buckets) {
    for (const [key, b] of buckets) {
      if (isForecastNoZoneBucketKey(key)) continue;
      if (zoneKeySortRankForDistribute(key) === 1 && b.kgPerM2 > 0) return b.kgPerM2;
      const raw = normalizeZone(b.zoneRaw);
      if (
        (raw === "1" || raw === "zone 1" || raw === "z1") &&
        b.kgPerM2 > 0
      ) {
        return b.kgPerM2;
      }
    }
  }

  for (const cfg of zoneConfigs) {
    if (Number(cfg.farm_id) !== farmId || Number(cfg.grass_id) !== productId) continue;
    const zoneRaw = String(cfg.zone ?? "").trim();
    const norm = normalizeZone(zoneRaw);
    if (isForecastNoZoneBucketKey(norm)) continue;
    const key = forecastZoneBucketKey(norm);
    if (zoneKeySortRankForDistribute(key) !== 1) continue;
    const k = toNumber(cfg.inventory_kg_per_m2);
    return k > 0 ? k : DEFAULT_FALLBACK_INVENTORY_KG_PER_M2;
  }

  return null;
}

function resolveInventoryKgPerM2ForPlanRow(params: {
  rawPlanRow: Record<string, unknown>;
  zoneConfigs: ZoneConfigurationRow[];
  buckets?: Map<string, ZoneBucket>;
}): number {
  const { rawPlanRow, zoneConfigs, buckets } = params;
  const planZoneNorm = normalizeZone(String(rawPlanRow.zone ?? ""));
  const planBucketKey = planZoneNorm ? forecastZoneBucketKey(planZoneNorm) : "";
  const farmId = toNumber(rawPlanRow.farm_id);
  const productId = harvestPlanProductIdFromRaw(rawPlanRow);

  if (planRowHasNoHarvestZone(rawPlanRow) && farmId > 0 && productId > 0) {
    const zone1Kg = resolveZone1InventoryKgPerM2({
      zoneConfigs,
      farmId,
      productId,
      buckets,
    });
    if (zone1Kg != null && zone1Kg > 0) return zone1Kg;
  }

  if (planZoneNorm && planBucketKey && buckets?.has(planBucketKey)) {
    const k = buckets.get(planBucketKey)!.kgPerM2;
    return k > 0 ? k : DEFAULT_FALLBACK_INVENTORY_KG_PER_M2;
  }

  const match = findBestZoneConfigMatch({
    zoneConfigs,
    farmId,
    zone: String(rawPlanRow.zone ?? ""),
    productId,
  });
  if (match) {
    const k = toNumber(match.inventory_kg_per_m2);
    return k > 0 ? k : DEFAULT_FALLBACK_INVENTORY_KG_PER_M2;
  }
  return DEFAULT_FALLBACK_INVENTORY_KG_PER_M2;
}

/**
 * Kg dùng trừ tồn / forecast (trước cap `max_inventory_kg`).
 * Sod / Sod→Sprig / M²: harvested_area × zone kg/m²; Sprig/Kg: plan `quantity`.
 */
export function harvestPlanInventoryKgFromRaw(
  rawPlanRow: Record<string, unknown>,
  options: {
    zoneConfigs?: ZoneConfigurationRow[];
    buckets?: Map<string, ZoneBucket>;
  } = {},
): number {
  const uom = resolvePlanRowUomFromRaw(rawPlanRow);
  const rawQty = harvestPlanEffectiveMagnitudeFromRaw(rawPlanRow);

  /** Sod / M² plans: always m² × zone kg/m² (even when UOM column is blank or non-m²). */
  if (planRowUsesHarvestedAreaForMagnitude(rawPlanRow)) {
    const kgPerM2 = resolveInventoryKgPerM2ForPlanRow({
      rawPlanRow,
      zoneConfigs: options.zoneConfigs ?? [],
      buckets: options.buckets,
    });
    return Math.max(0, rawQty * kgPerM2);
  }

  if (isKgUom(uom)) return Math.max(0, rawQty);
  return Math.max(0, rawQty);
}

/** Sod / Sod -> Sprig / M² plans use `harvested_area` for inventory & regrowth magnitude (not `quantity`). */
export function planRowUsesHarvestedAreaForMagnitude(
  rawPlanRow: Record<string, unknown>,
): boolean {
  if (isM2Uom(resolvePlanRowUomFromRaw(rawPlanRow))) return true;
  const harvestType = planRowHarvestTypeKeyFromRaw(rawPlanRow);
  return harvestType === "sod" || harvestType === "sod_to_sprig";
}

export function harvestPlanHarvestedAreaFromRaw(
  rawPlanRow: Record<string, unknown>,
): number {
  const fromHarvestedArea = harvestQuantityCellPresent(rawPlanRow.harvested_area)
    ? harvestPlanScalarFromRaw(rawPlanRow.harvested_area)
    : 0;
  if (fromHarvestedArea > 0) return fromHarvestedArea;

  /** Sod / Sod→Sprig: `harvested_area` trống → dùng `quantity` (m²) làm diện tích thu hoạch. */
  const harvestType = planRowHarvestTypeKeyFromRaw(rawPlanRow);
  if (harvestType === "sod" || harvestType === "sod_to_sprig") {
    return Math.max(0, harvestPlanQuantityFromRaw(rawPlanRow));
  }

  if (harvestQuantityCellPresent(rawPlanRow.quantity_m2)) {
    return Math.max(0, harvestPlanScalarFromRaw(rawPlanRow.quantity_m2));
  }
  const uom = resolvePlanRowUomFromRaw(rawPlanRow);
  if (isM2Uom(uom) && harvestQuantityCellPresent(rawPlanRow.quantity)) {
    return Math.max(0, harvestPlanScalarFromRaw(rawPlanRow.quantity));
  }
  return 0;
}

/**
 * Magnitude used for m²→kg conversion, zone spread, and M² regrowth totals.
 * Sprig (Kg) keeps `quantity`; Sod / Sod -> Sprig / M² UOM use `harvested_area` only.
 */
export function harvestPlanEffectiveMagnitudeFromRaw(
  rawPlanRow: Record<string, unknown>,
): number {
  if (planRowUsesHarvestedAreaForMagnitude(rawPlanRow)) {
    return harvestPlanHarvestedAreaFromRaw(rawPlanRow);
  }
  return harvestPlanQuantityFromRaw(rawPlanRow);
}

export function forecastHarvestRowUsesHarvestedAreaForMagnitude(
  row: ForecastHarvestRow,
): boolean {
  if (row.harvestType === "sod" || row.harvestType === "sod_for_sprig") return true;
  return isM2Uom(String(row.uom ?? ""));
}

/** m² basis for display / tooltip when plan is Sod or M² UOM. */
export function forecastHarvestRowEffectiveM2(row: ForecastHarvestRow): number {
  if (!forecastHarvestRowUsesHarvestedAreaForMagnitude(row)) return 0;
  if (Number.isFinite(row.harvestedAreaM2) && row.harvestedAreaM2 > 0) {
    return row.harvestedAreaM2;
  }
  return Number.isFinite(row.quantity) && row.quantity > 0 ? row.quantity : 0;
}

/**
 * Plan `quantity` (kg) — chỉ Sprig / UOM Kg.
 * Sod / Sod→Sprig / M²: luôn 0 (không đọc cột quantity plan).
 */
export function forecastHarvestRowPlanQuantityKg(row: ForecastHarvestRow): number {
  if (forecastHarvestRowUsesHarvestedAreaForMagnitude(row)) return 0;
  return Number.isFinite(row.quantity) && row.quantity > 0 ? row.quantity : 0;
}

/**
 * Kg dùng trừ tồn / biểu đồ / daily calendar: ưu tiên `inventoryKg` đã convert.
 * Sod / Sod→Sprig / M²: fallback m² × Yield (kg/m²) khi `inventoryKg` chưa được gán.
 * Sprig fallback `quantity` (kg).
 */
export function resolveForecastHarvestRowInventoryKgPerM2(
  row: ForecastHarvestRow,
  zoneConfigs?: ZoneConfigurationRow[],
): number {
  if (Number.isFinite(row.kgPerM2) && row.kgPerM2! > 0) return row.kgPerM2!;

  if (zoneConfigs?.length && row.farmId > 0 && row.productId > 0) {
    const buckets = aggregateBucketsForFarmGrass(zoneConfigs, row.farmId, row.productId);
    const zoneNorm = normalizeZone(String(row.zone ?? ""));
    const bucketKey = zoneNorm ? forecastZoneBucketKey(zoneNorm) : "";
    if (bucketKey && buckets.has(bucketKey)) {
      const k = buckets.get(bucketKey)!.kgPerM2;
      if (k > 0) return k;
    }
    const match = findBestZoneConfigMatch({
      zoneConfigs,
      farmId: row.farmId,
      zone: String(row.zone ?? ""),
      productId: row.productId,
    });
    if (match) {
      const k = toNumber(match.inventory_kg_per_m2);
      if (k > 0) return k;
    }
    const farmGrass = resolveFarmGrassYieldKgPerM2FromZoneConfig(
      zoneConfigs,
      row.farmId,
      row.productId,
    );
    if (farmGrass > 0) return farmGrass;
  }

  const m2 = forecastHarvestRowEffectiveM2(row);
  const storedKg = Number.isFinite(row.inventoryKg) ? row.inventoryKg : 0;
  if (m2 > 0 && storedKg > 0) return storedKg / m2;

  return DEFAULT_FALLBACK_INVENTORY_KG_PER_M2;
}

export function forecastHarvestRowInventoryKg(
  row: ForecastHarvestRow,
  options?: { zoneConfigs?: ZoneConfigurationRow[] },
): number {
  const stored = Number.isFinite(row.inventoryKg) ? row.inventoryKg : 0;
  if (stored > 0) return stored;
  if (forecastHarvestRowUsesHarvestedAreaForMagnitude(row)) {
    const m2 = forecastHarvestRowEffectiveM2(row);
    if (m2 <= 0) return 0;
    const kgPerM2 = resolveForecastHarvestRowInventoryKgPerM2(row, options?.zoneConfigs);
    if (kgPerM2 <= 0) return 0;
    return Math.max(0, Math.round(m2 * kgPerM2));
  }
  return forecastHarvestRowPlanQuantityKg(row);
}

/** Sprig / Kg → cột `quantity`; ngược lại → `harvested_area`. */
export function planRowUsesPlanQuantityForMagnitude(
  rawPlanRow: Record<string, unknown>,
): boolean {
  return !planRowUsesHarvestedAreaForMagnitude(rawPlanRow);
}

/** m² gom theo tháng / zone — Sod, Sod→Sprig, UOM M². */
export function harvestPlanM2MagnitudeFromRaw(
  rawPlanRow: Record<string, unknown>,
): number {
  return planRowUsesHarvestedAreaForMagnitude(rawPlanRow)
    ? harvestPlanEffectiveMagnitudeFromRaw(rawPlanRow)
    : 0;
}

/** kg gom theo tháng — Sprig / UOM Kg (`quantity`); Sod / Sod→Sprig (m² × zone kg/m²). */
export function harvestPlanKgMagnitudeFromRaw(
  rawPlanRow: Record<string, unknown>,
  options: {
    zoneConfigs?: ZoneConfigurationRow[];
    buckets?: Map<string, ZoneBucket>;
  } = {},
): number {
  if (planRowUsesPlanQuantityForMagnitude(rawPlanRow)) {
    return harvestPlanQuantityFromRaw(rawPlanRow);
  }
  return harvestPlanInventoryKgFromRaw(rawPlanRow, options);
}

/** Prefer `product_id`, then legacy / camelCase keys used by some clients. */
export function harvestPlanProductIdFromRaw(rawPlanRow: Record<string, unknown>): number {
  for (const key of ["product_id", "grass_id", "productId"] as const) {
    if (!harvestQuantityCellPresent(rawPlanRow[key])) continue;
    const n = harvestPlanScalarFromRaw(rawPlanRow[key]);
    if (n > 0) return Math.floor(n);
  }
  return 0;
}

function isKgUom(uomRaw: string): boolean {
  const u = uomRaw.toLowerCase().replace(/\s/g, "");
  return (
    u === "kg" ||
    u === "kgs" ||
    u === "kilogram" ||
    u === "kilograms"
  );
}

function isM2Uom(uomRaw: string): boolean {
  const raw = String(uomRaw ?? "").trim();
  const u = raw.toLowerCase().replace(/\s/g, "").replace(/²/g, "2");
  return (
    u === "m2" ||
    u === "sqm" ||
    u === "sq.m" ||
    u === "squaremeter" ||
    u === "squaremeters"
  );
}

function normalizeZone(v: string): string {
  return canonicalZoneBucketKey(v);
}

/** Zone trống / alias no-zone gom về bucket {@link FORECAST_NOZONE_ZONE} (có thể cấu hình trong zone-config). */
export { isForecastNoZoneBucketKey };

/** Zone trống / no-zone / nozone — bỏ qua trong cap, chart, zone-config buckets. */
export function isForecastExcludedZone(zone: string | undefined | null): boolean {
  return isForecastNoZoneBucketKey(normalizeZone(String(zone ?? "")));
}

/** `farmId|zone|productId` keys that participate in mapped-zone inventory math. */
export function isMappedForecastZoneKey(zoneKey: string): boolean {
  const parts = zoneKey.split("|");
  if (parts.length !== 3) return false;
  return !isForecastExcludedZone(parts[1]);
}

/** Chuẩn hóa key bucket dùng trong `aggregateBucketsForFarmGrass` / `distributePlanRowToZoneFragments`. */
export function forecastZoneBucketKey(zoneValue: string): string {
  const z = String(zoneValue ?? "").trim();
  if (!z || isForecastNoZoneBucketKey(z)) return FORECAST_NOZONE_ZONE;
  if (z.startsWith("zid:") || z.startsWith("zlabel:")) return z;
  return canonicalZoneBucketKey(z);
}

function findBestZoneConfigMatch(params: {
  zoneConfigs: ZoneConfigurationRow[];
  farmId?: number;
  zone: string;
  productId?: number;
  asOfYmd?: string;
}): ZoneConfigurationRow | null {
  const { zoneConfigs, farmId, zone, productId, asOfYmd } = params;
  const productIdNorm = Number.isFinite(productId ?? NaN) ? Number(productId) : undefined;
  if (productIdNorm === undefined) return null;

  const ymd = asOfYmd?.trim().slice(0, 10) || ymdFromDateLocal(new Date());
  return findActiveZoneConfiguration(zoneConfigs, {
    farmId,
    zone,
    productId: productIdNorm,
    ymd,
  });
}

/** Synthetic zone for harvest rows without a usable zone or unallocated no-zone remainder. */
export { FORECAST_NOZONE_ZONE };

export type ZoneInventoryFragment = {
  zone: string;
  inventoryKg: number;
  zoneMaxInventoryKg: number;
  inventoryIsCapped: boolean;
  /** Kg trong fragment này từ plan không zone spread vào zone (chỉ nhánh phân bổ đa-zone). */
  inventoryKgFromNozoneSpread?: number;
};

type ZoneBucket = {
  maxKg: number;
  kgPerM2: number;
  /** Stored zone id / name as on `ZoneConfigurationRow.zone` (first row seen). */
  zoneRaw: string;
};

function aggregateBucketsForFarmGrass(
  zoneConfigs: ZoneConfigurationRow[],
  farmId: number,
  productId: number,
): Map<string, ZoneBucket> {
  const buckets = new Map<string, ZoneBucket>();
  for (const cfg of zoneConfigs) {
    if (Number(cfg.farm_id) !== farmId || Number(cfg.grass_id) !== productId) continue;
    const zoneRaw = String(cfg.zone ?? "").trim();
    if (isForecastExcludedZone(zoneRaw)) continue;
    const key = forecastZoneBucketKey(normalizeZone(zoneRaw));
    const displayRaw =
      key === FORECAST_NOZONE_ZONE ? zoneRaw || FORECAST_NOZONE_ZONE : zoneRaw;
    const maxKg = normalizeMaxInventoryKg(toNumber(cfg.max_inventory_kg));
    const kgpm2Raw = toNumber(cfg.inventory_kg_per_m2);
    const kgPerM2 =
      kgpm2Raw > 0 ? kgpm2Raw : DEFAULT_FALLBACK_INVENTORY_KG_PER_M2;
    const prev = buckets.get(key);
    if (!prev) {
      buckets.set(key, { maxKg, kgPerM2, zoneRaw: displayRaw });
    } else {
      buckets.set(key, {
        maxKg: prev.maxKg + maxKg,
        kgPerM2: prev.kgPerM2,
        zoneRaw: prev.zoneRaw,
      });
    }
  }
  return buckets;
}

/** Thứ tự zone ổn định (ưu catalog id) — khớp ý tưởng với phân bổ regrowth. */
function zoneKeySortRankForDistribute(zoneSeg: string): number {
  if (!zoneSeg) return 99999;
  if (zoneSeg.startsWith("zid:")) {
    const n = Number(zoneSeg.slice(4));
    if (Number.isFinite(n)) return n;
  }
  const n = Number(zoneSeg);
  if (Number.isFinite(n)) return n;
  const m = zoneSeg.match(/(\d+)/u);
  return m ? Number(m[1]) : 99998;
}

/**
 * kg/m² theo zone (key đã normalize), cùng farm + grass — dùng quy đổi kg → m² (tooltip, v.v.).
 */
export function kgPerM2ByNormalizedZoneForFarmProduct(
  zoneConfigs: ZoneConfigurationRow[],
  farmId: number,
  productId: number,
): Record<string, number> {
  if (farmId <= 0 || productId <= 0 || !zoneConfigs?.length) return {};
  const buckets = aggregateBucketsForFarmGrass(zoneConfigs, farmId, productId);
  const out: Record<string, number> = {};
  for (const [k, b] of buckets.entries()) {
    out[k] = b.kgPerM2 > 0 ? b.kgPerM2 : DEFAULT_FALLBACK_INVENTORY_KG_PER_M2;
  }
  return out;
}

/**
 * Chuyển một dòng plan sang kg và tách thành fragment theo zone.
 * - Hàng **đã có zone** (`zone` khác trống sau normalize): một fragment đúng zone đó (hoặc một dòng nếu zone không khớp cấu hình). Overflow so với `max_inventory_kg` được đánh dấu `inventoryIsCapped`, **không** tự chảy sang zone khác ở bước này.
 * - Hàng **không có zone** (ô zone trống sau normalize): gom `requestedKg`, **lần lượt** lấp các zone “thật” (bucket khác `nozone`) theo **headroom** `max_inventory_kg − đã gán` (xem `priorUsedKgByZoneBucket` từ `rowsToMockHarvestRows`); rồi lấp vào bucket `nozone` từ cấu hình (nếu có); phần vượt nữa thành fragment overflow (max fallback), `inventoryIsCapped: true`.
 * - Cấu hình zone trống / `no-zone` / `nozone` trong **zone-config** (cùng farm + grass) gom vào bucket `nozone`
 *   với `max_inventory_kg` và `inventory_kg_per_m2` như mọi zone; phần dư sau khi lấp các zone “thật” sẽ lấp vào bucket này trước, vượt nữa mới ghi thêm fragment overflow (fallback max).
 * - Không có bucket zone nào cho farm+grass: toàn bộ vào `nozone`.
 */
export function distributePlanRowToZoneFragments(params: {
  rawPlanRow: Record<string, unknown>;
  zoneConfigs: ZoneConfigurationRow[];
  /**
   * Kg đã gán trước đó (cùng farm + grass) theo bucket key như `aggregateBucketsForFarmGrass`
   * (`forecastZoneBucketKey`). Chỉ ảnh hưởng nhánh plan **không zone**: mỗi zone nhận tối đa
   * `maxKg − prior` rồi chảy tiếp Z2, Z3…
   */
  priorUsedKgByZoneBucket?: Map<string, number>;
}): ZoneInventoryFragment[] {
  const { rawPlanRow, zoneConfigs, priorUsedKgByZoneBucket } = params;
  const farmId = toNumber(rawPlanRow.farm_id);
  const productId = harvestPlanProductIdFromRaw(rawPlanRow);
  const planZoneNorm = normalizeZone(String(rawPlanRow.zone ?? ""));

  const buckets =
    farmId > 0 && productId > 0
      ? aggregateBucketsForFarmGrass(zoneConfigs, farmId, productId)
      : new Map<string, ZoneBucket>();

  const requestedKg = harvestPlanInventoryKgFromRaw(rawPlanRow, {
    zoneConfigs,
    buckets,
  });

  if (planZoneNorm) {
    const planBucketKey = forecastZoneBucketKey(planZoneNorm);
    const matchedBucket = buckets.get(planBucketKey);
    if (matchedBucket) {
      return [
        {
          zone: matchedBucket.zoneRaw,
          inventoryKg: requestedKg,
          zoneMaxInventoryKg: matchedBucket.maxKg,
          inventoryIsCapped: requestedKg > matchedBucket.maxKg,
        },
      ];
    }

    return [];
  }

  if (buckets.size === 0) {
    return [];
  }

  const fillKeys = Array.from(buckets.keys())
    .filter((k) => k !== FORECAST_NOZONE_ZONE)
    .sort((a, b) => {
      const ra = zoneKeySortRankForDistribute(a);
      const rb = zoneKeySortRankForDistribute(b);
      if (ra !== rb) return ra - rb;
      return a.localeCompare(b);
    });

  let remainder = requestedKg;
  const fragments: ZoneInventoryFragment[] = [];

  for (const key of fillKeys) {
    const b = buckets.get(key);
    if (!b) continue;
    const usedHere = priorUsedKgByZoneBucket?.get(key) ?? 0;
    const headroom = Math.max(0, b.maxKg - usedHere);
    const take = Math.min(remainder, headroom);
    if (take > 0) {
      fragments.push({
        zone: b.zoneRaw,
        inventoryKg: take,
        zoneMaxInventoryKg: b.maxKg,
        inventoryIsCapped: false,
        inventoryKgFromNozoneSpread: take,
      });
      remainder -= take;
    }
    if (remainder <= 0) break;
  }

  return fragments;
}

/**
 * Cập nhật `zoneMaxInventoryKg` trên từng dòng forecast theo `sts_zone_configurations` mới nhất.
 * Tránh snapshot cũ từ lúc mở trang sau khi admin đổi Size / Yield / max trên server.
 */
export function applyLatestZoneMaxKgToForecastRows(
  rows: ForecastHarvestRow[],
  zoneConfigs: ZoneConfigurationRow[],
  asOfYmd?: string,
): ForecastHarvestRow[] {
  if (!zoneConfigs?.length) return rows;
  const ymd = asOfYmd?.trim().slice(0, 10) || ymdFromDateLocal(new Date());
  return rows.map((row) => {
    const zoneStr = String(row.zone ?? "").trim();
    if (!zoneStr || isForecastNoZoneBucketKey(normalizeZone(zoneStr))) {
      return row;
    }
    const cfg = findBestZoneConfigMatch({
      zoneConfigs,
      farmId: row.farmId,
      zone: zoneStr,
      productId: row.productId,
      asOfYmd: ymd,
    });
    if (!cfg) return { ...row, zoneMaxInventoryKg: 0 };
    const maxKg = normalizeMaxInventoryKg(toNumber(cfg.max_inventory_kg));
    return { ...row, zoneMaxInventoryKg: maxKg };
  });
}

