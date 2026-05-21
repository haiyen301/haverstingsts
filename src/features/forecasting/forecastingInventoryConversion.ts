import type { ZoneConfigurationRow } from "@/features/admin/api/adminApi";
import type { ForecastHarvestRow } from "./forecastingTypes";

export const DEFAULT_FALLBACK_INVENTORY_KG_PER_M2 = 1;
export const DEFAULT_FALLBACK_MAX_INVENTORY_KG = 500000;

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

  const rawQty = harvestPlanQuantityFromRaw(rawPlanRow);
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
    : DEFAULT_FALLBACK_MAX_INVENTORY_KG;
  const uom = String(
    rawPlanRow.uom ??
      rawPlanRow.UOM ??
      rawPlanRow.unit ??
      rawPlanRow.Unit ??
      rawPlanRow.quantity_uom ??
      rawPlanRow.quantityUom ??
      "",
  ).trim();

  // Nếu đã là kg thì không cần convert.
  if (isKgUom(uom)) {
    return {
      quantityKg: rawQty,
      isCapped: false,
      usedConfig: config,
      maxInventoryKgUsed,
    };
  }

  // Chỉ xử lý khi là m² / diện tích; uom khác thì trả nguyên.
  if (!isM2Uom(uom)) {
    return {
      quantityKg: rawQty,
      isCapped: false,
      usedConfig: config,
      maxInventoryKgUsed,
    };
  }
  const inventoryKgPerM2Raw =
    config != null
      ? toNumber(config.inventory_kg_per_m2)
      : DEFAULT_FALLBACK_INVENTORY_KG_PER_M2;
  const maxInventoryKgRaw =
    config != null
      ? toNumber(config.max_inventory_kg)
      : DEFAULT_FALLBACK_MAX_INVENTORY_KG; 

  const inventoryKgPerM2 =
    inventoryKgPerM2Raw > 0
      ? inventoryKgPerM2Raw
      : DEFAULT_FALLBACK_INVENTORY_KG_PER_M2;
  const maxInventoryKg =
    normalizeMaxInventoryKg(maxInventoryKgRaw);

  // rawQty ở đây được hiểu là diện tích m² từ plan.
  const requestedKg = rawQty * inventoryKgPerM2;
  const maxKg = maxInventoryKg;
  const finalKg = Math.min(requestedKg, maxKg);

  return {
    quantityKg: finalKg,
    isCapped: requestedKg > maxKg,
    usedConfig: config,
    maxInventoryKgUsed: maxInventoryKg,
  };
}

function normalizeMaxInventoryKg(v: number): number {
  return v > 0 ? v : DEFAULT_FALLBACK_MAX_INVENTORY_KG;
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
  return String(v ?? "").trim().toLowerCase();
}

/**
 * Zone trống / alias no-zone gom về bucket {@link FORECAST_NOZONE_ZONE} (có thể cấu hình trong zone-config).
 */
export function isForecastNoZoneBucketKey(normalizedZone: string): boolean {
  const s = String(normalizedZone ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, " ");
  return !s || s === FORECAST_NOZONE_ZONE || s === "no-zone" || s === "no zone";
}

/** Chuẩn hóa key bucket dùng trong `aggregateBucketsForFarmGrass` / `distributePlanRowToZoneFragments`. */
export function forecastZoneBucketKey(normalizedZone: string): string {
  return isForecastNoZoneBucketKey(normalizedZone) ? FORECAST_NOZONE_ZONE : normalizedZone;
}

function findBestZoneConfigMatch(params: {
  zoneConfigs: ZoneConfigurationRow[];
  farmId?: number;
  zone: string;
  productId?: number;
}): ZoneConfigurationRow | null {
  const { zoneConfigs, farmId, zone, productId } = params;
  const z = forecastZoneBucketKey(normalizeZone(zone));
  const farm = Number.isFinite(farmId ?? NaN) ? Number(farmId) : undefined;
  const productIdNorm = Number.isFinite(productId ?? NaN) ? Number(productId) : undefined;

  if (productIdNorm === undefined) {
    return null;
  }

  // Ưu tiên match farm_id + zone + grass_id (zone / no-zone alias gom cùng bucket key).
  if (farm !== undefined) {
    const exactByFarm = zoneConfigs.find(
      (r) =>
        Number(r.grass_id) === productIdNorm &&
        forecastZoneBucketKey(normalizeZone(String(r.zone ?? ""))) === z &&
        Number(r.farm_id) === farm,
    );
    if (exactByFarm) return exactByFarm;
  }

  // Fallback: zone + grass_id
  const byZoneGrassId = zoneConfigs.find(
    (r) =>
      Number(r.grass_id) === productIdNorm &&
      forecastZoneBucketKey(normalizeZone(String(r.zone ?? ""))) === z,
  );
  if (byZoneGrassId) return byZoneGrassId;

  return null;
}

/** Synthetic zone for harvest rows without a usable zone or unallocated no-zone remainder. */
export const FORECAST_NOZONE_ZONE = "nozone";

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

/** Thứ tự zone ổn định (ưu số) — khớp ý tưởng với phân bổ regrowth. */
function zoneKeySortRankForDistribute(zoneSeg: string): number {
  if (!zoneSeg) return 99999;
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
  const rawQty = harvestPlanQuantityFromRaw(rawPlanRow);
  const planZoneNorm = normalizeZone(String(rawPlanRow.zone ?? ""));

  const uom = String(
    rawPlanRow.uom ??
      rawPlanRow.UOM ??
      rawPlanRow.unit ??
      rawPlanRow.Unit ??
      rawPlanRow.quantity_uom ??
      rawPlanRow.quantityUom ??
      "",
  ).trim();

  const buckets =
    farmId > 0 && productId > 0
      ? aggregateBucketsForFarmGrass(zoneConfigs, farmId, productId)
      : new Map<string, ZoneBucket>();

  let requestedKg = 0;
  if (isKgUom(uom)) {
    requestedKg = rawQty;
  } else if (isM2Uom(uom)) {
    let kgPerM2 = DEFAULT_FALLBACK_INVENTORY_KG_PER_M2;
    const planBucketKey = planZoneNorm ? forecastZoneBucketKey(planZoneNorm) : "";
    if (planZoneNorm && planBucketKey && buckets.has(planBucketKey)) {
      kgPerM2 = buckets.get(planBucketKey)!.kgPerM2;
    } else if (buckets.size > 0) {
      let s = 0;
      for (const b of buckets.values()) s += b.kgPerM2;
      kgPerM2 = s / buckets.size;
    } else {
      const match = findBestZoneConfigMatch({
        zoneConfigs,
        farmId,
        zone: String(rawPlanRow.zone ?? ""),
        productId,
      });
      if (match) {
        const k = toNumber(match.inventory_kg_per_m2);
        kgPerM2 = k > 0 ? k : DEFAULT_FALLBACK_INVENTORY_KG_PER_M2;
      }
    }
    requestedKg = rawQty * kgPerM2;
  } else {
    requestedKg = rawQty;
  }
  requestedKg = Math.max(0, requestedKg);

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

    return [
      {
        zone: String(rawPlanRow.zone ?? "").trim(),
        inventoryKg: requestedKg,
        zoneMaxInventoryKg: DEFAULT_FALLBACK_MAX_INVENTORY_KG,
        inventoryIsCapped: false,
      },
    ];
  }

  if (buckets.size === 0) {
    return [
      {
        zone: FORECAST_NOZONE_ZONE,
        inventoryKg: requestedKg,
        zoneMaxInventoryKg: DEFAULT_FALLBACK_MAX_INVENTORY_KG,
        inventoryIsCapped: false,
      },
    ];
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

  const noz = buckets.get(FORECAST_NOZONE_ZONE);
  if (remainder > 0) {
    if (noz && noz.maxKg > 0) {
      const usedNoz = priorUsedKgByZoneBucket?.get(FORECAST_NOZONE_ZONE) ?? 0;
      const headroomNoz = Math.max(0, noz.maxKg - usedNoz);
      const take = Math.min(remainder, headroomNoz);
      fragments.push({
        zone: noz.zoneRaw.trim() || FORECAST_NOZONE_ZONE,
        inventoryKg: take,
        zoneMaxInventoryKg: noz.maxKg,
        inventoryIsCapped: remainder > take,
      });
      remainder -= take;
    }
    if (remainder > 0) {
      fragments.push({
        zone: FORECAST_NOZONE_ZONE,
        inventoryKg: remainder,
        zoneMaxInventoryKg: DEFAULT_FALLBACK_MAX_INVENTORY_KG,
        inventoryIsCapped: true,
      });
    }
  }

  return fragments.length > 0
    ? fragments
    : [
        {
          zone: FORECAST_NOZONE_ZONE,
          inventoryKg: requestedKg,
          zoneMaxInventoryKg: DEFAULT_FALLBACK_MAX_INVENTORY_KG,
          inventoryIsCapped: false,
        },
      ];
}

/**
 * Cập nhật `zoneMaxInventoryKg` trên từng dòng forecast theo `sts_zone_configurations` mới nhất.
 * Tránh snapshot cũ từ lúc mở trang sau khi admin đổi Size / Yield / max trên server.
 */
export function applyLatestZoneMaxKgToForecastRows(
  rows: ForecastHarvestRow[],
  zoneConfigs: ZoneConfigurationRow[],
): ForecastHarvestRow[] {
  if (!zoneConfigs?.length) return rows;
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
    });
    if (!cfg) return row;
    const maxKg = normalizeMaxInventoryKg(toNumber(cfg.max_inventory_kg));
    if (maxKg <= 0) return row;
    return { ...row, zoneMaxInventoryKg: maxKg };
  });
}

