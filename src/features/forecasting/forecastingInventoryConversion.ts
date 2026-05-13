import type { ZoneConfigurationRow } from "@/features/admin/api/adminApi";

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

  const rawQty = toNumber(rawPlanRow.quantity);
  const farmId = toNumber(rawPlanRow.farm_id);
  const productId = toNumber(rawPlanRow.product_id);
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

function findBestZoneConfigMatch(params: {
  zoneConfigs: ZoneConfigurationRow[];
  farmId?: number;
  zone: string;
  productId?: number;
}): ZoneConfigurationRow | null {
  const { zoneConfigs, farmId, zone, productId } = params;
  const z = normalizeZone(zone);
  const farm = Number.isFinite(farmId ?? NaN) ? Number(farmId) : undefined;
  const productIdNorm = Number.isFinite(productId ?? NaN) ? Number(productId) : undefined;

  if (!z || productIdNorm === undefined) {
    return null;
  }

  // Ưu tiên match farm_id + zone + grass_id.
  if (farm !== undefined) {
    const exactByFarm = zoneConfigs.find(
      (r) =>
        Number(r.grass_id) === productIdNorm &&
        normalizeZone(String(r.zone ?? "")) === z &&
        Number(r.farm_id) === farm,
    );
    if (exactByFarm) return exactByFarm;
  }

  // Fallback: zone + grass_id
  const byZoneGrassId = zoneConfigs.find(
    (r) =>
      Number(r.grass_id) === productIdNorm &&
      normalizeZone(String(r.zone ?? "")) === z,
  );
  if (byZoneGrassId) return byZoneGrassId;

  return null;
}

function normalizeZone(v: string): string {
  return String(v ?? "").trim().toLowerCase();
}


