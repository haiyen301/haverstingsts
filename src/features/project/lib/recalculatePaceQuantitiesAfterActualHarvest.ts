import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import { stsProxyPostJson } from "@/shared/api/stsProxyClient";

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
 * Quantity per remaining estimate row (B) = A ÷ N, three decimals (e.g. 313.333).
 */
export function computeQuantityPerRemainingEstimateBatch(
  remainingQuantity: number,
  remainingEstimateCount: number,
): number {
  const n = Math.max(0, Math.floor(remainingEstimateCount));
  if (n <= 0) return 0;
  const a = Math.max(0, remainingQuantity);
  return Math.round((a / n) * 1000) / 1000;
}

export type RecalculatePaceAfterActualParams = {
  harvestId: string;
  projectId: string;
  productId: string;
  uom: string;
  /** Optional — stored on pace_grass_batch_quantities when set. */
  farmId?: string;
};

export type RecalculatePaceAfterActualResult = {
  skipped?: boolean;
  reason?: string;
  remainingQuantity?: number;
  remainingEstimateCount?: number;
  quantityPerBatch?: number;
  updatedHarvestIds?: number[];
  /** Estimate-only rows soft-deleted when actual harvests already meet requirement (A ≤ 0). */
  softDeletedHarvestIds?: number[];
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
    pace_grass_updated?: boolean;
  }>(STS_API_PATHS.recalculatePaceAfterActual, {
    harvest_id: harvestId,
    project_id: projectId,
    product_id: productId,
    uom,
    ...(params.farmId?.trim() ? { farm_id: params.farmId.trim() } : {}),
  });

  return {
    skipped: res.skipped,
    reason: res.reason,
    remainingQuantity: res.remaining_quantity,
    remainingEstimateCount: res.remaining_estimate_count,
    quantityPerBatch: res.quantity_per_batch,
    updatedHarvestIds: res.updated_harvest_ids,
    softDeletedHarvestIds: res.soft_deleted_harvest_ids,
    paceGrassUpdated: res.pace_grass_updated,
  };
}
