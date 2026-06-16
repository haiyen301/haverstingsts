import type { QuantityRequiredProject, SubItem } from "@/entities/projects";
import {
  harvestLimitLoadTypeFromRequirement,
  planRowMatchesRequirementForHarvestLimit,
} from "@/features/project/lib/harvestLimitGrouping";
import {
  normalizeHarvestTypeStorageKey,
  type HarvestTypeStorageKey,
} from "@/shared/lib/harvestType";
import { effectiveRequiredQuantity } from "./effectiveRequirementQuantity";

function parseNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Parseable non-placeholder date (shared by delivery vs actual harvest). */
export function isValidHarvestRelatedDate(raw: unknown): boolean {
  const s = String(raw ?? "").trim();
  if (!s || s.toLowerCase() === "null") return false;
  if (s === "0000-00-00" || s.startsWith("0000-00-00")) return false;
  const datePart = s.includes(" ") ? s.split(" ")[0]! : s;
  const d = new Date(datePart);
  return !Number.isNaN(d.getTime());
}

/** Server / `project_harvesting_plan`: rows with real `actual_harvest_date`. */
export function isValidActualHarvestDate(raw: unknown): boolean {
  const s = String(raw ?? "").trim();
  if (!s || s === "0000-00-00" || s.toLowerCase() === "null") return false;
  if (s.startsWith("0000-00-00")) return false;
  const datePart = s.includes(" ") ? s.split(" ")[0]! : s;
  const d = new Date(datePart);
  return !Number.isNaN(d.getTime());
}

type SubitemLike = SubItem | Record<string, unknown>;

/**
 * Parent Monday row scopes subitems: if a subitem carries `project_id`, it must match the row’s project
 * (same idea as `project_harvesting_plan.project_id` on the server). Missing `project_id` on subitem = legacy row scope.
 */
export function subitemBelongsToHarvestProject(
  subitem: SubitemLike,
  harvestProjectId?: string,
): boolean {
  const rowPid = String(harvestProjectId ?? "").trim();
  if (!rowPid) return true;
  const sp = String((subitem as Record<string, unknown>).project_id ?? "").trim();
  if (!sp) return true;
  return sp === rowPid;
}

/** Align with PHP `_mondayNormalizeUom` for matching requirement lines vs subitems / plan. */
export function normalizeUomForHarvestMatch(uom: unknown): string {
  return String(uom ?? "")
    .toLowerCase()
    .trim()
    .replace(/²|³/g, (ch) => (ch === "²" ? "2" : "3"))
    .replace(/\s+/g, "");
}

function harvestLineTypeKey(s: Record<string, unknown>): string {
  return (
    normalizeHarvestTypeStorageKey(
      s.harvest_type ??
        s.load_type ??
        s.harvestType ??
        s.select_harvest_type ??
        s.selectHarvestType ??
        "",
    ) || ""
  );
}

export function isSodToSprigHarvestLine(s: Record<string, unknown>): boolean {
  return harvestLineTypeKey(s) === "sod_to_sprig";
}

/** Requirement line UOM → kg / m2 for progress matching (sprig lines are kg). */
export function normalizeRequirementUomForProgress(uom: unknown): string {
  const n = normalizeUomForHarvestMatch(uom);
  if (n === "kg" || n === "kgs" || n.includes("sprig")) return "kg";
  if (n === "m2" || n === "sqm") return "m2";
  return n;
}

function countsTowardDeliveredProgress(
  s: Record<string, unknown>,
  requiredUomNorm: string,
): boolean {
  if (isValidHarvestRelatedDate(s.delivery_harvest_date)) return true;
  if (
    requiredUomNorm === "kg" &&
    isSodToSprigHarvestLine(s) &&
    sodToSprigDeliveredKgQty(s) > 0 &&
    isValidActualHarvestDate(s.actual_harvest_date)
  ) {
    return true;
  }
  return false;
}

/** Sod → Sprig progress is always in kg even when the plan row UOM is m². */
function sodToSprigDeliveredKgQty(s: Record<string, unknown>): number {
  const qty = parseNumber(s.quantity);
  if (qty > 0) return qty;
  const area = parseNumber(s.harvested_area);
  const kgPerM2 = parseNumber(s.kg_per_m2);
  if (area > 0 && kgPerM2 > 0) return area * kgPerM2;
  return 0;
}

/**
 * Delivered qty counted toward one requirement line (delivery date required).
 * Sod → Sprig: always kg qty for the product's kg requirement line (never the m² line).
 */
export function deliveredQtyForRequirementLine(
  s: Record<string, unknown>,
  requiredUomNorm: string,
): number {
  if (!countsTowardDeliveredProgress(s, requiredUomNorm)) return 0;

  if (isSodToSprigHarvestLine(s) && requiredUomNorm === "kg") {
    return sodToSprigDeliveredKgQty(s);
  }

  return parseNumber(s.quantity);
}

function subitemMatchesRequirementForDelivery(
  s: Record<string, unknown>,
  requiredProductId: string,
  requiredUomNorm: string,
  allowBlankSubitemUom: boolean,
): boolean {
  if (String(s.product_id ?? "").trim() !== requiredProductId) return false;
  if (!requiredUomNorm) return true;

  const subUom = normalizeUomForHarvestMatch(s.uom);
  if (isSodToSprigHarvestLine(s)) {
    if (requiredUomNorm === "kg") return true;
    if (requiredUomNorm === "m2") return false;
  }

  if (subUom === requiredUomNorm) return true;
  if (allowBlankSubitemUom && subUom === "") return true;

  return false;
}

/** Count quantity toward delivered only when `delivery_harvest_date` is valid. */
export function getSubitemDeliveredQuantity(subitem: SubitemLike): number {
  const s = subitem as Record<string, unknown>;
  const deliveryOk = isValidHarvestRelatedDate(s.delivery_harvest_date);
  if (!deliveryOk) return 0;
  return parseNumber(s.quantity);
}

/**
 * Sum delivered quantities for subitems matching `product_id` and optional `uom`
 * (same rules as project list card / `buildProjectCardData`).
 */
export function calculateDeliveredQuantity(
  subitems: ReadonlyArray<SubitemLike>,
  productId?: string,
  uom?: string,
): number {
  if (!productId) return 0;
  const uomNorm = String(uom ?? "").toLowerCase().trim();

  let total = 0;
  for (const item of subitems) {
    const s = item as Record<string, unknown>;
    if (String(s.product_id ?? "").trim() !== productId) continue;
    if (uomNorm) {
      const su = String(s.uom ?? "").toLowerCase().trim();
      if (su !== uomNorm) continue;
    }
    total += getSubitemDeliveredQuantity(s);
  }
  return total;
}

function subitemQtyIfDeliveredOnly(
  s: Record<string, unknown>,
  requiredUomNorm = "",
): number {
  return deliveredQtyForRequirementLine(s, requiredUomNorm);
}

/**
 * Sum like PHP `_mondaySubitemHarvestQtyCountedIfDelivered` (delivery_harvest_date only).
 */
export function calculateDeliveredQuantityDeliveryOnly(
  subitems: ReadonlyArray<SubitemLike>,
  productId?: string,
  uom?: string,
  harvestProjectId?: string,
  requiredLoadType?: HarvestTypeStorageKey | "",
): number {
  if (!productId) return 0;
  const uomNorm = normalizeRequirementUomForProgress(uom);
  const lineCountByProductId: Record<string, number> = {};
  for (const item of subitems) {
    const pid = String((item as Record<string, unknown>).product_id ?? "").trim();
    if (pid) lineCountByProductId[pid] = (lineCountByProductId[pid] ?? 0) + 1;
  }
  const allowBlankSubitemUom = (lineCountByProductId[productId] ?? 0) === 1;

  let total = 0;
  for (const item of subitems) {
    const s = item as Record<string, unknown>;
    if (!subitemBelongsToHarvestProject(s, harvestProjectId)) continue;
    if (requiredLoadType) {
      if (
        !planRowMatchesRequirementForHarvestLimit(
          s,
          productId,
          uomNorm,
          requiredLoadType,
        )
      ) {
        continue;
      }
    } else if (
      !subitemMatchesRequirementForDelivery(
        s,
        productId,
        uomNorm,
        allowBlankSubitemUom,
      )
    ) {
      continue;
    }
    total += subitemQtyIfDeliveredOnly(s, uomNorm);
  }
  return total;
}

/** Delivered qty for one `quantity_required_sprig_sod` line (respects load_type when set). */
export function calculateDeliveredQuantityForRequirementLine(
  subitems: ReadonlyArray<SubitemLike>,
  req: Record<string, unknown>,
  harvestProjectId?: string,
): number {
  const productId = String(req.product_id ?? "").trim();
  if (!productId) return 0;
  const loadType = harvestLimitLoadTypeFromRequirement(req);
  const uomRaw = String(req.uom ?? "").trim();
  return calculateDeliveredQuantityDeliveryOnly(
    subitems,
    productId,
    uomRaw,
    harvestProjectId,
    loadType || undefined,
  );
}

function subitemMatchesRequirementHarvestLine(
  s: Record<string, unknown>,
  requiredProductId: string,
  requiredUomNorm: string,
  allowBlankSubitemUom: boolean,
): boolean {
  if (String(s.product_id ?? "").trim() !== requiredProductId) return false;
  if (!requiredUomNorm) return true;
  const su = normalizeUomForHarvestMatch(s.uom);
  if (su === requiredUomNorm) return true;
  return allowBlankSubitemUom && su === "";
}

/**
 * True if some subitem has `actual_harvest_date` and matches a requirement line by product_id + UOM on the same
 * `harvestProjectId` when provided (mirrors PHP plan query: project_id + product_id + uom + actual_harvest_date).
 */
export function hasAnyActualHarvestMatchingRequirementLines(
  subitems: ReadonlyArray<SubitemLike>,
  requirements: ReadonlyArray<QuantityRequiredProject>,
  harvestProjectId?: string,
): boolean {
  const lineCountByProductId: Record<string, number> = {};
  for (const r of requirements) {
    const p = String(r.product_id ?? "").trim();
    if (p) lineCountByProductId[p] = (lineCountByProductId[p] ?? 0) + 1;
  }
  for (const r of requirements) {
    const pid = String(r.product_id ?? "").trim();
    if (!pid) continue;
    if (effectiveRequiredQuantity(r) <= 0) continue;
    const requiredUomNorm = normalizeRequirementUomForProgress(r.uom);
    const allowBlankSubitemUom = (lineCountByProductId[pid] ?? 0) === 1;
    for (const item of subitems) {
      const s = item as Record<string, unknown>;
      if (!subitemBelongsToHarvestProject(s, harvestProjectId)) continue;
      if (!subitemMatchesRequirementHarvestLine(s, pid, requiredUomNorm, allowBlankSubitemUom)) continue;
      if (isValidActualHarvestDate(s.actual_harvest_date)) return true;
    }
  }
  return false;
}

/**
 * True if some subitem has `delivery_harvest_date` and matches a requirement line by product_id + UOM
 * on the same `harvestProjectId` when provided.
 */
export function hasAnyDeliveryHarvestMatchingRequirementLines(
  subitems: ReadonlyArray<SubitemLike>,
  requirements: ReadonlyArray<QuantityRequiredProject>,
  harvestProjectId?: string,
): boolean {
  const lineCountByProductId: Record<string, number> = {};
  for (const r of requirements) {
    const p = String(r.product_id ?? "").trim();
    if (p) lineCountByProductId[p] = (lineCountByProductId[p] ?? 0) + 1;
  }
  for (const r of requirements) {
    const pid = String(r.product_id ?? "").trim();
    if (!pid) continue;
    if (effectiveRequiredQuantity(r) <= 0) continue;
    const requiredUomNorm = normalizeRequirementUomForProgress(r.uom);
    const allowBlankSubitemUom = (lineCountByProductId[pid] ?? 0) === 1;
    for (const item of subitems) {
      const s = item as Record<string, unknown>;
      if (!subitemBelongsToHarvestProject(s, harvestProjectId)) continue;
      if (!subitemMatchesRequirementForDelivery(s, pid, requiredUomNorm, allowBlankSubitemUom)) continue;
      if (isValidHarvestRelatedDate(s.delivery_harvest_date)) return true;
    }
  }
  return false;
}
