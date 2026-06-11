import type { MondayProjectServerRow } from "@/entities/projects";
import { parseQuantityRequiredRows } from "@/shared/lib/parseJsonMaybe";

import {
  harvestPlanProductIdFromRaw,
  harvestPlanScalarFromRaw,
} from "./forecastingInventoryConversion";

export type ResolvedHarvestFarm = {
  farmId: number;
  farmName: string;
};

/** product_id → farm_id from `quantity_required_sprig_sod` lines (grass requirements). */
export function buildRequirementFarmByProjectProduct(
  projectRows: MondayProjectServerRow[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of projectRows) {
    const projectId = String(row.project_id ?? "").trim();
    if (!projectId) continue;
    for (const line of parseQuantityRequiredRows(row.quantity_required_sprig_sod)) {
      const productId = String(line.product_id ?? "").trim();
      const farmId = String(line.farm_id ?? "").trim();
      if (!productId || !farmId) continue;
      map.set(`${projectId}|${productId}`, farmId);
    }
  }
  return map;
}

function buildFarmNameByIdMap(farms: unknown[]): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(farms)) return map;
  for (const row of farms) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const id = String(rec.id ?? "").trim();
    if (!id) continue;
    const name = String(rec.name ?? rec.title ?? "").trim();
    if (name) map.set(id, name);
  }
  return map;
}

/**
 * Resolve effective farm for a harvesting plan row:
 * - Row already has `farm_id` → keep it.
 * - Otherwise → use `quantity_required_sprig_sod.farm_id` for matching `product_id`.
 */
export function resolveHarvestPlanFarm(params: {
  raw: Record<string, unknown>;
  requirementFarmByProjectProduct: Map<string, string>;
  farmNameById: Map<string, string>;
}): ResolvedHarvestFarm {
  const { raw, requirementFarmByProjectProduct, farmNameById } = params;

  const existingFarmIdRaw = harvestPlanScalarFromRaw(raw.farm_id);
  const existingFarmName = String(raw.farm_name ?? "").trim();
  if (existingFarmIdRaw > 0) {
    const farmId = Math.floor(existingFarmIdRaw);
    return {
      farmId,
      farmName: existingFarmName || farmNameById.get(String(farmId)) || "",
    };
  }

  const projectId = String(raw.project_id ?? "").trim();
  const productId = harvestPlanProductIdFromRaw(raw);
  if (!projectId || productId <= 0) {
    return { farmId: 0, farmName: existingFarmName };
  }

  const reqFarmId = requirementFarmByProjectProduct.get(`${projectId}|${productId}`) ?? "";
  const reqFarmIdNum = harvestPlanScalarFromRaw(reqFarmId);
  if (reqFarmIdNum <= 0) {
    return { farmId: 0, farmName: existingFarmName };
  }

  const farmId = Math.floor(reqFarmIdNum);
  return {
    farmId,
    farmName: farmNameById.get(String(farmId)) || existingFarmName,
  };
}

/** Apply grass-requirement farm fallback onto raw harvesting index rows (before forecast mapping). */
export function enrichHarvestRowsWithResolvedFarm(
  harvestRows: Record<string, unknown>[],
  requirementFarmByProjectProduct: Map<string, string>,
  farms: unknown[] = [],
): Record<string, unknown>[] {
  if (!harvestRows.length || requirementFarmByProjectProduct.size === 0) {
    return harvestRows;
  }

  const farmNameById = buildFarmNameByIdMap(farms);

  return harvestRows.map((raw) => {
    const resolved = resolveHarvestPlanFarm({
      raw,
      requirementFarmByProjectProduct,
      farmNameById,
    });
    if (resolved.farmId <= 0) return raw;
    return {
      ...raw,
      farm_id: resolved.farmId,
      farm_name: resolved.farmName || raw.farm_name,
    };
  });
}
