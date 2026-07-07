import type { ProjectPaceRow, ZoneConfigurationRow } from "@/features/admin/api/adminApi";
import type { MondayProjectServerRow } from "@/entities/projects";
import { updateMondayProjectParentItem } from "@/entities/projects";
import {
  buildPaceGrassBatchQuantitiesForPrivilegedRecalc,
  fetchAllHarvestPlanRowsForProject,
  grassRequirementsToHarvestPlanFormat,
  partitionGrassRequirementsByHarvestPlanPresence,
  runPaceHarvestRecalcForProjectGrassLines,
  summarizePaceRecalcGrassLine,
  type GrassRequirementForPaceRecalc,
  type HarvestPlanRowForPaceRecalc,
} from "@/features/project/lib/buildPaceGrassBatchQuantitiesFromHarvestRecalc";
import {
  buildPrivilegedRecalcSupplementalEstimateSeeds,
  collectEstimateHarvestRowsToDeleteForFulfilledGrassRequirements,
  collectPastEstimateHarvestRows,
  deleteFulfilledGrassEstimateHarvestRows,
  deletePastEstimateHarvestRows,
  grassRequirementNeedsPrivilegedRecalcSupplementalSeeds,
  isGrassRequirementFulfilledByActualHarvests,
} from "@/features/project/lib/regenerateEstimateHarvestsOnProjectPaceChange";
import {
  computeHarvestedAreaM2ForPaceRecalcBatch,
  distributePaceRecalcQuantities,
  paceRecalcKgLoadTypeContextForProduct,
  paceRecalcPlanRowCountsAsHarvested,
  paceRecalcPlanRowCountsAsRemainingEstimate,
  paceRecalcPlanRowMatchesRequirementLine,
} from "@/features/project/lib/recalculatePaceQuantitiesAfterActualHarvest";
import {
  estimatePaceHarvestDateSpan,
  generatePlannedHarvestsForNewProject,
  isProjectPaceForHarvestPlan,
  persistPlannedHarvestSeedsForProject,
  projectPaceConfigFromRow,
  todayLocalYmd,
  type PlannedHarvestSeed,
  type ProjectPaceConfig,
} from "@/features/project/lib/generatePlannedHarvestsForNewProject";
import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import {
  buildStsProxyGetUrl,
  getInternalStsProxyUrl,
  stsProxyGetFullJson,
} from "@/shared/api/stsProxyClient";
import {
  defaultHarvestTypeForUom,
  normalizeHarvestTypeStorageKey,
} from "@/shared/lib/harvestType";

export type PrivilegedPaceRecalcHarvestCounts = {
  total: number;
  actual: number;
  estimate: number;
};

export type PrivilegedPaceRecalcPreviewRow = {
  key: string;
  rowId?: string;
  productId: string;
  uom: string;
  loadType: string;
  estimatedDate: string;
  beforeQuantity: string;
  afterQuantity: string;
  beforeHarvestedArea: string;
  afterHarvestedArea: string;
  action: "delete" | "soft_delete" | "update" | "create" | "unchanged";
  deleteReason?: "fulfilled" | "past_estimate" | "over_delivered" | "actual_unchanged";
};

export type PrivilegedPaceRecalcDataSource = {
  apiActiveRows: number;
  softDeletedInDb: number;
  dbTotalRows: number;
};

export type PrivilegedPaceRecalcPreview = {
  projectId: string;
  projectName: string;
  harvestCounts: PrivilegedPaceRecalcHarvestCounts;
  dataSource?: PrivilegedPaceRecalcDataSource;
  paceGrassBatchQuantitiesBefore: unknown;
  paceGrassBatchQuantitiesAfter: unknown;
  rows: PrivilegedPaceRecalcPreviewRow[];
  summary: {
    deleted: number;
    softDeleted: number;
    updated: number;
    created: number;
    unchanged: number;
  };
  skipped: boolean;
  skipReason?: string;
};

export type PrivilegedPaceRecalcApplyResult = {
  projectId: string;
  deleted: number;
  deleteFailed: number;
  created: number;
  createFailed: number;
  recalcOk: number;
  recalcFail: number;
  error?: string;
};

export type PrivilegedPaceRecalcProjectContext = {
  projectRow: MondayProjectServerRow;
  projectId: string;
  grassRequirements: GrassRequirementForPaceRecalc[];
  harvestPlanRows: HarvestPlanRowForPaceRecalc[];
  projectPaceCatalogRows: ProjectPaceRow[];
  zoneConfigurations: ZoneConfigurationRow[];
  canRegeneratePaceHarvestsOnEdit: boolean;
  userId?: number;
};

function parseQuantity(raw: unknown): number {
  const n = Number(String(raw ?? "").replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function formatQtyStr(qty: number): string {
  if (!Number.isFinite(qty) || qty < 0) return "0";
  const fixed = qty.toFixed(3);
  return fixed.replace(/\.?0+$/, "") || "0";
}

function qtyDisplay(raw: unknown): string {
  return String(raw ?? "").trim() || "0";
}

function estimateDateYmd(row: HarvestPlanRowForPaceRecalc): string {
  const t = String(row.estimated_harvest_date ?? "").trim();
  if (!t || t.startsWith("0000")) return "";
  return t.slice(0, 10);
}

function actualDateYmd(row: HarvestPlanRowForPaceRecalc): string {
  const t = String(row.actual_harvest_date ?? "").trim();
  if (!t || t.startsWith("0000")) return "";
  return t.slice(0, 10);
}

function displayDateForHarvestRow(row: HarvestPlanRowForPaceRecalc): string {
  return estimateDateYmd(row) || actualDateYmd(row);
}

function appendUnchangedSourceHarvestRows(
  previewRows: PrivilegedPaceRecalcPreviewRow[],
  harvestPlanRows: HarvestPlanRowForPaceRecalc[],
): void {
  const coveredIds = new Set(
    previewRows.map((r) => r.rowId).filter((id): id is string => Boolean(id)),
  );

  for (const row of harvestPlanRows) {
    const rowId = String(row.id ?? "").trim();
    if (rowId && coveredIds.has(rowId)) continue;

    const isActual = paceRecalcPlanRowCountsAsHarvested(row);
    const isEstimate = paceRecalcPlanRowCountsAsRemainingEstimate(row);
    if (!isActual && !isEstimate) continue;

    previewRows.push({
      key: rowId || `src_${previewRows.length}`,
      rowId: rowId || undefined,
      productId: String(row.product_id ?? "").trim(),
      uom: String(row.uom ?? "").trim(),
      loadType: rowLoadType(row),
      estimatedDate: displayDateForHarvestRow(row),
      beforeQuantity: qtyDisplay(row.quantity),
      afterQuantity: qtyDisplay(row.quantity),
      beforeHarvestedArea: qtyDisplay(row.harvested_area),
      afterHarvestedArea: qtyDisplay(row.harvested_area),
      action: "unchanged",
      ...(isActual ? { deleteReason: "actual_unchanged" as const } : {}),
    });
  }
}

/** Admin debug: DB row counts vs API active rows (`deleted = 0`). */
export async function fetchHarvestVisibilityDebug(
  projectId: string,
): Promise<PrivilegedPaceRecalcDataSource | null> {
  const pid = projectId.trim();
  if (!pid || typeof window === "undefined") return null;
  try {
    const json = await stsProxyGetFullJson(
      buildStsProxyGetUrl("/api/harvesting", {
        project_id: pid,
        debug_harvest_visibility: 1,
      }),
    );
    const stats = (
      json.debug_harvest_visibility as { counts?: Record<string, number> } | undefined
    )?.counts;
    if (!stats) return null;
    return {
      apiActiveRows: Number(stats.not_deleted ?? stats.api_get_total_by_params ?? 0),
      softDeletedInDb: Number(stats.deleted_rows ?? 0),
      dbTotalRows: Number(stats.table_all_rows_for_project_id ?? 0),
    };
  } catch {
    return null;
  }
}

function rowLoadType(row: HarvestPlanRowForPaceRecalc): string {
  return (
    normalizeHarvestTypeStorageKey(row.load_type) ||
    defaultHarvestTypeForUom(String(row.uom ?? ""))
  );
}

export function parseGrassRequirementsFromProjectRow(
  row: MondayProjectServerRow,
): GrassRequirementForPaceRecalc[] {
  const rec = row as Record<string, unknown>;
  const raw = rec.quantity_required_sprig_sod;
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string" && raw.trim().startsWith("[")
      ? (JSON.parse(raw) as unknown[])
      : [];

  return list
    .filter((x) => x && typeof x === "object")
    .map((x) => x as Record<string, unknown>)
    .map((x) => {
      const fromLoadType = normalizeHarvestTypeStorageKey(x.load_type);
      const loadType =
        fromLoadType || defaultHarvestTypeForUom(String(x.uom ?? "Kg"));
      const uom = loadType === "sod" ? ("M2" as const) : ("Kg" as const);
      return {
        productId: String(x.product_id ?? "").trim(),
        uom,
        loadType,
        totalRequired: parseQuantity(x.quantity),
        farmId: String(x.farm_id ?? "").trim() || undefined,
      };
    })
    .filter((r) => r.productId && r.totalRequired > 0);
}

export function countHarvestBatchesForProject(
  harvestPlanRows: HarvestPlanRowForPaceRecalc[],
): PrivilegedPaceRecalcHarvestCounts {
  let actual = 0;
  let estimate = 0;
  for (const row of harvestPlanRows) {
    if (paceRecalcPlanRowCountsAsHarvested(row)) actual += 1;
    else if (paceRecalcPlanRowCountsAsRemainingEstimate(row)) estimate += 1;
  }
  return { total: actual + estimate, actual, estimate };
}

function projectPaceKeyFromRow(row: MondayProjectServerRow): string {
  const rec = row as Record<string, unknown>;
  const paceRaw = String(rec.project_pace ?? "").trim().toLowerCase();
  return paceRaw === "none" ? "" : paceRaw;
}

function paceAnchorYmdFromRow(row: MondayProjectServerRow): string {
  const rec = row as Record<string, unknown>;
  const estimate = String(rec.estimate_start_date ?? "").trim();
  const actual = String(rec.start_date ?? "").trim();
  return estimate || actual;
}

function resolvePaceContext(
  row: MondayProjectServerRow,
  projectPaceCatalogRows: ProjectPaceRow[],
  canRegeneratePaceHarvestsOnEdit: boolean,
): {
  paceConfig?: ProjectPaceConfig;
  estimatedStartYmd?: string;
  selectedPace?: ProjectPaceRow;
  canSeedOnPrivilegedRecalc: boolean;
} {
  const paceKey = projectPaceKeyFromRow(row);
  const selectedPace = projectPaceCatalogRows.find(
    (p) => String(p.pace_key ?? "").trim().toLowerCase() === paceKey,
  );
  const anchorYmd = paceAnchorYmdFromRow(row);
  const canSeedOnPrivilegedRecalc =
    canRegeneratePaceHarvestsOnEdit &&
    isProjectPaceForHarvestPlan(paceKey, projectPaceCatalogRows) &&
    Boolean(selectedPace) &&
    Boolean(anchorYmd);

  if (!canSeedOnPrivilegedRecalc || !selectedPace || !anchorYmd) {
    return { canSeedOnPrivilegedRecalc: false };
  }

  return {
    paceConfig: projectPaceConfigFromRow(selectedPace),
    estimatedStartYmd: anchorYmd,
    selectedPace,
    canSeedOnPrivilegedRecalc: true,
  };
}

function dedupeRowsById(
  rows: HarvestPlanRowForPaceRecalc[],
): HarvestPlanRowForPaceRecalc[] {
  const seen = new Set<string>();
  const out: HarvestPlanRowForPaceRecalc[] = [];
  for (const row of rows) {
    const id = String(row.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

function removeRowsById(
  rows: HarvestPlanRowForPaceRecalc[],
  toRemove: HarvestPlanRowForPaceRecalc[],
): HarvestPlanRowForPaceRecalc[] {
  const removeIds = new Set(
    toRemove.map((r) => String(r.id ?? "").trim()).filter(Boolean),
  );
  return rows.filter((r) => !removeIds.has(String(r.id ?? "").trim()));
}

function seedsToVirtualRows(
  seeds: PlannedHarvestSeed[],
  startIndex: number,
): HarvestPlanRowForPaceRecalc[] {
  return seeds.map((seed, i) => ({
    id: `__new_${startIndex + i}`,
    product_id: seed.productId,
    uom: seed.uom,
    load_type: seed.harvestType,
    estimated_harvest_date: seed.estimatedHarvestDate,
    quantity: seed.quantity,
    harvested_area: seed.harvestedArea ?? "",
    farm_id: seed.farmId ?? "",
  }));
}

function remainingEstimateRowsForGrassLine(
  harvestPlanRows: HarvestPlanRowForPaceRecalc[],
  req: GrassRequirementForPaceRecalc,
  allGrassRequirements: GrassRequirementForPaceRecalc[],
): HarvestPlanRowForPaceRecalc[] {
  const kgContext = paceRecalcKgLoadTypeContextForProduct(
    allGrassRequirements.map((r) => ({
      product_id: r.productId,
      uom: r.uom,
      load_type: r.loadType,
    })),
    req.productId,
  );
  return harvestPlanRows
    .filter(
      (row) =>
        paceRecalcPlanRowMatchesRequirementLine(
          row,
          req.productId,
          req.uom,
          req.loadType,
          kgContext,
        ) && paceRecalcPlanRowCountsAsRemainingEstimate(row),
    )
    .sort((a, b) => estimateDateYmd(a).localeCompare(estimateDateYmd(b)));
}

function buildPreviewRowsForContext(
  ctx: PrivilegedPaceRecalcProjectContext,
): PrivilegedPaceRecalcPreview {
  const rec = ctx.projectRow as Record<string, unknown>;
  const projectName = String(rec.project_name ?? rec.alias_title ?? ctx.projectId).trim();
  const harvestCounts = countHarvestBatchesForProject(ctx.harvestPlanRows);
  const paceCtx = resolvePaceContext(
    ctx.projectRow,
    ctx.projectPaceCatalogRows,
    ctx.canRegeneratePaceHarvestsOnEdit,
  );

  if (ctx.grassRequirements.length === 0) {
    return {
      projectId: ctx.projectId,
      projectName,
      harvestCounts,
      paceGrassBatchQuantitiesBefore: rec.pace_grass_batch_quantities ?? null,
      paceGrassBatchQuantitiesAfter: rec.pace_grass_batch_quantities ?? null,
      rows: [],
      summary: {
        deleted: 0,
        softDeleted: 0,
        updated: 0,
        created: 0,
        unchanged: 0,
      },
      skipped: true,
      skipReason: "no_grass_requirements",
    };
  }

  const fulfilledRows = collectEstimateHarvestRowsToDeleteForFulfilledGrassRequirements({
    grassRequirements: ctx.grassRequirements,
    harvestPlanRows: ctx.harvestPlanRows,
  });
  const pastRows = collectPastEstimateHarvestRows(ctx.harvestPlanRows);
  const rowsToDelete = dedupeRowsById([...fulfilledRows, ...pastRows]);

  let simulatedPlan = removeRowsById(ctx.harvestPlanRows, rowsToDelete);

  const grassReqsNeedingEstimates = ctx.grassRequirements.filter(
    (req) =>
      !isGrassRequirementFulfilledByActualHarvests(
        simulatedPlan,
        req.productId,
        req.uom,
        req.loadType,
        req.totalRequired,
        ctx.grassRequirements,
      ),
  );

  const partitionedNeedingEstimates = partitionGrassRequirementsByHarvestPlanPresence({
    grassRequirements: grassReqsNeedingEstimates,
    harvestPlanRows: simulatedPlan,
  });

  const newSeeds: PlannedHarvestSeed[] = [];
  let virtualIndex = 0;

  if (paceCtx.canSeedOnPrivilegedRecalc && paceCtx.paceConfig && paceCtx.estimatedStartYmd) {
    const withPlanRowsNeedingSupplemental =
      partitionedNeedingEstimates.withPlanRows.filter((req) =>
        grassRequirementNeedsPrivilegedRecalcSupplementalSeeds({
          paceConfig: paceCtx.paceConfig!,
          estimatedStartYmd: paceCtx.estimatedStartYmd!,
          req,
          harvestPlanRows: simulatedPlan,
          allGrassRequirements: ctx.grassRequirements,
        }),
      );

    if (withPlanRowsNeedingSupplemental.length > 0) {
      newSeeds.push(
        ...buildPrivilegedRecalcSupplementalEstimateSeeds({
          paceConfig: paceCtx.paceConfig,
          estimatedStartYmd: paceCtx.estimatedStartYmd,
          grassRequirements: withPlanRowsNeedingSupplemental,
          harvestPlanRows: simulatedPlan,
          zoneConfigurations: ctx.zoneConfigurations,
        }),
      );
    }

    if (partitionedNeedingEstimates.withoutPlanRows.length > 0) {
      newSeeds.push(
        ...generatePlannedHarvestsForNewProject({
          paceConfig: paceCtx.paceConfig,
          estimatedStartYmd: paceCtx.estimatedStartYmd,
          grassRequirements: grassRequirementsToHarvestPlanFormat(
            partitionedNeedingEstimates.withoutPlanRows,
          ),
          zoneConfigurations: ctx.zoneConfigurations,
        }),
      );
    }
  }

  if (newSeeds.length > 0) {
    simulatedPlan = [
      ...simulatedPlan,
      ...seedsToVirtualRows(newSeeds, virtualIndex),
    ];
    virtualIndex += newSeeds.length;
  }

  const paceGrassBatchQuantitiesAfter =
    buildPaceGrassBatchQuantitiesForPrivilegedRecalc({
      grassRequirements: ctx.grassRequirements,
      harvestPlanRows: simulatedPlan,
      ...(paceCtx.canSeedOnPrivilegedRecalc &&
      paceCtx.paceConfig &&
      paceCtx.estimatedStartYmd
        ? {
            paceConfig: paceCtx.paceConfig,
            estimatedStartYmd: paceCtx.estimatedStartYmd,
          }
        : {}),
    });

  const previewRows: PrivilegedPaceRecalcPreviewRow[] = [];

  for (const row of rowsToDelete) {
    const rowId = String(row.id ?? "").trim();
    const isPast = pastRows.some((p) => String(p.id ?? "").trim() === rowId);
    previewRows.push({
      key: rowId || `del_${previewRows.length}`,
      rowId: rowId || undefined,
      productId: String(row.product_id ?? "").trim(),
      uom: String(row.uom ?? "").trim(),
      loadType: rowLoadType(row),
      estimatedDate: estimateDateYmd(row),
      beforeQuantity: qtyDisplay(row.quantity),
      afterQuantity: qtyDisplay(row.quantity),
      beforeHarvestedArea: qtyDisplay(row.harvested_area),
      afterHarvestedArea: qtyDisplay(row.harvested_area),
      action: "delete",
      deleteReason: isPast ? "past_estimate" : "fulfilled",
    });
  }

  for (const req of grassReqsNeedingEstimates) {
    const summary = summarizePaceRecalcGrassLine(
      simulatedPlan,
      req.productId,
      req.uom,
      req.loadType,
      req.totalRequired,
      ctx.grassRequirements,
      paceCtx.canSeedOnPrivilegedRecalc &&
        paceCtx.paceConfig &&
        paceCtx.estimatedStartYmd
        ? {
            paceConfig: paceCtx.paceConfig,
            estimatedStartYmd: paceCtx.estimatedStartYmd,
          }
        : undefined,
    );

    const estimateRows = remainingEstimateRowsForGrassLine(
      simulatedPlan,
      req,
      ctx.grassRequirements,
    );

    if (summary.remainingEstimateCount <= 0) continue;

    if (summary.remainingQuantity <= 0 && estimateRows.length > 0) {
      for (const row of estimateRows) {
        const rowId = String(row.id ?? "").trim();
        const isNew = rowId.startsWith("__new_");
        previewRows.push({
          key: rowId || `soft_${previewRows.length}`,
          rowId: isNew ? undefined : rowId,
          productId: req.productId,
          uom: req.uom,
          loadType: req.loadType,
          estimatedDate: estimateDateYmd(row),
          beforeQuantity: qtyDisplay(row.quantity),
          afterQuantity: qtyDisplay(row.quantity),
          beforeHarvestedArea: qtyDisplay(row.harvested_area),
          afterHarvestedArea: qtyDisplay(row.harvested_area),
          action: isNew ? "delete" : "soft_delete",
          deleteReason: "over_delivered",
        });
      }
      continue;
    }

    const quantities = distributePaceRecalcQuantities(
      summary.remainingQuantity,
      summary.remainingEstimateCount,
    );
    const rowsForQty = estimateRows.slice(0, summary.remainingEstimateCount);

    for (let i = 0; i < rowsForQty.length; i++) {
      const row = rowsForQty[i]!;
      const rowId = String(row.id ?? "").trim();
      const isNew = rowId.startsWith("__new_");
      const newQty = quantities[i] ?? 0;
      const beforeQty = isNew ? "" : qtyDisplay(row.quantity);
      const afterQty = formatQtyStr(newQty);
      let afterArea = qtyDisplay(row.harvested_area);
      // Business rule (backend): for Sod M2, keep harvested_area == quantity.
      if (req.uom === "M2" && req.loadType === "sod") {
        afterArea = afterQty;
      }
      if (
        req.uom === "Kg" &&
        (req.loadType === "sprig" || req.loadType === "sod_to_sprig") &&
        req.farmId?.trim()
      ) {
        afterArea =
          computeHarvestedAreaM2ForPaceRecalcBatch(
            newQty,
            ctx.zoneConfigurations,
            req.farmId.trim(),
            req.productId,
            estimateDateYmd(row),
          ) ?? afterArea;
      }
      const beforeArea = isNew ? "" : qtyDisplay(row.harvested_area);
      const action =
        isNew
          ? "create"
          : beforeQty === afterQty && beforeArea === afterArea
            ? "unchanged"
            : "update";

      previewRows.push({
        key: rowId || `row_${previewRows.length}`,
        rowId: isNew ? undefined : rowId,
        productId: req.productId,
        uom: req.uom,
        loadType: req.loadType,
        estimatedDate: estimateDateYmd(row),
        beforeQuantity: beforeQty,
        afterQuantity: afterQty,
        beforeHarvestedArea: beforeArea,
        afterHarvestedArea: afterArea,
        action,
      });
    }
  }

  appendUnchangedSourceHarvestRows(previewRows, ctx.harvestPlanRows);

  previewRows.sort((a, b) => {
    const dateCmp = a.estimatedDate.localeCompare(b.estimatedDate);
    if (dateCmp !== 0) return dateCmp;
    return a.productId.localeCompare(b.productId);
  });

  const summary = {
    deleted: previewRows.filter((r) => r.action === "delete").length,
    softDeleted: previewRows.filter((r) => r.action === "soft_delete").length,
    updated: previewRows.filter((r) => r.action === "update").length,
    created: previewRows.filter((r) => r.action === "create").length,
    unchanged: previewRows.filter((r) => r.action === "unchanged").length,
  };

  return {
    projectId: ctx.projectId,
    projectName,
    harvestCounts,
    paceGrassBatchQuantitiesBefore: rec.pace_grass_batch_quantities ?? null,
    paceGrassBatchQuantitiesAfter,
    rows: previewRows,
    summary,
    skipped: false,
  };
}

export function previewPrivilegedPaceRecalcForProject(
  ctx: PrivilegedPaceRecalcProjectContext,
): PrivilegedPaceRecalcPreview {
  return buildPreviewRowsForContext(ctx);
}

/** Mirrors privileged balance recalc on project edit (`projects/new` settings checkbox). */
export async function applyPrivilegedPaceRecalcForProject(
  ctx: PrivilegedPaceRecalcProjectContext,
): Promise<PrivilegedPaceRecalcApplyResult> {
  const projectIdStr = ctx.projectId.trim();
  const rec = ctx.projectRow as Record<string, unknown>;
  const rowId = String(ctx.projectRow.id ?? rec.row_id ?? "").trim();
  const tableId = String(ctx.projectRow.table_id ?? "").trim();
  const paceKey = projectPaceKeyFromRow(ctx.projectRow);
  const selectedPace = ctx.projectPaceCatalogRows.find(
    (p) => String(p.pace_key ?? "").trim().toLowerCase() === paceKey,
  );
  const paceAnchorYmd = paceAnchorYmdFromRow(ctx.projectRow);
  const paceCtx = resolvePaceContext(
    ctx.projectRow,
    ctx.projectPaceCatalogRows,
    ctx.canRegeneratePaceHarvestsOnEdit,
  );

  let deleted = 0;
  let deleteFailed = 0;
  let created = 0;
  let createFailed = 0;
  let recalcOk = 0;
  let recalcFail = 0;

  if (!projectIdStr || ctx.grassRequirements.length === 0) {
    return {
      projectId: projectIdStr,
      deleted,
      deleteFailed,
      created,
      createFailed,
      recalcOk,
      recalcFail,
      error: "missing_project_or_requirements",
    };
  }

  try {
    const paceGrassBatchQuantities = buildPaceGrassBatchQuantitiesForPrivilegedRecalc({
      grassRequirements: ctx.grassRequirements,
      harvestPlanRows: ctx.harvestPlanRows,
      ...(paceCtx.canSeedOnPrivilegedRecalc &&
      paceCtx.paceConfig &&
      paceCtx.estimatedStartYmd
        ? {
            paceConfig: paceCtx.paceConfig,
            estimatedStartYmd: paceCtx.estimatedStartYmd,
          }
        : {}),
    });

    if (rowId && tableId) {
      await updateMondayProjectParentItem({
        id: rowId,
        table_id: tableId,
        data: {
          project_id: projectIdStr,
          pace_grass_batch_quantities: paceGrassBatchQuantities,
        },
      });
    }

    let harvestPlanRowsForRecalcApi = ctx.harvestPlanRows;

    const fulfilledCleanup = await deleteFulfilledGrassEstimateHarvestRows({
      grassRequirements: ctx.grassRequirements,
      harvestPlanRows: harvestPlanRowsForRecalcApi,
      fallbackTableId: tableId,
    });
    const pastEstimateCleanup = await deletePastEstimateHarvestRows({
      harvestPlanRows: harvestPlanRowsForRecalcApi,
      fallbackTableId: tableId,
      referenceYmd: todayLocalYmd(),
    });

    deleted += fulfilledCleanup.deleted + pastEstimateCleanup.deleted;
    deleteFailed += fulfilledCleanup.failed + pastEstimateCleanup.failed;

    if (pastEstimateCleanup.deleted > 0 || fulfilledCleanup.deleted > 0) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      harvestPlanRowsForRecalcApi = await fetchAllHarvestPlanRowsForProject(
        projectIdStr,
        ctx.userId,
      );
    }

    const grassReqsNeedingEstimates = ctx.grassRequirements.filter(
      (req) =>
        !isGrassRequirementFulfilledByActualHarvests(
          harvestPlanRowsForRecalcApi,
          req.productId,
          req.uom,
          req.loadType,
          req.totalRequired,
          ctx.grassRequirements,
        ),
    );

    const partitionedNeedingEstimates =
      partitionGrassRequirementsByHarvestPlanPresence({
        grassRequirements: grassReqsNeedingEstimates,
        harvestPlanRows: harvestPlanRowsForRecalcApi,
      });

    let anySeedsPersisted = false;

    if (
      paceCtx.canSeedOnPrivilegedRecalc &&
      paceCtx.paceConfig &&
      paceCtx.estimatedStartYmd &&
      selectedPace
    ) {
      const paceSpan = estimatePaceHarvestDateSpan({
        paceConfig: paceCtx.paceConfig,
        estimatedStartYmd: paceCtx.estimatedStartYmd,
      });

      const withPlanRowsNeedingSupplemental =
        partitionedNeedingEstimates.withPlanRows.filter((req) =>
          grassRequirementNeedsPrivilegedRecalcSupplementalSeeds({
            paceConfig: paceCtx.paceConfig!,
            estimatedStartYmd: paceCtx.estimatedStartYmd!,
            req,
            harvestPlanRows: harvestPlanRowsForRecalcApi,
            allGrassRequirements: ctx.grassRequirements,
          }),
        );

      if (withPlanRowsNeedingSupplemental.length > 0) {
        const supplementalSeeds = buildPrivilegedRecalcSupplementalEstimateSeeds({
          paceConfig: paceCtx.paceConfig,
          estimatedStartYmd: paceCtx.estimatedStartYmd,
          grassRequirements: withPlanRowsNeedingSupplemental,
          harvestPlanRows: harvestPlanRowsForRecalcApi,
          zoneConfigurations: ctx.zoneConfigurations,
        });
        if (supplementalSeeds.length > 0) {
          const result = await persistPlannedHarvestSeedsForProject({
            projectId: projectIdStr,
            countryId: String(ctx.projectRow.country_id ?? "").trim(),
            customerId: String(rec.odoo_customer_id ?? "").trim(),
            userId: ctx.userId != null ? String(ctx.userId) : undefined,
            seeds: supplementalSeeds,
            paceSnapshotSpan: paceSpan,
          });
          created += result.ok;
          createFailed += result.fail;
          if (result.ok > 0) anySeedsPersisted = true;
        }
      }

      if (partitionedNeedingEstimates.withoutPlanRows.length > 0) {
        const seeds = generatePlannedHarvestsForNewProject({
          paceConfig: paceCtx.paceConfig,
          estimatedStartYmd: paceCtx.estimatedStartYmd,
          grassRequirements: grassRequirementsToHarvestPlanFormat(
            partitionedNeedingEstimates.withoutPlanRows,
          ),
          zoneConfigurations: ctx.zoneConfigurations,
        });
        if (seeds.length > 0) {
          const result = await persistPlannedHarvestSeedsForProject({
            projectId: projectIdStr,
            countryId: String(ctx.projectRow.country_id ?? "").trim(),
            customerId: String(rec.odoo_customer_id ?? "").trim(),
            userId: ctx.userId != null ? String(ctx.userId) : undefined,
            seeds,
            paceSnapshotSpan: paceSpan,
          });
          created += result.ok;
          createFailed += result.fail;
          if (result.ok > 0) anySeedsPersisted = true;
        }
      }
    }

    if (anySeedsPersisted) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      harvestPlanRowsForRecalcApi = await fetchAllHarvestPlanRowsForProject(
        projectIdStr,
        ctx.userId,
      );
    }

    const recalc = await runPaceHarvestRecalcForProjectGrassLines({
      projectId: projectIdStr,
      grassRequirements: grassReqsNeedingEstimates,
      harvestPlanRows: harvestPlanRowsForRecalcApi,
      zoneConfigurations: ctx.zoneConfigurations,
      ...(paceCtx.canSeedOnPrivilegedRecalc &&
      paceCtx.paceConfig &&
      paceCtx.estimatedStartYmd
        ? {
            paceContext: {
              paceConfig: paceCtx.paceConfig,
              estimatedStartYmd: paceCtx.estimatedStartYmd,
            },
          }
        : {}),
    });
    recalcOk = recalc.ok;
    recalcFail = recalc.fail;

    if (deleted > 0 || created > 0 || recalcOk > 0) {
      const url = getInternalStsProxyUrl(STS_API_PATHS.updateHarvestLimitDescriptions);
      void fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        keepalive: true,
        body: JSON.stringify({ project_id: projectIdStr }),
      }).catch(() => {});
    }

    return {
      projectId: projectIdStr,
      deleted,
      deleteFailed,
      created,
      createFailed,
      recalcOk,
      recalcFail,
    };
  } catch (e) {
    return {
      projectId: projectIdStr,
      deleted,
      deleteFailed,
      created,
      createFailed,
      recalcOk,
      recalcFail,
      error: e instanceof Error ? e.message : "apply_failed",
    };
  }
}

export async function fetchAllMondayProjectRows(): Promise<MondayProjectServerRow[]> {
  const { fetchMondayProjectRowsFromServer } = await import("@/entities/projects");
  let page = 1;
  const perPage = 200;
  const maxPages = 50;
  const all: MondayProjectServerRow[] = [];

  for (;;) {
    const res = await fetchMondayProjectRowsFromServer({ page, perPage });
    if (res.rows.length === 0) break;
    all.push(...res.rows);
    if (
      res.totalRecords != null &&
      Number.isFinite(res.totalRecords) &&
      all.length >= res.totalRecords
    ) {
      break;
    }
    if (res.rows.length < perPage) break;
    page += 1;
    if (page > maxPages) break;
  }

  return all;
}
