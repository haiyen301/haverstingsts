import type { ZoneConfigurationRow } from "@/features/admin/api/adminApi";
import { deleteMondayParentOrSubItem } from "@/entities/projects";
import type { HarvestPlanRowForPaceRecalc } from "@/features/project/lib/buildPaceGrassBatchQuantitiesFromHarvestRecalc";
import type { GrassRequirementForPaceRecalc } from "@/features/project/lib/buildPaceGrassBatchQuantitiesFromHarvestRecalc";
import { grassRequirementsToHarvestPlanFormat } from "@/features/project/lib/buildPaceGrassBatchQuantitiesFromHarvestRecalc";
import {
  estimateTotalHarvestBatches,
  findZoneConfigForFarmGrass,
  generatePlannedHarvestsForNewProject,
  harvestAreaM2FromKgAndZoneConfig,
  type GrassRequirementForHarvestPlan,
  type PaceGrassBatchQuantity,
  type PlannedHarvestSeed,
  type ProjectPaceConfig,
  persistPlannedHarvestSeedsForProject,
  type PaceHarvestDateSpan,
} from "@/features/project/lib/generatePlannedHarvestsForNewProject";
import {
  computeHarvestedAreaM2ForPaceRecalcBatch,
  computeQuantityPerRemainingEstimateBatch,
  distributePaceRecalcQuantities,
  paceRecalcHarvestedQtyForRequirementLine,
  paceRecalcKgLoadTypeContextForProduct,
  paceRecalcPlanRowCountsAsHarvested,
  paceRecalcPlanRowCountsAsRemainingEstimate,
  paceRecalcPlanRowMatchesRequirementLine,
} from "@/features/project/lib/recalculatePaceQuantitiesAfterActualHarvest";
import {
  defaultHarvestTypeForUom,
  normalizeHarvestTypeStorageKey,
  type HarvestTypeStorageKey,
} from "@/shared/lib/harvestType";

function formatPaceQuantityStr(qty: number): string {
  if (!Number.isFinite(qty) || qty < 0) return "0";
  const fixed = qty.toFixed(3);
  const trimmed = fixed.replace(/\.?0+$/, "");
  return trimmed || "0";
}

function paceKgContextFromRequirementLines(
  lines: ReadonlyArray<{
    productId: string;
    uom: string;
    loadType?: HarvestTypeStorageKey | string;
  }>,
  productId: string,
) {
  return paceRecalcKgLoadTypeContextForProduct(
    lines.map((r) => ({
      product_id: r.productId,
      uom: r.uom,
      load_type: r.loadType,
    })),
    productId,
  );
}

function paceKgContextFromGrassRequirements(
  grassRequirements: GrassRequirementForPaceRecalc[],
  productId: string,
) {
  return paceKgContextFromRequirementLines(grassRequirements, productId);
}

function countActualHarvestBatchesForGrassLine(
  harvestPlanRows: HarvestPlanRowForPaceRecalc[],
  productId: string,
  uom: "Kg" | "M2",
  loadType: HarvestTypeStorageKey,
  kgLoadTypeContext?: ReturnType<typeof paceRecalcKgLoadTypeContextForProduct>,
): number {
  let count = 0;
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
    if (paceRecalcPlanRowCountsAsHarvested(row)) {
      count += 1;
    }
  }
  return count;
}

export function isGrassRequirementFulfilledByActualHarvests(
  harvestPlanRows: HarvestPlanRowForPaceRecalc[],
  productId: string,
  uom: "Kg" | "M2",
  loadType: HarvestTypeStorageKey,
  totalRequired: number,
  allGrassRequirements?: GrassRequirementForPaceRecalc[],
): boolean {
  const required = Math.max(0, totalRequired);
  if (required <= 0 || !productId.trim()) return false;
  const kgContext = allGrassRequirements
    ? paceKgContextFromGrassRequirements(allGrassRequirements, productId)
    : undefined;
  const harvestedSum = harvestedSumForGrassLine(
    harvestPlanRows,
    productId,
    uom,
    loadType,
    kgContext,
  );
  return harvestedSum >= required;
}

export function areAllGrassRequirementsFulfilledByActualHarvests(
  grassRequirements: GrassRequirementForPaceRecalc[],
  harvestPlanRows: HarvestPlanRowForPaceRecalc[],
): boolean {
  const reqs = grassRequirements.filter(
    (r) => r.productId.trim() && r.totalRequired > 0,
  );
  if (reqs.length === 0) return false;
  return reqs.every((req) =>
    isGrassRequirementFulfilledByActualHarvests(
      harvestPlanRows,
      req.productId,
      req.uom,
      req.loadType,
      req.totalRequired,
      grassRequirements,
    ),
  );
}

function harvestedSumForGrassLine(
  harvestPlanRows: HarvestPlanRowForPaceRecalc[],
  productId: string,
  uom: "Kg" | "M2",
  loadType: HarvestTypeStorageKey,
  kgLoadTypeContext?: ReturnType<typeof paceRecalcKgLoadTypeContextForProduct>,
): number {
  let sum = 0;
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
    if (!paceRecalcPlanRowCountsAsHarvested(row)) continue;
    sum += paceRecalcHarvestedQtyForRequirementLine(row, uom, loadType);
  }
  return sum;
}

function collectEstimateHarvestRowsToDelete(
  harvestPlanRows: HarvestPlanRowForPaceRecalc[],
): HarvestPlanRowForPaceRecalc[] {
  return harvestPlanRows.filter((row) =>
    paceRecalcPlanRowCountsAsRemainingEstimate(row),
  );
}

function collectEstimateHarvestRowsToDeleteForFulfilledGrassRequirements(opts: {
  grassRequirements: GrassRequirementForPaceRecalc[];
  harvestPlanRows: HarvestPlanRowForPaceRecalc[];
}): HarvestPlanRowForPaceRecalc[] {
  const out: HarvestPlanRowForPaceRecalc[] = [];
  const seenIds = new Set<string>();

  for (const req of opts.grassRequirements) {
    if (
      !isGrassRequirementFulfilledByActualHarvests(
        opts.harvestPlanRows,
        req.productId,
        req.uom,
        req.loadType,
        req.totalRequired,
        opts.grassRequirements,
      )
    ) {
      continue;
    }

    const kgContext = paceKgContextFromGrassRequirements(
      opts.grassRequirements,
      req.productId,
    );

    for (const row of opts.harvestPlanRows) {
      if (
        !paceRecalcPlanRowMatchesRequirementLine(
          row,
          req.productId,
          req.uom,
          req.loadType,
          kgContext,
        )
      ) {
        continue;
      }
      if (!paceRecalcPlanRowCountsAsRemainingEstimate(row)) continue;

      const rowId = String(row.id ?? "").trim();
      if (!rowId || seenIds.has(rowId)) continue;
      seenIds.add(rowId);
      out.push(row);
    }
  }

  return out;
}

function countExistingEstimateBatchesForGrassLine(
  harvestPlanRows: HarvestPlanRowForPaceRecalc[],
  productId: string,
  uom: "Kg" | "M2",
  loadType: HarvestTypeStorageKey,
  kgLoadTypeContext?: ReturnType<typeof paceRecalcKgLoadTypeContextForProduct>,
): number {
  let count = 0;
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
    if (paceRecalcPlanRowCountsAsRemainingEstimate(row)) {
      count += 1;
    }
  }
  return count;
}

/** Grass line on harvest plan but fewer estimate batches than pace requires after actuals. */
export function grassRequirementNeedsPrivilegedRecalcSupplementalSeeds(opts: {
  paceConfig: ProjectPaceConfig;
  req: GrassRequirementForPaceRecalc;
  harvestPlanRows: HarvestPlanRowForPaceRecalc[];
  allGrassRequirements?: GrassRequirementForPaceRecalc[];
}): boolean {
  const productId = opts.req.productId.trim();
  const totalRequired = Math.max(0, opts.req.totalRequired);
  if (!productId || totalRequired <= 0) return false;

  if (
    isGrassRequirementFulfilledByActualHarvests(
      opts.harvestPlanRows,
      opts.req.productId,
      opts.req.uom,
      opts.req.loadType,
      opts.req.totalRequired,
      opts.allGrassRequirements,
    )
  ) {
    return false;
  }

  const kgContext = opts.allGrassRequirements
    ? paceKgContextFromGrassRequirements(opts.allGrassRequirements, productId)
    : undefined;
  const totalBatches = estimateTotalHarvestBatches(opts.paceConfig);
  const actualBatchCount = countActualHarvestBatchesForGrassLine(
    opts.harvestPlanRows,
    productId,
    opts.req.uom,
    opts.req.loadType,
    kgContext,
  );
  const existingEstimateCount = countExistingEstimateBatchesForGrassLine(
    opts.harvestPlanRows,
    productId,
    opts.req.uom,
    opts.req.loadType,
    kgContext,
  );
  const neededEstimateSlots = Math.max(0, totalBatches - actualBatchCount);
  return neededEstimateSlots > existingEstimateCount;
}

/** Privileged balance recalc: only the missing estimate rows for existing plan lines. */
export function buildPrivilegedRecalcSupplementalEstimateSeeds(opts: {
  paceConfig: ProjectPaceConfig;
  estimatedStartYmd: string;
  grassRequirements: GrassRequirementForPaceRecalc[];
  harvestPlanRows: HarvestPlanRowForPaceRecalc[];
  zoneConfigurations?: ZoneConfigurationRow[];
}): PlannedHarvestSeed[] {
  const totalBatches = estimateTotalHarvestBatches(opts.paceConfig);
  const out: PlannedHarvestSeed[] = [];

  for (const req of opts.grassRequirements) {
    const productId = req.productId.trim();
    const totalRequired = Math.max(0, req.totalRequired);
    if (!productId || totalRequired <= 0) continue;

    if (
      isGrassRequirementFulfilledByActualHarvests(
        opts.harvestPlanRows,
        req.productId,
        req.uom,
        req.loadType,
        req.totalRequired,
        opts.grassRequirements,
      )
    ) {
      continue;
    }

    const harvestPlanReq = grassRequirementsToHarvestPlanFormat([req])[0];
    if (!harvestPlanReq) continue;

    const kgContext = paceKgContextFromGrassRequirements(
      opts.grassRequirements,
      productId,
    );
    const actualBatchCount = countActualHarvestBatchesForGrassLine(
      opts.harvestPlanRows,
      productId,
      req.uom,
      req.loadType,
      kgContext,
    );
    const existingEstimateCount = countExistingEstimateBatchesForGrassLine(
      opts.harvestPlanRows,
      productId,
      req.uom,
      req.loadType,
      kgContext,
    );
    const neededEstimateSlots = Math.max(0, totalBatches - actualBatchCount);
    const missingCount = Math.max(0, neededEstimateSlots - existingEstimateCount);
    if (missingCount <= 0) continue;

    const targetSeeds = buildRegeneratedEstimateSeedsForPaceChange({
      paceConfig: opts.paceConfig,
      estimatedStartYmd: opts.estimatedStartYmd,
      grassRequirements: [harvestPlanReq],
      harvestPlanRows: opts.harvestPlanRows,
      zoneConfigurations: opts.zoneConfigurations,
    });
    if (targetSeeds.length <= existingEstimateCount) continue;

    const supplemental = targetSeeds.slice(existingEstimateCount);
    const toAdd = supplemental.slice(0, missingCount);
    out.push(...toAdd);
  }

  return out;
}

/**
 * Planned estimate seeds for a new pace — skips the first `actualBatchCount` schedule
 * slots (already consumed by actual harvests) and spreads remaining quantity across
 * the rest.
 */
export function buildRegeneratedEstimateSeedsForPaceChange(opts: {
  paceConfig: ProjectPaceConfig;
  estimatedStartYmd: string;
  grassRequirements: GrassRequirementForHarvestPlan[];
  harvestPlanRows: HarvestPlanRowForPaceRecalc[];
  zoneConfigurations?: ZoneConfigurationRow[];
}): PlannedHarvestSeed[] {
  const totalBatches = estimateTotalHarvestBatches(opts.paceConfig);
  const out: PlannedHarvestSeed[] = [];

  for (const req of opts.grassRequirements) {
    const productId = req.productId.trim();
    const loadType =
      normalizeHarvestTypeStorageKey(req.loadType) ||
      defaultHarvestTypeForUom(req.uom);
    const uom = loadType === "sod" ? "M2" : "Kg";
    const totalRequired = Math.max(0, req.amountRequired);
    if (!productId || totalRequired <= 0) continue;

    const kgContext = paceKgContextFromRequirementLines(
      opts.grassRequirements.map((r) => ({
        productId: r.productId,
        uom: r.uom,
        loadType: r.loadType,
      })),
      productId,
    );
    const actualBatchCount = countActualHarvestBatchesForGrassLine(
      opts.harvestPlanRows,
      productId,
      uom,
      loadType,
      kgContext,
    );
    const estimateBatchCount = Math.max(0, totalBatches - actualBatchCount);
    if (estimateBatchCount <= 0) continue;

    const harvestedSum = harvestedSumForGrassLine(
      opts.harvestPlanRows,
      productId,
      uom,
      loadType,
      kgContext,
    );
    const remainingQuantity = Math.max(0, totalRequired - harvestedSum);
    if (remainingQuantity <= 0) continue;

    const batchQuantities = distributePaceRecalcQuantities(
      remainingQuantity,
      estimateBatchCount,
    );

    const fullSeeds = generatePlannedHarvestsForNewProject({
      paceConfig: opts.paceConfig,
      estimatedStartYmd: opts.estimatedStartYmd,
      grassRequirements: [req],
      zoneConfigurations: opts.zoneConfigurations,
    });
    const scheduleSeeds = fullSeeds.slice(actualBatchCount, totalBatches);

    for (let i = 0; i < scheduleSeeds.length && i < batchQuantities.length; i++) {
      const seed = scheduleSeeds[i]!;
      const qty = batchQuantities[i] ?? 0;
      let harvestedArea = seed.harvestedArea;
      if (
        (loadType === "sprig" || loadType === "sod_to_sprig") &&
        uom === "Kg" &&
        req.farmId?.trim() &&
        (opts.zoneConfigurations?.length ?? 0) > 0
      ) {
        harvestedArea =
          computeHarvestedAreaM2ForPaceRecalcBatch(
            qty,
            opts.zoneConfigurations ?? [],
            req.farmId.trim(),
            productId,
            seed.estimatedHarvestDate,
          ) ??
          harvestAreaM2FromKgAndZoneConfig(
            qty,
            findZoneConfigForFarmGrass(
              opts.zoneConfigurations ?? [],
              req.farmId.trim(),
              productId,
              seed.estimatedHarvestDate,
            ),
          );
      }
      out.push({
        ...seed,
        quantity: formatPaceQuantityStr(qty),
        ...(harvestedArea ? { harvestedArea } : {}),
      });
    }
  }

  return out;
}

/** `pace_grass_batch_quantities` after pace change — B from remaining qty ÷ new estimate count. */
export function buildPaceGrassBatchQuantitiesAfterPaceChange(opts: {
  paceConfig: ProjectPaceConfig;
  grassRequirements: GrassRequirementForPaceRecalc[];
  harvestPlanRows: HarvestPlanRowForPaceRecalc[];
}): PaceGrassBatchQuantity[] {
  const totalBatches = estimateTotalHarvestBatches(opts.paceConfig);
  const out: PaceGrassBatchQuantity[] = [];

  for (const req of opts.grassRequirements) {
    const productId = req.productId.trim();
    const totalRequired = Math.max(0, req.totalRequired);
    if (!productId || totalRequired <= 0) continue;

    const kgContext = paceKgContextFromGrassRequirements(
      opts.grassRequirements,
      productId,
    );
    const actualBatchCount = countActualHarvestBatchesForGrassLine(
      opts.harvestPlanRows,
      productId,
      req.uom,
      req.loadType,
      kgContext,
    );
    const estimateBatchCount = Math.max(0, totalBatches - actualBatchCount);
    if (estimateBatchCount <= 0) continue;

    const harvestedSum = harvestedSumForGrassLine(
      opts.harvestPlanRows,
      productId,
      req.uom,
      req.loadType,
      kgContext,
    );
    const remainingQuantity = Math.max(0, totalRequired - harvestedSum);
    if (remainingQuantity <= 0) continue;

    const qty = computeQuantityPerRemainingEstimateBatch(
      remainingQuantity,
      estimateBatchCount,
    );

    const entry: PaceGrassBatchQuantity = {
      grass_id: productId,
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

async function deleteHarvestPlanRows(opts: {
  rows: HarvestPlanRowForPaceRecalc[];
  fallbackTableId?: string;
}): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;

  for (const row of opts.rows) {
    const rowId = String(row.id ?? "").trim();
    const tableId =
      String(row.table_id ?? "").trim() ||
      String(opts.fallbackTableId ?? "").trim();
    if (!rowId || !tableId) {
      failed += 1;
      continue;
    }
    try {
      await deleteMondayParentOrSubItem({
        tableId,
        tableName: String(row.table_name ?? "").trim() || "Harvesting",
        rowId,
        type: "sub",
      });
      deleted += 1;
    } catch {
      failed += 1;
    }
  }

  return { deleted, failed };
}

/** Privileged balance recalc: remove estimate rows for fulfilled grass lines. */
export async function deleteFulfilledGrassEstimateHarvestRows(opts: {
  grassRequirements: GrassRequirementForPaceRecalc[];
  harvestPlanRows: HarvestPlanRowForPaceRecalc[];
  fallbackTableId?: string;
}): Promise<{
  deleted: number;
  failed: number;
  allRequirementsFulfilled: boolean;
}> {
  const allRequirementsFulfilled = areAllGrassRequirementsFulfilledByActualHarvests(
    opts.grassRequirements,
    opts.harvestPlanRows,
  );
  const rows = collectEstimateHarvestRowsToDeleteForFulfilledGrassRequirements({
    grassRequirements: opts.grassRequirements,
    harvestPlanRows: opts.harvestPlanRows,
  });
  if (rows.length === 0) {
    return { deleted: 0, failed: 0, allRequirementsFulfilled };
  }

  const deleteResult = await deleteHarvestPlanRows({
    rows,
    fallbackTableId: opts.fallbackTableId,
  });

  return {
    deleted: deleteResult.deleted,
    failed: deleteResult.failed,
    allRequirementsFulfilled,
  };
}

export async function deleteEstimateHarvestRowsForPaceChange(opts: {
  harvestPlanRows: HarvestPlanRowForPaceRecalc[];
  fallbackTableId?: string;
}): Promise<{ deleted: number; failed: number }> {
  return deleteHarvestPlanRows({
    rows: collectEstimateHarvestRowsToDelete(opts.harvestPlanRows),
    fallbackTableId: opts.fallbackTableId,
  });
}

export async function runProjectPaceChangeHarvestRegeneration(opts: {
  projectId: string;
  countryId: string;
  customerId: string;
  userId: string | undefined;
  paceConfig: ProjectPaceConfig;
  estimatedStartYmd: string;
  grassRequirements: GrassRequirementForHarvestPlan[];
  harvestPlanRows: HarvestPlanRowForPaceRecalc[];
  zoneConfigurations?: ZoneConfigurationRow[];
  paceSnapshotSpan?: PaceHarvestDateSpan | null;
  fallbackTableId?: string;
}): Promise<{
  deleted: number;
  deleteFailed: number;
  created: number;
  createFailed: number;
  firstCreateMessage: string | null;
  allRequirementsFulfilled: boolean;
}> {
  const grassReqsForFulfillment: GrassRequirementForPaceRecalc[] =
    opts.grassRequirements.map((r) => ({
      productId: r.productId,
      uom: r.uom as "Kg" | "M2",
      loadType:
        normalizeHarvestTypeStorageKey(r.loadType) ||
        defaultHarvestTypeForUom(r.uom),
      totalRequired: r.amountRequired,
      farmId: r.farmId || undefined,
    }));
  const allRequirementsFulfilled = areAllGrassRequirementsFulfilledByActualHarvests(
    grassReqsForFulfillment,
    opts.harvestPlanRows,
  );

  const { deleted, failed: deleteFailed } =
    await deleteEstimateHarvestRowsForPaceChange({
      harvestPlanRows: opts.harvestPlanRows,
      fallbackTableId: opts.fallbackTableId,
    });

  const seeds = buildRegeneratedEstimateSeedsForPaceChange({
    paceConfig: opts.paceConfig,
    estimatedStartYmd: opts.estimatedStartYmd,
    grassRequirements: opts.grassRequirements,
    harvestPlanRows: opts.harvestPlanRows,
    zoneConfigurations: opts.zoneConfigurations,
  });

  if (seeds.length === 0) {
    return {
      deleted,
      deleteFailed,
      created: 0,
      createFailed: 0,
      firstCreateMessage: null,
      allRequirementsFulfilled,
    };
  }

  const { ok, fail, firstMessage } = await persistPlannedHarvestSeedsForProject({
    projectId: opts.projectId,
    countryId: opts.countryId,
    customerId: opts.customerId,
    userId: opts.userId,
    seeds,
    paceSnapshotSpan: opts.paceSnapshotSpan,
  });

  return {
    deleted,
    deleteFailed,
    created: ok,
    createFailed: fail,
    firstCreateMessage: firstMessage,
    allRequirementsFulfilled,
  };
}
