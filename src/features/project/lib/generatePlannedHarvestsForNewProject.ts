import { submitFlutterHarvest } from "@/features/harvesting/api/flutterHarvestSubmit";

/**
 * Planned harvest schedule when creating a project — mirrors the Harvesting Portal demo
 * (`generatePlannedHarvests` in `projectForecast.ts`): pace drives months, weekly delivery cadence,
 * split quantities across dates. Harvest kind follows grass UoM: Kg → sprig, M² → sod.
 */

export type ProjectPaceForHarvestPlan = "slow" | "medium" | "fast";

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

const PACE_MONTHS: Record<ProjectPaceForHarvestPlan, number> = {
  slow: 9,
  medium: 6,
  fast: 4,
};

const DELIVERIES_PER_WEEK = 2;
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

function paceMonths(pace: ProjectPaceForHarvestPlan): number {
  return PACE_MONTHS[pace] ?? 6;
}

/**
 * @param estimatedStartYmd — `YYYY-MM-DD`; anchor for the delivery schedule (demo: estimated start).
 */
export function generatePlannedHarvestsForNewProject(opts: {
  pace: ProjectPaceForHarvestPlan;
  estimatedStartYmd: string;
  grassRequirements: GrassRequirementForHarvestPlan[];
}): PlannedHarvestSeed[] {
  const { pace, estimatedStartYmd, grassRequirements } = opts;
  const startStr = String(estimatedStartYmd ?? "").trim();
  if (!startStr || !grassRequirements.length) return [];

  const start = new Date(startStr);
  if (Number.isNaN(start.getTime())) return [];

  const months = paceMonths(pace);
  const totalWeeks = Math.round(months * 4.345);
  if (totalWeeks <= 0) return [];

  const reqs = normaliseRequirements(grassRequirements);
  if (!reqs.length) return [];

  const sprigReqs = reqs.filter((r) => r.kind === "SPRIG");
  const sodReqs = reqs.filter((r) => r.kind === "SOD");
  const hasSprig = sprigReqs.length > 0;
  const hasSod = sodReqs.length > 0;

  let sprigDelPerWeek = 0;
  let sodDelPerWeek = 0;
  if (hasSprig && hasSod) {
    sprigDelPerWeek = DELIVERIES_PER_WEEK * SPRIG_SHARE_WHEN_MIXED;
    sodDelPerWeek = DELIVERIES_PER_WEEK * (1 - SPRIG_SHARE_WHEN_MIXED);
  } else if (hasSprig) {
    sprigDelPerWeek = DELIVERIES_PER_WEEK;
  } else if (hasSod) {
    sodDelPerWeek = DELIVERIES_PER_WEEK;
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
  const dayOffsets = [0, 3];

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
    while (sprigAcc >= 1 && weekDeliveries.length < DELIVERIES_PER_WEEK) {
      weekDeliveries.push("SPRIG");
      sprigAcc -= 1;
    }
    while (sodAcc >= 1 && weekDeliveries.length < DELIVERIES_PER_WEEK) {
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
): raw is ProjectPaceForHarvestPlan {
  return raw === "slow" || raw === "medium" || raw === "fast";
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
