import {
  buildPaceGrassBatchQuantities,
  paceRemainingEstimateBatchCount,
  todayLocalYmd,
  type GrassRequirementForHarvestPlan,
  type PaceGrassBatchQuantity,
  type ProjectPaceConfig,
} from "@/features/project/lib/generatePlannedHarvestsForNewProject";
import type { HarvestTypeStorageKey } from "@/shared/lib/harvestType";
import {
  computeQuantityPerRemainingEstimateBatch,
  paceRecalcHarvestedQtyForRequirementLine,
  paceRecalcKgLoadTypeContextForProduct,
  paceRecalcPlanRowCountsAsHarvested,
  paceRecalcPlanRowCountsAsRemainingEstimate,
  paceRecalcPlanRowIsPastEstimate,
  paceRecalcPlanRowMatchesRequirementLine,
  recalculatePaceQuantitiesAfterActualHarvest,
} from "@/features/project/lib/recalculatePaceQuantitiesAfterActualHarvest";
import type { ZoneConfigurationRow } from "@/features/admin/api/adminApi";
import { stsProxyGetHarvestingIndex } from "@/shared/api/stsProxyClient";

/** Raw `project_harvesting_plan` row from `/api/harvesting`. */
export type HarvestPlanRowForPaceRecalc = Record<string, unknown>;

export type GrassRequirementForPaceRecalc = {
  productId: string;
  uom: "Kg" | "M2";
  /** From `quantity_required_sprig_sod.load_type` (sprig / sod / sod_to_sprig). */
  loadType: HarvestTypeStorageKey;
  totalRequired: number;
  farmId?: string;
};

export type PaceRecalcGrassLineSummary = {
  productId: string;
  uom: "Kg" | "M2";
  totalRequired: number;
  harvestedSum: number;
  remainingEstimateCount: number;
  remainingQuantity: number;
  quantityPerBatch: number;
  harvestIdForApi?: string;
};

export type PaceRecalcGrassLineContext = {
  paceConfig: ProjectPaceConfig;
  estimatedStartYmd: string;
  referenceYmd?: string;
};

function normUom(uom: string): string {
  return String(uom ?? "")
    .trim()
    .toLowerCase()
    .replace(/²/g, "2")
    .replace(/\s/g, "");
}

function parseQuantity(raw: unknown): number {
  const n = Number(String(raw ?? "").replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function formatPaceQuantityStr(qty: number): string {
  if (!Number.isFinite(qty) || qty < 0) return "0";
  const fixed = qty.toFixed(3);
  const trimmed = fixed.replace(/\.?0+$/, "");
  return trimmed || "0";
}

function paceGrassBatchQuantityKey(entry: PaceGrassBatchQuantity): string {
  const loadType = String(entry.load_type ?? "").trim().toLowerCase();
  return `${String(entry.grass_id ?? "").trim()}|${String(entry.uom ?? "").trim().toLowerCase()}|${loadType}`;
}

function kgLoadTypeContextForGrassRequirements(
  grassRequirements: GrassRequirementForPaceRecalc[],
  productId: string,
) {
  return paceRecalcKgLoadTypeContextForProduct(
    grassRequirements.map((r) => ({
      product_id: r.productId,
      uom: r.uom,
      load_type: r.loadType,
    })),
    productId,
  );
}

/** True when at least one harvest plan row matches the grass requirement line. */
export function grassRequirementHasHarvestPlanRows(
  harvestPlanRows: HarvestPlanRowForPaceRecalc[],
  req: GrassRequirementForPaceRecalc,
  allGrassRequirements?: GrassRequirementForPaceRecalc[],
): boolean {
  const productId = req.productId.trim();
  if (!productId) return false;
  const kgContext = allGrassRequirements
    ? kgLoadTypeContextForGrassRequirements(allGrassRequirements, productId)
    : undefined;
  for (const row of harvestPlanRows) {
    if (
      paceRecalcPlanRowMatchesRequirementLine(
        row,
        productId,
        req.uom,
        req.loadType,
        kgContext,
      )
    ) {
      return true;
    }
  }
  return false;
}

/** Split grass lines into those already on the harvest plan vs newly added on edit. */
export function partitionGrassRequirementsByHarvestPlanPresence(opts: {
  grassRequirements: GrassRequirementForPaceRecalc[];
  harvestPlanRows: HarvestPlanRowForPaceRecalc[];
}): {
  withPlanRows: GrassRequirementForPaceRecalc[];
  withoutPlanRows: GrassRequirementForPaceRecalc[];
} {
  const withPlanRows: GrassRequirementForPaceRecalc[] = [];
  const withoutPlanRows: GrassRequirementForPaceRecalc[] = [];

  for (const req of opts.grassRequirements) {
    const totalRequired = Math.max(0, req.totalRequired);
    if (totalRequired <= 0 || !req.productId.trim()) continue;
    if (
      grassRequirementHasHarvestPlanRows(
        opts.harvestPlanRows,
        req,
        opts.grassRequirements,
      )
    ) {
      withPlanRows.push(req);
    } else {
      withoutPlanRows.push(req);
    }
  }

  return { withPlanRows, withoutPlanRows };
}

export function grassRequirementsToHarvestPlanFormat(
  grassRequirements: GrassRequirementForPaceRecalc[],
): GrassRequirementForHarvestPlan[] {
  return grassRequirements.map((req) => ({
    productId: req.productId.trim(),
    uom: req.uom,
    loadType: req.loadType,
    amountRequired: Math.max(0, req.totalRequired),
    ...(req.farmId?.trim() ? { farmId: req.farmId.trim() } : {}),
  }));
}

function mergePaceGrassBatchQuantities(
  ...groups: PaceGrassBatchQuantity[][]
): PaceGrassBatchQuantity[] {
  const merged = new Map<string, PaceGrassBatchQuantity>();
  for (const group of groups) {
    for (const entry of group) {
      merged.set(paceGrassBatchQuantityKey(entry), entry);
    }
  }
  return Array.from(merged.values());
}

/**
 * Privileged balance recalc on project edit:
 * - existing plan lines → A÷N from current harvest state
 * - new lines (when pace config provided) → initial T÷total_batches split
 */
export function buildPaceGrassBatchQuantitiesForPrivilegedRecalc(opts: {
  grassRequirements: GrassRequirementForPaceRecalc[];
  harvestPlanRows: HarvestPlanRowForPaceRecalc[];
  paceConfig?: ProjectPaceConfig;
  estimatedStartYmd?: string;
}): PaceGrassBatchQuantity[] {
  const { withPlanRows, withoutPlanRows } =
    partitionGrassRequirementsByHarvestPlanPresence({
      grassRequirements: opts.grassRequirements,
      harvestPlanRows: opts.harvestPlanRows,
    });

  const paceContext =
    opts.paceConfig && opts.estimatedStartYmd?.trim()
      ? {
          paceConfig: opts.paceConfig,
          estimatedStartYmd: opts.estimatedStartYmd.trim(),
        }
      : undefined;

  const fromRecalc = buildPaceGrassBatchQuantitiesFromHarvestRecalc({
    grassRequirements: withPlanRows,
    harvestPlanRows: opts.harvestPlanRows,
    paceContext,
  });

  const fromNew =
    opts.paceConfig && withoutPlanRows.length > 0
      ? buildPaceGrassBatchQuantities({
          paceConfig: opts.paceConfig,
          grassRequirements: grassRequirementsToHarvestPlanFormat(
            withoutPlanRows,
          ),
        })
      : [];

  return mergePaceGrassBatchQuantities(fromRecalc, fromNew);
}

/** T, H, N, A, B for one grass requirement line — mirrors doc §2. */
export function summarizePaceRecalcGrassLine(
  harvestPlanRows: HarvestPlanRowForPaceRecalc[],
  productId: string,
  uom: "Kg" | "M2",
  loadType: HarvestTypeStorageKey,
  totalRequired: number,
  allGrassRequirements?: GrassRequirementForPaceRecalc[],
  paceContext?: PaceRecalcGrassLineContext,
): PaceRecalcGrassLineSummary {
  const kgLoadTypeContext = allGrassRequirements
    ? paceRecalcKgLoadTypeContextForProduct(
        allGrassRequirements.map((r) => ({
          product_id: r.productId,
          uom: r.uom,
          load_type: r.loadType,
        })),
        productId,
      )
    : undefined;
  let harvestedSum = 0;
  let remainingEstimateCount = 0;
  let actualBatchCount = 0;
  let harvestIdForApi: string | undefined;
  let firstRowId: string | undefined;
  const referenceYmd = paceContext?.referenceYmd ?? todayLocalYmd();

  for (const row of harvestPlanRows) {
    if (
      !paceRecalcPlanRowMatchesRequirementLine(
        row,
        productId,
        uom,
        loadType,
        kgLoadTypeContext,
      )
    ) {
      continue;
    }
    const rowId = String(row.id ?? "").trim();
    if (rowId && !firstRowId) firstRowId = rowId;

    if (paceRecalcPlanRowCountsAsHarvested(row)) {
      actualBatchCount += 1;
      harvestedSum += paceRecalcHarvestedQtyForRequirementLine(
        row,
        uom,
        loadType,
      );
      if (rowId) harvestIdForApi = rowId;
    } else if (paceRecalcPlanRowCountsAsRemainingEstimate(row)) {
      if (!paceRecalcPlanRowIsPastEstimate(row, referenceYmd)) {
        remainingEstimateCount += 1;
      }
      if (!harvestIdForApi && rowId) harvestIdForApi = rowId;
    }
  }

  if (
    paceContext &&
    paceContext.estimatedStartYmd.trim() &&
    paceContext.paceConfig
  ) {
    remainingEstimateCount = paceRemainingEstimateBatchCount({
      paceConfig: paceContext.paceConfig,
      estimatedStartYmd: paceContext.estimatedStartYmd,
      actualBatchCount,
      referenceYmd,
    });
  }

  if (!harvestIdForApi && firstRowId) harvestIdForApi = firstRowId;

  const remainingQuantity = Math.max(0, totalRequired - harvestedSum);
  const quantityPerBatch = computeQuantityPerRemainingEstimateBatch(
    remainingQuantity,
    remainingEstimateCount,
  );

  return {
    productId: productId.trim(),
    uom,
    totalRequired,
    harvestedSum,
    remainingEstimateCount,
    remainingQuantity,
    quantityPerBatch,
    harvestIdForApi,
  };
}

/**
 * Build `pace_grass_batch_quantities` from current harvest plan state (A, N, B base)
 * instead of initial project-pace ÷ total batches.
 */
export function buildPaceGrassBatchQuantitiesFromHarvestRecalc(opts: {
  grassRequirements: GrassRequirementForPaceRecalc[];
  harvestPlanRows: HarvestPlanRowForPaceRecalc[];
  paceContext?: PaceRecalcGrassLineContext;
}): PaceGrassBatchQuantity[] {
  const out: PaceGrassBatchQuantity[] = [];

  for (const req of opts.grassRequirements) {
    const totalRequired = Math.max(0, req.totalRequired);
    if (totalRequired <= 0 || !req.productId.trim()) continue;

    const summary = summarizePaceRecalcGrassLine(
      opts.harvestPlanRows,
      req.productId,
      req.uom,
      req.loadType,
      totalRequired,
      opts.grassRequirements,
      opts.paceContext,
    );

    // Doc §2: N = 0 → không chia, không ghi pace B cho dòng đó.
    if (summary.remainingEstimateCount <= 0) {
      continue;
    }

    const qty =
      summary.remainingQuantity > 0 ? summary.quantityPerBatch : 0;

    const entry: PaceGrassBatchQuantity = {
      grass_id: req.productId.trim(),
      quantity: formatPaceQuantityStr(qty),
      uom: req.uom,
      load_type: req.loadType,
    };
    const farmId = req.farmId?.trim();
    if (farmId) entry.farm_id = farmId;
    out.push(entry);
  }

  return out;
}

export async function fetchAllHarvestPlanRowsForProject(
  projectId: string,
  userId?: number,
): Promise<HarvestPlanRowForPaceRecalc[]> {
  const pid = projectId.trim();
  if (!pid) return [];

  let page = 1;
  const perPage = 200;
  const maxPages = 50;
  const allRows: HarvestPlanRowForPaceRecalc[] = [];

  for (;;) {
    const res = await stsProxyGetHarvestingIndex({
      project_id: pid,
      page,
      per_page: perPage,
      ...(userId != null && userId > 0 ? { user_id: userId } : {}),
      view_all_data_module: "harvests",
    });
    const pageRows = res.rows.filter(
      (x): x is HarvestPlanRowForPaceRecalc =>
        !!x && typeof x === "object",
    );
    if (pageRows.length === 0) break;
    allRows.push(...pageRows);

    const totalRecords = res.totalRecords;
    if (
      totalRecords != null &&
      Number.isFinite(totalRecords) &&
      allRows.length >= totalRecords
    ) {
      break;
    }
    if (pageRows.length < perPage) break;
    page += 1;
    if (page > maxPages) break;
  }

  return allRows;
}

/** After project save: rebalance estimate rows + harvested_area per grass line (doc §2). */
export async function runPaceHarvestRecalcForProjectGrassLines(opts: {
  projectId: string;
  grassRequirements: GrassRequirementForPaceRecalc[];
  harvestPlanRows: HarvestPlanRowForPaceRecalc[];
  zoneConfigurations?: ZoneConfigurationRow[];
  paceContext?: PaceRecalcGrassLineContext;
}): Promise<{ ok: number; fail: number }> {
  let ok = 0;
  let fail = 0;

  for (const req of opts.grassRequirements) {
    const totalRequired = Math.max(0, req.totalRequired);
    if (totalRequired <= 0 || !req.productId.trim()) continue;

    const summary = summarizePaceRecalcGrassLine(
      opts.harvestPlanRows,
      req.productId,
      req.uom,
      req.loadType,
      totalRequired,
      opts.grassRequirements,
      opts.paceContext,
    );
    if (summary.remainingEstimateCount <= 0) continue;
    const harvestId = summary.harvestIdForApi?.trim();
    if (!harvestId) {
      fail += 1;
      continue;
    }

    try {
      const result = await recalculatePaceQuantitiesAfterActualHarvest({
        harvestId,
        projectId: opts.projectId.trim(),
        productId: req.productId.trim(),
        uom: req.uom,
        loadType: req.loadType,
        farmId: req.farmId?.trim() || undefined,
        zoneConfigurations: opts.zoneConfigurations,
        estimatedStartYmd: opts.paceContext?.estimatedStartYmd,
      });
      if (result.skipped) {
        fail += 1;
      } else {
        ok += 1;
      }
    } catch {
      fail += 1;
    }
  }

  return { ok, fail };
}
