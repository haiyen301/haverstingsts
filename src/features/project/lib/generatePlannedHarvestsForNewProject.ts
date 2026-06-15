import type { ProjectPaceRow, ZoneConfigurationRow } from "@/features/admin/api/adminApi";
import { submitFlutterHarvest } from "@/features/harvesting/api/flutterHarvestSubmit";
import { isForecastExcludedZone } from "@/features/forecasting/forecastingInventoryConversion";
import {
  zoneConfigCoversYmd,
  zoneConfigHasPeriod,
  zoneConfigIsActiveAtYmd,
  zoneConfigYmdSlice,
} from "@/features/forecasting/inventoryRegrowthCalculator";
import {
  defaultHarvestTypeForUom,
  normalizeHarvestTypeStorageKey,
  type HarvestTypeStorageKey,
} from "@/shared/lib/harvestType";

/**
 * Planned harvest schedule when creating a project — pace config drives months,
 * harvest cadence (batches per week), and per-batch quantity (total ÷ batch count,
 * floor to 3 dp; remainder on the last batch so the sum never exceeds total required).
 * Harvest kind follows grass `load_type` when set; otherwise UoM (Kg → sprig, M² → sod).
 *
 * After actual harvest dates are saved on edit, quantities are rebalanced via
 * `recalculatePaceQuantitiesAfterActualHarvest.ts` — see `doc/project-page-and-harvest-update.md`.
 */

export type ProjectPaceForHarvestPlan = string;

export type ProjectPaceConfig = {
  durationMonths: number;
  harvestBatches: number;
  harvestEveryWeeks: number;
};

export type GrassRequirementForHarvestPlan = {
  /** `sts_items` / product id */
  productId: string;
  /** Project form: "Kg" | "M2" */
  uom: string;
  amountRequired: number;
  /** Optional farm from project grass requirements (`quantity_required_sprig_sod.farm_id`). */
  farmId?: string;
  /** Sprig / sod / sod_to_sprig from grass requirements (`quantity_required_sprig_sod.load_type`). */
  loadType?: HarvestTypeStorageKey | string;
};

export type PlannedHarvestSeed = {
  productId: string;
  quantity: string;
  uom: "Kg" | "M2";
  harvestType: HarvestTypeStorageKey;
  estimatedHarvestDate: string;
  farmId?: string;
  /** `harvested_area` (m²) — sprig / sod_to_sprig: kg ÷ zone config yield (kg/m²). */
  harvestedArea?: string;
};

/** Stored on `sts_projects.pace_grass_batch_quantities` when project pace is set. */
export type PaceGrassBatchQuantity = {
  grass_id: string;
  quantity: string;
  uom: string;
  farm_id?: string;
};

type HarvestKind = "SPRIG" | "SOD";

const KG_PER_M2: Record<HarvestKind, number> = {
  SOD: 1.0,
  SPRIG: 1.3,
};

const DEFAULT_PACE_CONFIG: ProjectPaceConfig = {
  durationMonths: 6,
  harvestBatches: 1,
  harvestEveryWeeks: 1,
};

/** Business calendar: 1 month = 4 weeks (used for pace totals and planned-harvest span). */
export const WEEKS_PER_MONTH = 4;

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function isoYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function normUomKey(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s/g, "")
    .replace(/²/g, "2");
}

function resolveGrassLoadType(
  req: GrassRequirementForHarvestPlan,
): HarvestTypeStorageKey {
  const fromField = normalizeHarvestTypeStorageKey(req.loadType);
  if (fromField) return fromField;
  return defaultHarvestTypeForUom(req.uom);
}

function harvestKindForRequirement(req: GrassRequirementForHarvestPlan): HarvestKind {
  const loadType = resolveGrassLoadType(req);
  if (loadType === "sod") return "SOD";
  return "SPRIG";
}

function displayUomForLoadType(loadType: HarvestTypeStorageKey): "Kg" | "M2" {
  return loadType === "sod" ? "M2" : "Kg";
}

function positiveInt(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n);
}

export function projectPaceConfigFromRow(row: ProjectPaceRow): ProjectPaceConfig {
  return {
    durationMonths: positiveInt(row.duration_months, DEFAULT_PACE_CONFIG.durationMonths),
    harvestBatches: positiveInt(row.harvest_batches, DEFAULT_PACE_CONFIG.harvestBatches),
    harvestEveryWeeks: positiveInt(
      row.harvest_every_weeks,
      DEFAULT_PACE_CONFIG.harvestEveryWeeks,
    ),
  };
}

export type PaceHarvestDateSpan = {
  firstYmd: string;
  lastYmd: string;
};

/**
 * First / last planned harvest dates for a pace anchored at `estimatedStartYmd`
 * (same slot rules as `generatePlannedHarvestsForNewProject`).
 */
export function estimatePaceHarvestDateSpan(opts: {
  paceConfig: ProjectPaceConfig;
  estimatedStartYmd: string;
}): PaceHarvestDateSpan | null {
  const startStr = String(opts.estimatedStartYmd ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startStr)) return null;

  const start = new Date(startStr);
  if (Number.isNaN(start.getTime())) return null;

  const totalWeeks = estimatePaceDurationWeeks(opts.paceConfig);
  if (totalWeeks <= 0) return null;

  const totalBatches = estimateTotalHarvestBatches(opts.paceConfig);
  const slots = buildBatchSlots(opts.paceConfig, totalWeeks, totalBatches);
  if (slots.length === 0) return null;

  let firstOffset = Number.POSITIVE_INFINITY;
  let lastOffset = Number.NEGATIVE_INFINITY;
  for (const slot of slots) {
    const offset = slot.weekIndex * 7 + slot.dayOffset;
    firstOffset = Math.min(firstOffset, offset);
    lastOffset = Math.max(lastOffset, offset);
  }

  return {
    firstYmd: isoYmd(addDays(start, firstOffset)),
    lastYmd: isoYmd(addDays(start, lastOffset)),
  };
}

/** Weeks spanned by a pace duration — same rule as planned-harvest generation. */
export function estimatePaceDurationWeeks(config: ProjectPaceConfig): number {
  const months = Math.max(1, config.durationMonths);
  return Math.max(1, months * WEEKS_PER_MONTH);
}

/** Full cadence cycles that fit in the project span (Admin: harvest_every_weeks). */
export function estimatePaceHarvestCycles(config: ProjectPaceConfig): number {
  const totalWeeks = estimatePaceDurationWeeks(config);
  const cycleWeeks = Math.max(1, config.harvestEveryWeeks);
  return Math.max(1, Math.floor(totalWeeks / cycleWeeks));
}

/**
 * Total planned harvest rows per grass line — driven by Admin Project Pace:
 * `duration_months` → weeks (×4), then
 * `floor(weeks ÷ harvest_every_weeks) × harvest_batches`
 * (e.g. 4 months = 16 weeks, 2 batches / 1 week → 16 × 2 = 32).
 */
export function estimateTotalHarvestBatches(config: ProjectPaceConfig): number {
  const batchesPerCycle = Math.max(1, config.harvestBatches);
  return Math.max(1, estimatePaceHarvestCycles(config) * batchesPerCycle);
}

function dayOffsetsForPace(config: ProjectPaceConfig): number[] {
  const spanDays = 7 * Math.max(1, config.harvestEveryWeeks);
  const batchCount = Math.max(1, config.harvestBatches);
  if (batchCount === 1) return [0];
  return Array.from({ length: batchCount }, (_, i) =>
    Math.min(spanDays - 1, Math.round((i * spanDays) / batchCount)),
  );
}

type BatchSlot = { weekIndex: number; dayOffset: number };

function buildBatchSlots(
  config: ProjectPaceConfig,
  totalWeeks: number,
  totalBatches: number,
): BatchSlot[] {
  const cycleWeeks = Math.max(1, config.harvestEveryWeeks);
  const batchesPerCycle = Math.max(1, config.harvestBatches);
  const dayOffsets = dayOffsetsForPace(config);
  const slots: BatchSlot[] = [];

  for (
    let cycleStart = 0;
    cycleStart < totalWeeks && slots.length < totalBatches;
    cycleStart += cycleWeeks
  ) {
    const weekIndex = Math.min(cycleStart, Math.max(0, totalWeeks - 1));
    for (let b = 0; b < batchesPerCycle && slots.length < totalBatches; b++) {
      slots.push({
        weekIndex,
        dayOffset: dayOffsets[b % dayOffsets.length] ?? 0,
      });
    }
  }

  const lastWeek = Math.max(0, totalWeeks - 1);
  while (slots.length < totalBatches) {
    slots.push({ weekIndex: lastWeek, dayOffset: dayOffsets[0] ?? 0 });
  }

  return slots.slice(0, totalBatches);
}

type NormalisedReq = {
  productId: string;
  kind: HarvestKind;
  loadType: HarvestTypeStorageKey;
  totalKg: number;
  totalAreaM2: number;
  farmId: string;
};

function normaliseRequirements(
  reqs: GrassRequirementForHarvestPlan[],
): NormalisedReq[] {
  return reqs
    .filter((r) => r.productId.trim() && r.amountRequired > 0)
    .map((r) => {
      const loadType = resolveGrassLoadType(r);
      const kind = harvestKindForRequirement(r);
      const kgPerM2 = KG_PER_M2[kind];
      const u = normUomKey(r.uom);
      const isArea = u === "m2" || u === "sqm";
      const totalKg = isArea ? r.amountRequired * kgPerM2 : r.amountRequired;
      const totalAreaM2 = isArea
        ? r.amountRequired
        : r.amountRequired / kgPerM2;
      return {
        productId: r.productId.trim(),
        kind,
        loadType,
        totalKg,
        totalAreaM2,
        farmId: String(r.farmId ?? "").trim(),
      };
    });
}

function totalQuantityForReq(req: NormalisedReq): number {
  const uom = displayUomForLoadType(req.loadType);
  return uom === "Kg" ? req.totalKg : req.totalAreaM2;
}

function formatBatchQuantity(qty: number): string {
  if (!Number.isFinite(qty) || qty < 0) return "0";
  const fixed = qty.toFixed(3);
  const trimmed = fixed.replace(/\.?0+$/, "");
  return trimmed || "0";
}

/**
 * Base batch size (B) = floor(total ÷ N, 3 dp). Used for `pace_grass_batch_quantities`.
 * Planned rows use {@link distributeBatchQuantities} so the last row absorbs the remainder.
 */
function baseBatchQuantity(totalQuantity: number, totalBatches: number): number {
  const n = Math.max(0, Math.floor(totalBatches));
  if (n <= 0) return 0;
  const totalMilli = Math.round(Math.max(0, totalQuantity) * 1000);
  return Math.floor(totalMilli / n) / 1000;
}

/** Per-batch quantities; length = N, sum = total (3 dp). Last batch gets the remainder. */
function distributeBatchQuantities(
  totalQuantity: number,
  totalBatches: number,
): number[] {
  const n = Math.max(0, Math.floor(totalBatches));
  if (n <= 0) return [];
  const totalMilli = Math.round(Math.max(0, totalQuantity) * 1000);
  const baseMilli = Math.floor(totalMilli / n);
  const lastMilli = totalMilli - baseMilli * (n - 1);
  const out = Array.from({ length: n - 1 }, () => baseMilli / 1000);
  out.push(lastMilli / 1000);
  return out;
}

function parsePositiveNumber(raw: string | number | null | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function isKgSprigLoadType(loadType: HarvestTypeStorageKey): boolean {
  return loadType === "sprig" || loadType === "sod_to_sprig";
}

/**
 * Active zone setup for farm + grass (any zone) on `ymd`.
 * Period rows win over always-on; overlapping periods prefer latest `effective_from`.
 */
export function findZoneConfigForFarmGrass(
  zoneConfigs: ZoneConfigurationRow[],
  farmId: string,
  productId: string,
  ymd: string,
): ZoneConfigurationRow | null {
  const farm = Number.parseInt(String(farmId ?? "").trim(), 10);
  const product = Number.parseInt(String(productId ?? "").trim(), 10);
  if (!Number.isFinite(farm) || !Number.isFinite(product)) return null;

  const activeRows = zoneConfigs.filter((row) => {
    if (!zoneConfigIsActiveAtYmd(row, ymd)) return false;
    if (Number(row.farm_id) !== farm) return false;
    if (Number(row.grass_id) !== product) return false;
    if (isForecastExcludedZone(row.zone)) return false;
    return parsePositiveNumber(row.inventory_kg_per_m2) > 0;
  });
  if (activeRows.length === 0) return null;

  const periodRows = activeRows
    .filter((row) => zoneConfigHasPeriod(row) && zoneConfigCoversYmd(row, ymd))
    .sort((a, b) =>
      zoneConfigYmdSlice(b.effective_from).localeCompare(zoneConfigYmdSlice(a.effective_from)),
    );
  if (periodRows.length > 0) return periodRows[0] ?? null;

  const defaultRows = activeRows.filter((row) => !zoneConfigHasPeriod(row));
  if (defaultRows.length > 0) return defaultRows[0] ?? null;

  return activeRows[0] ?? null;
}

export function harvestAreaM2FromKgAndZoneConfig(
  qtyKg: number,
  zoneConfig: ZoneConfigurationRow | null,
): string | undefined {
  if (qtyKg <= 0 || !zoneConfig) return undefined;
  const yieldKgPerM2 = parsePositiveNumber(zoneConfig.inventory_kg_per_m2);
  if (yieldKgPerM2 <= 0) return undefined;
  const areaM2 = qtyKg / yieldKgPerM2;
  return (Math.round(areaM2 * 100) / 100).toFixed(2);
}

/** Per-grass quantity for one harvest batch (total required ÷ pace total batches). */
export function buildPaceGrassBatchQuantities(opts: {
  paceConfig: ProjectPaceConfig;
  grassRequirements: GrassRequirementForHarvestPlan[];
}): PaceGrassBatchQuantity[] {
  const totalBatches = estimateTotalHarvestBatches(opts.paceConfig);
  const reqs = normaliseRequirements(opts.grassRequirements);
  return reqs.map((req) => {
    const uom = displayUomForLoadType(req.loadType);
    const qty = baseBatchQuantity(totalQuantityForReq(req), totalBatches);
    const row: PaceGrassBatchQuantity = {
      grass_id: req.productId,
      quantity: formatBatchQuantity(qty),
      uom,
    };
    if (req.farmId) {
      row.farm_id = req.farmId;
    }
    return row;
  });
}

/**
 * @param estimatedStartYmd — `YYYY-MM-DD`; anchor for the delivery schedule (demo: estimated start).
 */
export function generatePlannedHarvestsForNewProject(opts: {
  paceConfig: ProjectPaceConfig;
  estimatedStartYmd: string;
  grassRequirements: GrassRequirementForHarvestPlan[];
  zoneConfigurations?: ZoneConfigurationRow[];
}): PlannedHarvestSeed[] {
  const { paceConfig, estimatedStartYmd, grassRequirements, zoneConfigurations = [] } = opts;
  const startStr = String(estimatedStartYmd ?? "").trim();
  if (!startStr || !grassRequirements.length) return [];

  const start = new Date(startStr);
  if (Number.isNaN(start.getTime())) return [];

  const totalWeeks = estimatePaceDurationWeeks(paceConfig);
  if (totalWeeks <= 0) return [];

  const totalBatches = estimateTotalHarvestBatches(paceConfig);
  const slots = buildBatchSlots(paceConfig, totalWeeks, totalBatches);

  const reqs = normaliseRequirements(grassRequirements);
  if (!reqs.length) return [];

  const harvests: PlannedHarvestSeed[] = [];

  for (const req of reqs) {
    const uom = displayUomForLoadType(req.loadType);
    const batchQuantities = distributeBatchQuantities(
      totalQuantityForReq(req),
      totalBatches,
    );
    const needsHarvestAreaFromZone =
      isKgSprigLoadType(req.loadType) && uom === "Kg" && Boolean(req.farmId);
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]!;
      const qty = batchQuantities[i] ?? batchQuantities[batchQuantities.length - 1] ?? 0;
      const date = addDays(start, slot.weekIndex * 7 + slot.dayOffset);
      const estimatedHarvestDate = isoYmd(date);
      let harvestedArea: string | undefined;
      if (needsHarvestAreaFromZone && zoneConfigurations.length > 0) {
        const zoneConfig = findZoneConfigForFarmGrass(
          zoneConfigurations,
          req.farmId,
          req.productId,
          estimatedHarvestDate,
        );
        harvestedArea = harvestAreaM2FromKgAndZoneConfig(qty, zoneConfig);
      }
      harvests.push({
        productId: req.productId,
        quantity: formatBatchQuantity(qty),
        uom,
        harvestType: req.loadType,
        estimatedHarvestDate,
        farmId: req.farmId || undefined,
        ...(harvestedArea ? { harvestedArea } : {}),
      });
    }
  }

  return harvests;
}

export function isProjectPaceForHarvestPlan(
  raw: string,
  catalog?: ProjectPaceRow[],
): boolean {
  const key = String(raw ?? "").trim().toLowerCase();
  if (!key || key === "none") return false;
  if (catalog?.length) {
    return catalog.some(
      (row) => String(row.pace_key ?? "").trim().toLowerCase() === key,
    );
  }
  return false;
}

/**
 * Creates harvesting plan rows via the same API as `harvest/new` (`flutter_add_new_sub_row`).
 * Uses grass-requirement farm when set; otherwise farm stays empty until first harvest entry.
 */
export async function persistPlannedHarvestSeedsForProject(params: {
  projectId: string;
  countryId: string;
  customerId: string;
  userId: string | undefined;
  seeds: PlannedHarvestSeed[];
}): Promise<{ ok: number; fail: number; firstMessage: string | null }> {
  let ok = 0;
  let fail = 0;
  let firstMessage: string | null = null;
  const assignedTo = params.userId != null ? String(params.userId) : "";
  const createdBy =
    params.userId != null ? String(params.userId) : undefined;
  const customerId = params.customerId.trim() || undefined;

  for (const row of params.seeds) {
    try {
      await submitFlutterHarvest(
        {
          projectId: params.projectId,
          productId: row.productId,
          farmId: row.farmId?.trim() || "",
          zone: "",
          quantity: row.quantity,
          uom: row.uom,
          harvestType: row.harvestType,
          estimatedHarvestDate: row.estimatedHarvestDate,
          actualHarvestDate: "",
          deliveryHarvestDate: "",
          doSoNumber: "",
          truckNote: "",
          licensePlate: "",
          country: params.countryId.trim(),
          customerId,
          assignedTo,
          createdBy,
          ...(row.harvestedArea ? { harvestedArea: row.harvestedArea } : {}),
        },
        {},
      );
      ok += 1;
    } catch (e) {
      fail += 1;
      if (!firstMessage) {
        firstMessage = e instanceof Error ? e.message : String(e);
      }
    }
  }

  return { ok, fail, firstMessage };
}
