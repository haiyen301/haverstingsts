import type { SubItem } from "@/entities/projects";

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

type SubitemLike = SubItem | Record<string, unknown>;

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
