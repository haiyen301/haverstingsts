import {
  isSodToSprigHarvestLine,
  normalizeRequirementUomForProgress,
  normalizeUomForHarvestMatch,
} from "@/features/project/lib/subitemDeliveredQuantity";
import {
  defaultHarvestTypeForUom,
  normalizeHarvestTypeStorageKey,
  type HarvestTypeStorageKey,
} from "@/shared/lib/harvestType";

/** UOM bucket for limit / remaining maps — Sod→Sprig and Sprig use Kg, Sod uses M2. */
export function harvestLimitUomForLoadType(
  loadType: HarvestTypeStorageKey | "",
  uomRaw: unknown,
): string {
  if (loadType === "sod_to_sprig" || loadType === "sprig") return "kg";
  if (loadType === "sod") return "m2";
  return normalizeRequirementUomForProgress(uomRaw);
}

export function harvestLimitLoadTypeFromRequirement(
  req: Record<string, unknown>,
): HarvestTypeStorageKey | "" {
  return normalizeHarvestTypeStorageKey(req.load_type ?? req.harvest_type ?? "");
}

export function harvestLimitEffectiveUomForRequirement(
  req: Record<string, unknown>,
): string {
  const loadType = harvestLimitLoadTypeFromRequirement(req);
  return harvestLimitUomForLoadType(loadType, req.uom);
}

/** Map key for remaining qty when requirement has `load_type`. */
export function harvestLimitRemainingMapKeyForRequirement(
  productId: string,
  req: Record<string, unknown>,
): string {
  const pid = productId.trim();
  const loadType = harvestLimitLoadTypeFromRequirement(req);
  const uomKey = harvestLimitEffectiveUomForRequirement(req);
  if (loadType) {
    return `${pid}::${uomKey}::${loadType}`;
  }
  return `${pid}::${uomKey}`;
}

export function harvestLimitLoadTypeFromPlanRow(
  row: Record<string, unknown>,
): HarvestTypeStorageKey | "" {
  const fromField = normalizeHarvestTypeStorageKey(
    row.load_type ?? row.harvest_type ?? row.harvestType ?? "",
  );
  if (fromField) return fromField;
  const uom = normalizeUomForHarvestMatch(row.uom);
  if (uom === "kg") return "sprig";
  if (uom === "m2") return "sod";
  return "";
}

/** Lookup key for a harvest plan row (prefers load_type bucket, falls back to legacy). */
export function harvestLimitRemainingMapKeyForPlanRow(
  row: Record<string, unknown>,
  productId: string,
): string {
  const pid = productId.trim();
  const loadType = harvestLimitLoadTypeFromPlanRow(row);
  const uomKey = isSodToSprigHarvestLine(row)
    ? "kg"
    : normalizeRequirementUomForProgress(row.uom);
  if (loadType) {
    return `${pid}::${harvestLimitUomForLoadType(loadType, row.uom)}::${loadType}`;
  }
  return `${pid}::${uomKey}`;
}

/**
 * Match one requirement line (product + uom + load_type).
 * When the requirement has `load_type`, only the same harvest load type counts
 * (no Sprig ↔ Sod→Sprig cross-count). Legacy Sod→Sprig plan rows may still use M² UOM.
 * Mirrors PHP `_paceRecalcPlanRowMatchesRequirementLine`.
 */
export function planRowMatchesRequirementForHarvestLimit(
  row: Record<string, unknown>,
  productId: string,
  requiredUomNorm: string,
  requiredLoadType: HarvestTypeStorageKey | "",
): boolean {
  if (String(row.product_id ?? "").trim() !== productId.trim()) return false;

  const rowUom = normalizeUomForHarvestMatch(row.uom);
  const rowLoad = harvestLimitLoadTypeFromPlanRow(row);

  if (requiredLoadType && rowLoad !== requiredLoadType) return false;
  if (requiredUomNorm && rowUom !== requiredUomNorm) {
    if (!requiredLoadType) return false;
    if (requiredLoadType === "sod_to_sprig" && requiredUomNorm === "kg") {
      return rowLoad === "sod_to_sprig";
    }
    return false;
  }
  return true;
}

export function harvestLimitQtyFromPlanRow(
  row: Record<string, unknown>,
  requiredUomNorm: string,
  requiredLoadType: HarvestTypeStorageKey | "",
): number {
  if (requiredLoadType === "sod_to_sprig" && requiredUomNorm === "kg") {
    const qty = Number(String(row.quantity ?? "").replace(/,/g, ""));
    if (Number.isFinite(qty) && qty > 0) return qty;
    const area = Number(String(row.harvested_area ?? "").replace(/,/g, ""));
    const kgPerM2 = Number(String(row.kg_per_m2 ?? "").replace(/,/g, ""));
    if (area > 0 && kgPerM2 > 0) return area * kgPerM2;
    return 0;
  }
  const qty = Number(String(row.quantity ?? "").replace(/,/g, ""));
  return Number.isFinite(qty) && qty > 0 ? qty : 0;
}

export function inferPlanRowLoadTypeWhenMissing(
  row: Record<string, unknown>,
): HarvestTypeStorageKey | "" {
  const existing = harvestLimitLoadTypeFromPlanRow(row);
  if (existing) return existing;
  return defaultHarvestTypeForUom(String(row.uom ?? ""));
}
