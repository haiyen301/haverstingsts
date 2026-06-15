import type { ZoneConfigurationRow } from "@/features/admin/api/adminApi";
import {
  findZoneConfigForFarmGrass,
  harvestAreaM2FromKgAndZoneConfig,
} from "@/features/project/lib/generatePlannedHarvestsForNewProject";
import { normalizeHarvestTypeStorageKey } from "@/shared/lib/harvestType";
import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import { stsProxyPostJson } from "@/shared/api/stsProxyClient";

function normUomForPaceMatch(uom: unknown): string {
  return String(uom ?? "")
    .trim()
    .toLowerCase()
    .replace(/²/g, "2")
    .replace(/\s/g, "");
}

function parsePaceQty(raw: unknown): number {
  const n = Number(String(raw ?? "").replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function planRowLoadTypeKey(row: Record<string, unknown>): string {
  const rowUom = normUomForPaceMatch(row.uom);
  return (
    normalizeHarvestTypeStorageKey(row.load_type) ||
    (rowUom === "kg" ? "sprig" : rowUom === "m2" ? "sod" : "")
  );
}

/**
 * Recalculate remaining estimate harvest quantities after an actual harvest date
 * is saved. See `doc/project-page-and-harvest-update.md`.
 *
 * Only projects with non-empty `sts_projects.pace_grass_batch_quantities` run recalc.
 */

function parsePaceGrassBatchQuantitiesList(raw: unknown): unknown[] {
  if (raw == null) return [];
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];
    try {
      const decoded: unknown = JSON.parse(s);
      return Array.isArray(decoded) ? decoded : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(raw) ? raw : [];
}

/** True when the project row has at least one grass entry in `pace_grass_batch_quantities`. */
export function projectHasPaceGrassBatchQuantities(
  projectRow: Record<string, unknown> | undefined,
): boolean {
  if (!projectRow) return false;
  const list = parsePaceGrassBatchQuantitiesList(
    projectRow.pace_grass_batch_quantities,
  );
  return list.some((item) => {
    if (!item || typeof item !== "object") return false;
    return String((item as Record<string, unknown>).grass_id ?? "").trim() !== "";
  });
}

/**
 * True when `pace_grass_batch_quantities` has an entry for `grassId`.
 * When `uom` is set, the entry must match that UOM as well.
 */
export function projectGrassHasPaceBatchQuantities(
  projectRow: Record<string, unknown> | undefined,
  grassId: string,
  uom?: string,
): boolean {
  const normalizedGrass = grassId.trim();
  if (!projectRow || !normalizedGrass) return false;
  const list = parsePaceGrassBatchQuantitiesList(
    projectRow.pace_grass_batch_quantities,
  );
  const normalizedUom = uom ? normUomForPaceMatch(uom) : "";
  return list.some((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    if (String(row.grass_id ?? "").trim() !== normalizedGrass) return false;
    if (!normalizedUom) return true;
    const itemUom = normUomForPaceMatch(row.uom);
    return !itemUom || itemUom === normalizedUom;
  });
}

/** True when a plan row has a real schedule date (not empty / `0000-00-00`). */
export function hasRealHarvestScheduleDate(raw: unknown): boolean {
  const t = String(raw ?? "").trim();
  if (!t || t.toLowerCase() === "null") return false;
  return !t.toLowerCase().startsWith("0000-00-00");
}

/**
 * Row already harvested — counts toward **H**.
 * Delivery in the app requires actual date (`hasDownstreamHarvestDates` → actual required).
 */
export function paceRecalcPlanRowCountsAsHarvested(
  row: Record<string, unknown>,
): boolean {
  return hasRealHarvestScheduleDate(row.actual_harvest_date);
}

/**
 * Match one `quantity_required_sprig_sod` line (product + UOM + load_type).
 * Sod → Sprig **Kg** requirement: Sprig Kg + every Sod→Sprig plan row (any row `uom`;
 * legacy rows may still show M² while `quantity` is kg — same as project progress).
 */
export function paceRecalcPlanRowMatchesRequirementLine(
  row: Record<string, unknown>,
  productId: string,
  requiredUom: "Kg" | "M2",
  requiredLoadType: string,
): boolean {
  if (String(row.product_id ?? "").trim() !== productId.trim()) return false;

  const reqUom = normUomForPaceMatch(requiredUom);
  const rowUom = normUomForPaceMatch(row.uom);
  const reqLoad = normalizeHarvestTypeStorageKey(requiredLoadType);
  const rowLoad = planRowLoadTypeKey(row);

  if (reqLoad === "sod_to_sprig" && reqUom === "kg") {
    if (rowLoad === "sod_to_sprig") return true;
    if (rowLoad === "sprig" && rowUom === "kg") return true;
    return false;
  }

  if (reqLoad && rowLoad !== reqLoad) return false;
  if (reqUom && rowUom !== reqUom) return false;
  return true;
}

/** Quantity toward **H** for one requirement line (kg for Sod→Sprig kg lines uses plan `quantity`). */
export function paceRecalcHarvestedQtyForRequirementLine(
  row: Record<string, unknown>,
  requiredUom: "Kg" | "M2",
  requiredLoadType: string,
): number {
  const reqUom = normUomForPaceMatch(requiredUom);
  const reqLoad = normalizeHarvestTypeStorageKey(requiredLoadType);
  const rowLoad = planRowLoadTypeKey(row);

  if (reqLoad === "sod_to_sprig" && reqUom === "kg") {
    const qty = parsePaceQty(row.quantity);
    if (qty > 0) return qty;
    const area = parsePaceQty(row.harvested_area);
    const kgPerM2 = parsePaceQty(row.kg_per_m2);
    if (area > 0 && kgPerM2 > 0) return area * kgPerM2;
    return 0;
  }

  return parsePaceQty(row.quantity);
}

/** Estimate-only row — counts toward **N** (still needs future quantity split). */
export function paceRecalcPlanRowCountsAsRemainingEstimate(
  row: Record<string, unknown>,
): boolean {
  return (
    hasRealHarvestScheduleDate(row.estimated_harvest_date) &&
    !paceRecalcPlanRowCountsAsHarvested(row)
  );
}

/** Remaining quantity to spread across future estimate-only harvests (A). */
export function computeRemainingRequiredQuantity(
  totalRequired: number,
  harvestedSum: number,
): number {
  const total = Math.max(0, totalRequired);
  const harvested = Math.max(0, harvestedSum);
  return Math.max(0, total - harvested);
}

/**
 * Base batch size (B) = floor(A ÷ N, 3 dp). The chronologically last estimate row
 * receives A − (N−1)×B so Σ quantity = A exactly (no overflow).
 */
export function computeQuantityPerRemainingEstimateBatch(
  remainingQuantity: number,
  remainingEstimateCount: number,
): number {
  const n = Math.max(0, Math.floor(remainingEstimateCount));
  if (n <= 0) return 0;
  const aMilli = Math.round(Math.max(0, remainingQuantity) * 1000);
  return Math.floor(aMilli / n) / 1000;
}

/** Per-row quantities after last-row remainder absorption; length = N, sum = A (3 dp). */
export function distributePaceRecalcQuantities(
  remainingQuantity: number,
  remainingEstimateCount: number,
): number[] {
  const n = Math.max(0, Math.floor(remainingEstimateCount));
  if (n <= 0) return [];
  const totalMilli = Math.round(Math.max(0, remainingQuantity) * 1000);
  const baseMilli = Math.floor(totalMilli / n);
  const lastMilli = totalMilli - baseMilli * (n - 1);
  const out = Array.from({ length: n - 1 }, () => baseMilli / 1000);
  out.push(lastMilli / 1000);
  return out;
}

/** Sprig/Kg batch quantity (B) → harvested_area (m²) via zone config Yield (kg/m²). */
export function computeHarvestedAreaM2ForPaceRecalcBatch(
  batchQtyKg: number,
  zoneConfigs: ZoneConfigurationRow[],
  farmId: string,
  productId: string,
  estimatedYmd: string,
): string | undefined {
  if (batchQtyKg <= 0 || !zoneConfigs.length) return undefined;
  const zoneConfig = findZoneConfigForFarmGrass(
    zoneConfigs,
    farmId,
    productId,
    estimatedYmd,
  );
  return harvestAreaM2FromKgAndZoneConfig(batchQtyKg, zoneConfig);
}

export type RecalculatePaceAfterActualParams = {
  harvestId: string;
  projectId: string;
  productId: string;
  uom: string;
  /** Optional — stored on pace_grass_batch_quantities when set. */
  farmId?: string;
  /** Optional — zone config rows for harvested_area = B ÷ Yield (kg/m²) on estimate rows. */
  zoneConfigurations?: ZoneConfigurationRow[];
};

function isKgUom(uom: string): boolean {
  return uom.trim().toLowerCase() === "kg";
}

/** True when server recalc ran but estimate rows still need harvested_area = B ÷ Yield. */
export function paceRecalcNeedsHarvestedAreaSync(
  paceRecalc: unknown,
  uom: string,
): boolean {
  if (!isKgUom(uom)) return false;
  if (!paceRecalc || typeof paceRecalc !== "object") return true;
  const row = paceRecalc as {
    skipped?: boolean;
    harvested_areas_updated?: number;
    updated_harvest_ids?: number[];
    remaining_estimate_count?: number;
  };
  if (row.skipped === true) return false;
  const updatedCount =
    row.updated_harvest_ids?.length ??
    (typeof row.remaining_estimate_count === "number"
      ? row.remaining_estimate_count
      : 0);
  if (updatedCount <= 0) return false;
  return (row.harvested_areas_updated ?? 0) < updatedCount;
}

/** Requirement met (A ≤ 0) but estimate-only rows were not soft-deleted yet. */
export function paceRecalcNeedsSoftDeleteSync(paceRecalc: unknown): boolean {
  if (!paceRecalc || typeof paceRecalc !== "object") return false;
  const row = paceRecalc as {
    skipped?: boolean;
    remaining_quantity?: number;
    remaining_estimate_count?: number;
    soft_deleted_harvest_ids?: number[];
  };
  if (row.skipped === true) return false;
  if (typeof row.remaining_quantity !== "number") return false;
  const estimateCount = row.remaining_estimate_count ?? 0;
  const softDeleted = row.soft_deleted_harvest_ids?.length ?? 0;
  return row.remaining_quantity <= 0 && estimateCount > 0 && softDeleted <= 0;
}

export type RecalculatePaceAfterActualResult = {
  skipped?: boolean;
  reason?: string;
  remainingQuantity?: number;
  remainingEstimateCount?: number;
  quantityPerBatch?: number;
  updatedHarvestIds?: number[];
  /** Estimate-only rows soft-deleted when actual harvests already meet requirement (A ≤ 0). */
  softDeletedHarvestIds?: number[];
  harvestedAreasUpdated?: number;
  paceGrassUpdated?: boolean;
};

export async function recalculatePaceQuantitiesAfterActualHarvest(
  params: RecalculatePaceAfterActualParams,
): Promise<RecalculatePaceAfterActualResult> {
  const harvestId = params.harvestId.trim();
  const projectId = params.projectId.trim();
  const productId = params.productId.trim();
  const uom = params.uom.trim();
  if (!harvestId || !projectId || !productId || !uom) {
    return { skipped: true, reason: "missing_params" };
  }

  const res = await stsProxyPostJson<{
    skipped?: boolean;
    reason?: string;
    remaining_quantity?: number;
    remaining_estimate_count?: number;
    quantity_per_batch?: number;
    updated_harvest_ids?: number[];
    soft_deleted_harvest_ids?: number[];
    harvested_areas_updated?: number;
    pace_grass_updated?: boolean;
  }>(STS_API_PATHS.recalculatePaceAfterActual, {
    harvest_id: harvestId,
    project_id: projectId,
    product_id: productId,
    uom,
    ...(params.farmId?.trim() ? { farm_id: params.farmId.trim() } : {}),
    ...(params.zoneConfigurations?.length
      ? { zone_configurations: params.zoneConfigurations }
      : {}),
  });

  return {
    skipped: res.skipped,
    reason: res.reason,
    remainingQuantity: res.remaining_quantity,
    remainingEstimateCount: res.remaining_estimate_count,
    quantityPerBatch: res.quantity_per_batch,
    updatedHarvestIds: res.updated_harvest_ids,
    softDeletedHarvestIds: res.soft_deleted_harvest_ids,
    harvestedAreasUpdated: res.harvested_areas_updated,
    paceGrassUpdated: res.pace_grass_updated,
  };
}
