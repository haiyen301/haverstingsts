import type { QuantityRequiredProject } from "@/entities/projects";

function parseNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Same as Flutter `uom.trim().toLowerCase()` plus ²→2 so "M²" hits the `m2` branch like `M2`.
 * (See `CreateHarvestingController.getRemainingQuantityForProduct`.)
 */
function requirementUomDartLower(u: unknown): string {
  return String(u ?? "")
    .trim()
    .toLowerCase()
    .replace(/²|³/g, (ch) => (ch === "²" ? "2" : "3"));
}

/** Parity with Dart `quantityKg != null` / `quantityM2 != null` on parsed JSON. */
function nullableQtyColumnPresent(v: unknown): boolean {
  return v != null && v !== "";
}

/** Display label for requirement UOM (Kg / M2). */
export function formatRequirementUomDisplay(raw: string | undefined): string {
  const n = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/²|³/g, (ch) => (ch === "²" ? "2" : "3"));
  if (n === "m2" || n === "sqm") return "M2";
  if (n === "kg") return "Kg";
  return String(raw ?? "").trim();
}

/**
 * Resolve UOM for display when API omits `uom` but `quantity_kg` / `quantity_m2` are set.
 */
export function inferRequirementUom(
  r: Pick<QuantityRequiredProject, "uom" | "quantity_m2" | "quantity_kg">,
): string {
  const fromField = formatRequirementUomDisplay(r.uom);
  if (fromField) return fromField;
  const kgP = nullableQtyColumnPresent(r.quantity_kg);
  const m2P = nullableQtyColumnPresent(r.quantity_m2);
  if (m2P && !kgP) return "M2";
  if (kgP && !m2P) return "Kg";
  if (m2P) return "M2";
  if (kgP) return "Kg";
  return "";
}

/**
 * @param uomBranchSource — requirement line `uom` from JSON, or form-selected UOM (see `effectiveRequiredQuantityForFormUom`).
 */
function computeDartLikeRequired(
  r: Pick<QuantityRequiredProject, "quantity" | "quantity_m2" | "quantity_kg" | "uom">,
  uomBranchSource: unknown,
): number {
  const uLower = requirementUomDartLower(uomBranchSource);
  const qStr = String(r.quantity ?? "").trim();
  const kgP = nullableQtyColumnPresent(r.quantity_kg);
  const m2P = nullableQtyColumnPresent(r.quantity_m2);

  if (uLower === "kg" && kgP) {
    return parseNumber(r.quantity_kg);
  }
  if (uLower === "m2" && m2P) {
    return parseNumber(r.quantity_m2);
  }
  if (qStr !== "") {
    return parseNumber(r.quantity);
  }
  if (kgP) {
    return parseNumber(r.quantity_kg);
  }
  if (m2P) {
    return parseNumber(r.quantity_m2);
  }
  return 0;
}

/** Required qty using the requirement line’s own `uom` (cards, detail, dashboard). */
export function effectiveRequiredQuantity(
  r: Pick<QuantityRequiredProject, "quantity" | "quantity_m2" | "quantity_kg" | "uom">,
): number {
  return computeDartLikeRequired(r, r.uom);
}

/**
 * Same as `getRemainingQuantityForProduct(productId, uom)` on Flutter — branches use **form** UOM, not `r.uom`.
 */
export function effectiveRequiredQuantityForFormUom(
  r: Pick<QuantityRequiredProject, "quantity" | "quantity_m2" | "quantity_kg" | "uom">,
  formUomRaw: string,
): number {
  return computeDartLikeRequired(r, formUomRaw);
}

/** Loose API / `Record` row from `quantity_required_sprig_sod` (snake_case keys). */
export function effectiveRequiredQuantityFromRecord(req: Record<string, unknown>): number {
  return effectiveRequiredQuantity({
    quantity: req.quantity as string | number | undefined,
    quantity_m2: req.quantity_m2 as string | number | null | undefined,
    quantity_kg: req.quantity_kg as string | number | null | undefined,
    uom: req.uom as string | undefined,
  });
}
