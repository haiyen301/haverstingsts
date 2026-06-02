import { submitFlutterHarvest } from "@/features/harvesting/api/flutterHarvestSubmit";
import type { ProjectPaceRow } from "@/features/admin/api/adminApi";

/**
 * Planned harvest schedule when creating a project — pace config drives months,
 * weekly delivery cadence, split quantities across dates. Harvest kind follows
 * grass UoM: Kg → sprig, M² → sod.
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
};

export type PlannedHarvestSeed = {
  productId: string;
  quantity: string;
  uom: "Kg" | "M2";
  harvestType: "sprig" | "sod";
  estimatedHarvestDate: string;
  farmId?: string;
};

type HarvestKind = "SPRIG" | "SOD";

const KG_PER_M2: Record<HarvestKind, number> = {
  SOD: 1.0,
  SPRIG: 1.3,
};

const DEFAULT_PACE_CONFIG: ProjectPaceConfig = {
  durationMonths: 6,
  harvestBatches: 2,
  harvestEveryWeeks: 1,
};

/** Business calendar: 1 month = 4 weeks (used for pace totals and planned-harvest span). */
export const WEEKS_PER_MONTH = 4;

const SPRIG_SHARE_WHEN_MIXED = 0.75;

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

function harvestKindFromGrassUom(uom: string): HarvestKind {
  const u = normUomKey(uom);
  if (u === "m2" || u === "sqm") return "SOD";
  return "SPRIG";
}

function displayUom(kind: HarvestKind): "Kg" | "M2" {
  return kind === "SPRIG" ? "Kg" : "M2";
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


/** Weeks spanned by a pace duration — same rule as planned-harvest generation. */
export function estimatePaceDurationWeeks(config: ProjectPaceConfig): number {
  const months = Math.max(1, config.durationMonths);
  return Math.max(1, months * WEEKS_PER_MONTH);
}

function deliveriesPerWeek(config: ProjectPaceConfig): number {
  const weeks = Math.max(1, config.harvestEveryWeeks);
  return config.harvestBatches / weeks;
}

function maxDeliveriesPerWeek(config: ProjectPaceConfig): number {
  return Math.max(1, Math.ceil(deliveriesPerWeek(config)));
}

function dayOffsetsForPace(config: ProjectPaceConfig): number[] {
  const spanDays = 7 * Math.max(1, config.harvestEveryWeeks);
  const batchCount = Math.max(1, config.harvestBatches);
  if (batchCount === 1) return [0];
  return Array.from({ length: batchCount }, (_, i) =>
    Math.min(spanDays - 1, Math.round((i * spanDays) / batchCount)),
  );
}

type NormalisedReq = {
  productId: string;
  kind: HarvestKind;
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
      const kind = harvestKindFromGrassUom(r.uom);
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
        totalKg,
        totalAreaM2,
        farmId: String(r.farmId ?? "").trim(),
      };
    });
}

/**
 * @param estimatedStartYmd — `YYYY-MM-DD`; anchor for the delivery schedule (demo: estimated start).
 */
export function generatePlannedHarvestsForNewProject(opts: {
  paceConfig: ProjectPaceConfig;
  estimatedStartYmd: string;
  grassRequirements: GrassRequirementForHarvestPlan[];
}): PlannedHarvestSeed[] {
  const { paceConfig, estimatedStartYmd, grassRequirements } = opts;
  const startStr = String(estimatedStartYmd ?? "").trim();
  if (!startStr || !grassRequirements.length) return [];

  const start = new Date(startStr);
  if (Number.isNaN(start.getTime())) return [];

  const months = Math.max(1, paceConfig.durationMonths);
  const totalWeeks = months * WEEKS_PER_MONTH;
  if (totalWeeks <= 0) return [];

  const deliveriesPerWeekRate = deliveriesPerWeek(paceConfig);
  const maxDeliveriesPerWeekLimit = maxDeliveriesPerWeek(paceConfig);
  const dayOffsets = dayOffsetsForPace(paceConfig);

  const reqs = normaliseRequirements(grassRequirements);
  if (!reqs.length) return [];

  const sprigReqs = reqs.filter((r) => r.kind === "SPRIG");
  const sodReqs = reqs.filter((r) => r.kind === "SOD");
  const hasSprig = sprigReqs.length > 0;
  const hasSod = sodReqs.length > 0;

  let sprigDelPerWeek = 0;
  let sodDelPerWeek = 0;
  if (hasSprig && hasSod) {
    sprigDelPerWeek = deliveriesPerWeekRate * SPRIG_SHARE_WHEN_MIXED;
    sodDelPerWeek = deliveriesPerWeekRate * (1 - SPRIG_SHARE_WHEN_MIXED);
  } else if (hasSprig) {
    sprigDelPerWeek = deliveriesPerWeekRate;
  } else if (hasSod) {
    sodDelPerWeek = deliveriesPerWeekRate;
  }

  const totalSprigDeliveries = Math.max(1, Math.round(sprigDelPerWeek * totalWeeks));
  const totalSodDeliveries = Math.max(
    hasSod ? 1 : 0,
    Math.round(sodDelPerWeek * totalWeeks),
  );

  function splitForType(
    typeReqs: NormalisedReq[],
    totalDeliveries: number,
  ): Array<{
    req: NormalisedReq;
    perDeliveryKg: number;
    perDeliveryAreaM2: number;
    deliveries: number;
  }> {
    if (!typeReqs.length || totalDeliveries <= 0) return [];
    const totalKg = typeReqs.reduce((s, r) => s + r.totalKg, 0);
    return typeReqs.map((r) => {
      const share = totalKg > 0 ? r.totalKg / totalKg : 1 / typeReqs.length;
      const deliveries = Math.max(1, Math.round(share * totalDeliveries));
      return {
        req: r,
        deliveries,
        perDeliveryKg: r.totalKg / deliveries,
        perDeliveryAreaM2: r.totalAreaM2 / deliveries,
      };
    });
  }

  const sprigSplit = splitForType(sprigReqs, totalSprigDeliveries);
  const sodSplit = splitForType(sodReqs, totalSodDeliveries);

  const harvests: PlannedHarvestSeed[] = [];

  const sprigQueue: Array<{
    req: NormalisedReq;
    perKg: number;
    perArea: number;
    remaining: number;
  }> = sprigSplit.map((s) => ({
    req: s.req,
    perKg: s.perDeliveryKg,
    perArea: s.perDeliveryAreaM2,
    remaining: s.deliveries,
  }));
  const sodQueue: Array<{
    req: NormalisedReq;
    perKg: number;
    perArea: number;
    remaining: number;
  }> = sodSplit.map((s) => ({
    req: s.req,
    perKg: s.perDeliveryKg,
    perArea: s.perDeliveryAreaM2,
    remaining: s.deliveries,
  }));

  let sprigAcc = 0;
  let sodAcc = 0;

  const pushHarvest = (
    req: NormalisedReq,
    perKg: number,
    perArea: number,
    date: Date,
  ) => {
    const uom = displayUom(req.kind);
    const qty =
      uom === "Kg"
        ? Math.round(perKg * 10) / 10
        : Math.round(perArea * 10) / 10;
    harvests.push({
      productId: req.productId,
      quantity: String(qty),
      uom,
      harvestType: req.kind === "SPRIG" ? "sprig" : "sod",
      estimatedHarvestDate: isoYmd(date),
      farmId: req.farmId || undefined,
    });
  };

  for (let w = 0; w < totalWeeks; w++) {
    sprigAcc += sprigDelPerWeek;
    sodAcc += sodDelPerWeek;

    const weekDeliveries: HarvestKind[] = [];
    while (sprigAcc >= 1 && weekDeliveries.length < maxDeliveriesPerWeekLimit) {
      weekDeliveries.push("SPRIG");
      sprigAcc -= 1;
    }
    while (sodAcc >= 1 && weekDeliveries.length < maxDeliveriesPerWeekLimit) {
      weekDeliveries.push("SOD");
      sodAcc -= 1;
    }

    weekDeliveries.forEach((kind, idx) => {
      const queue = kind === "SPRIG" ? sprigQueue : sodQueue;
      const next = queue.find((q) => q.remaining > 0) ?? queue[0];
      if (!next) return;
      next.remaining = Math.max(0, next.remaining - 1);
      const date = addDays(start, w * 7 + dayOffsets[idx % dayOffsets.length]);
      pushHarvest(next.req, next.perKg, next.perArea, date);
    });
  }

  const flushDate = addDays(start, totalWeeks * 7);
  [...sprigQueue, ...sodQueue].forEach((q) => {
    while (q.remaining > 0) {
      pushHarvest(q.req, q.perKg, q.perArea, flushDate);
      q.remaining -= 1;
    }
  });

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
  return key === "slow" || key === "medium" || key === "fast";
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
