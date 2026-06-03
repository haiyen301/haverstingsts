import { isValidHarvestDateString } from "@/shared/lib/harvestPlanDates";
import { harvestTypeDisplayLabel } from "@/shared/lib/harvestType";
import {
  harvestPlanHarvestedAreaFromRaw,
  harvestPlanQuantityFromRaw,
  resolvePlanRowUomFromRaw,
} from "@/features/forecasting/forecastingInventoryConversion";
import { isStsRecordDeleted } from "@/features/forecasting/forecastActiveRecords";

export type HarvestPortalStatus = "planned" | "scheduled" | "harvested" | "delivered";

export type RegrowthPlanDetailRow = {
  id: string;
  project: string;
  estimatedDate: string;
  harvestDate: string;
  farm: string;
  grass: string;
  zone: string;
  type: string;
  areaM2: number;
  qty: number;
  qtyUom: string;
  qtyLabel: string;
  deliveryDate: string;
  status: HarvestPortalStatus;
};

export function regrowthEventKey(farmId: number, productId: number, regrowthYmd: string): string {
  return `${farmId}|${productId}|${regrowthYmd}`;
}

export function deriveHarvestPortalStatus(r: Record<string, unknown>): HarvestPortalStatus {
  if (isValidHarvestDateString(r.delivery_harvest_date)) return "delivered";
  if (isValidHarvestDateString(r.actual_harvest_date)) return "harvested";
  if (isValidHarvestDateString(r.estimated_harvest_date)) return "scheduled";
  return "planned";
}

export function harvestPlanDetailFromRaw(
  raw: Record<string, unknown>,
  zoneLabelFn: (zone: string) => string,
): RegrowthPlanDetailRow | null {
  const id = raw.id;
  if (id === undefined || id === null) return null;
  if (isStsRecordDeleted(raw)) return null;

  const zoneRaw = String(raw.zone ?? "").trim();
  const zone = zoneRaw ? zoneLabelFn(zoneRaw) || zoneRaw : "";
  const qty = harvestPlanQuantityFromRaw(raw);
  const uom = resolvePlanRowUomFromRaw(raw);
  const qtyLabel = uom ? `${qty.toLocaleString()} ${uom}` : qty.toLocaleString();

  return {
    id: String(id),
    project: String(raw.project_name ?? raw.project ?? "").trim(),
    estimatedDate: isValidHarvestDateString(raw.estimated_harvest_date)
      ? String(raw.estimated_harvest_date).trim().slice(0, 10)
      : "",
    harvestDate: isValidHarvestDateString(raw.actual_harvest_date)
      ? String(raw.actual_harvest_date).trim().slice(0, 10)
      : "",
    farm: String(raw.farm_name ?? "").trim(),
    grass: String(raw.grass_name ?? "").trim(),
    zone,
    type: harvestTypeDisplayLabel(String(raw.harvest_type ?? raw.load_type ?? "")),
    areaM2: harvestPlanHarvestedAreaFromRaw(raw),
    qty,
    qtyUom: uom,
    qtyLabel,
    deliveryDate: isValidHarvestDateString(raw.delivery_harvest_date)
      ? String(raw.delivery_harvest_date).trim().slice(0, 10)
      : "",
    status: deriveHarvestPortalStatus(raw),
  };
}

/** One row per `project_harvesting_plan` id (sts_project_harvesting_plan). */
export function buildRegrowthPlanDetailRows(
  planIds: readonly string[],
  harvestRowsRaw: readonly Record<string, unknown>[] | null | undefined,
  zoneLabelFn: (zone: string) => string,
): RegrowthPlanDetailRow[] {
  if (!planIds.length || !harvestRowsRaw?.length) return [];

  const idSet = new Set(planIds.map((id) => String(id).trim()).filter(Boolean));
  const byId = new Map<string, RegrowthPlanDetailRow>();

  for (const raw of harvestRowsRaw) {
    const planId = String(raw.id ?? "").trim();
    if (!planId || !idSet.has(planId)) continue;
    const row = harvestPlanDetailFromRaw(raw, zoneLabelFn);
    if (!row) continue;
    byId.set(planId, row);
  }

  return [...byId.values()].sort((a, b) => {
    const da = a.harvestDate || a.estimatedDate || "";
    const db = b.harvestDate || b.estimatedDate || "";
    if (da !== db) return da.localeCompare(db);
    return a.id.localeCompare(b.id);
  });
}

export type RegrowthPlanDetailTotals = {
  areaM2: number;
  qtyByUom: Map<string, number>;
};

export function sumRegrowthPlanDetailTotals(rows: RegrowthPlanDetailRow[]): RegrowthPlanDetailTotals {
  let areaM2 = 0;
  const qtyByUom = new Map<string, number>();
  for (const row of rows) {
    if (row.areaM2 > 0) areaM2 += row.areaM2;
    const uom = row.qtyUom.trim() || "—";
    qtyByUom.set(uom, (qtyByUom.get(uom) ?? 0) + row.qty);
  }
  return { areaM2, qtyByUom };
}
