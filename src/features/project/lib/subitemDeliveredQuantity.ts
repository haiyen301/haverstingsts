import type { QuantityRequiredProject, SubItem } from "@/entities/projects";
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
  if (!s || s === "0000-00-00" || s === "null") return false;
  const datePart = s.includes(" ") ? s.split(" ")[0] : s;
  const d = new Date(datePart);
  return !Number.isNaN(d.getTime());
}

/** Server / `project_harvesting_plan`: only rows with real `actual_harvest_date` count toward Done. */
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

/**
 * Count quantity toward delivered when the load is confirmed by either:
 * - `delivery_harvest_date` (delivered / scheduled to site), or
 * - `actual_harvest_date` (harvest done; delivery date may still be empty).
 * Quantity: prefer `quantity_harvested` when > 0, else `quantity`.
 */
export function getSubitemDeliveredQuantity(subitem: SubitemLike): number {
  const s = subitem as Record<string, unknown>;
  const deliveryOk = isValidHarvestRelatedDate(s.delivery_harvest_date);
  const actualOk = isValidHarvestRelatedDate(s.actual_harvest_date);
  // Either date is enough (OR). Only skip when neither is set / valid.
  if (!(deliveryOk || actualOk)) return 0;
  const harvested = parseNumber(s.quantity_harvested);
  if (harvested > 0) return harvested;
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

function subitemQtyIfActualOnly(s: Record<string, unknown>): number {
  if (!isValidActualHarvestDate(s.actual_harvest_date)) return 0;
  const harvested = parseNumber(s.quantity_harvested);
  if (harvested > 0) return harvested;
  return parseNumber(s.quantity);
}

/**
 * Sum like PHP `_mondaySubitemHarvestQtyCountedIfActual` / plan rows with `actual_harvest_date` only.
 */
export function calculateDeliveredQuantityActualHarvestOnly(
  subitems: ReadonlyArray<SubitemLike>,
  productId?: string,
  uom?: string,
  harvestProjectId?: string,
): number {
  if (!productId) return 0;
  const uomNorm = normalizeUomForHarvestMatch(uom);
  let total = 0;
  for (const item of subitems) {
    const s = item as Record<string, unknown>;
    if (!subitemBelongsToHarvestProject(s, harvestProjectId)) continue;
    if (String(s.product_id ?? "").trim() !== productId) continue;
    if (uomNorm) {
      const su = normalizeUomForHarvestMatch(s.uom);
      if (su !== uomNorm) continue;
    }
    total += subitemQtyIfActualOnly(s);
  }
  return total;
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
    const requiredUomNorm = normalizeUomForHarvestMatch(r.uom);
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
