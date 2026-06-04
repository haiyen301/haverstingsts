import { harvestTypeDisplayLabel } from "@/shared/lib/harvestType";
import {
  getEstimatedDateEndFromRow,
  getGeneralNoteFromRow,
  getTruckNoteFromRow,
} from "@/shared/lib/harvestPlanExtendedFields";
import type { HarvestScheduleCalendarEntry } from "./harvestScheduleTypes";
import type { HarvestScheduleStatus } from "./harvestScheduleTypes";

export type HarvestScheduleMonthEntry = {
  id: string;
  projectId: string;
  date: string;
  project: string;
  farm: string;
  zone: string;
  grassProductId: string;
  grassType: string;
  harvestType: string;
  crew: string;
  startTime: string;
  estimatedAreaM2: number;
  quantity: number;
  quantityUom: string;
  status: HarvestScheduleStatus;
  actualDate: string;
  estimatedDateStart: string;
  estimatedDateEnd: string;
  deliveryDate: string;
  truckNote: string;
  generalNote: string;
};

export function isValidHarvestScheduleDateString(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s || s === "0000-00-00") return false;
  return true;
}

function deriveScheduleStatus(raw: Record<string, unknown>): HarvestScheduleStatus {
  if (isValidHarvestScheduleDateString(raw.delivery_harvest_date)) return "delivered";
  if (isValidHarvestScheduleDateString(raw.actual_harvest_date)) return "harvested";
  if (isValidHarvestScheduleDateString(raw.estimated_harvest_date)) return "scheduled";
  return "planned";
}

function pickScheduleDate(raw: Record<string, unknown>): string {
  if (isValidHarvestScheduleDateString(raw.actual_harvest_date)) {
    return String(raw.actual_harvest_date).trim().slice(0, 10);
  }
  if (isValidHarvestScheduleDateString(raw.estimated_harvest_date)) {
    return String(raw.estimated_harvest_date).trim().slice(0, 10);
  }
  if (isValidHarvestScheduleDateString(raw.delivery_harvest_date)) {
    return String(raw.delivery_harvest_date).trim().slice(0, 10);
  }
  return "";
}

function pickScheduleTime(raw: Record<string, unknown>): string {
  const candidates = [
    raw.actual_harvest_date,
    raw.estimated_harvest_date,
    raw.delivery_harvest_date,
  ];
  for (const candidate of candidates) {
    const text = String(candidate ?? "").trim();
    const match = text.match(/(\d{2}):(\d{2})/);
    if (match) return `${match[1]}:${match[2]}`;
  }
  return "";
}

export function normalizeHarvestScheduleMonthEntry(
  raw: unknown,
): HarvestScheduleMonthEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = r.id;
  if (id === undefined || id === null) return null;

  const quantityRaw = Number(r.quantity);
  const quantity = Number.isFinite(quantityRaw) ? quantityRaw : 0;
  const estimatedAreaRaw = Number(r.harvested_area);
  const estimatedAreaM2 = Number.isFinite(estimatedAreaRaw) ? estimatedAreaRaw : 0;
  const quantityUom = String(r.uom ?? "").trim().toUpperCase() || "QTY";

  return {
    id: String(id),
    projectId: String(r.project_id ?? "").trim(),
    date: pickScheduleDate(r),
    project: String(r.project_name ?? "").trim(),
    farm: String(r.farm_name ?? "").trim(),
    zone: String(r.zone ?? "").trim(),
    grassProductId: String(r.product_id ?? "").trim(),
    grassType: String(r.grass_name ?? "").trim(),
    harvestType: harvestTypeDisplayLabel(r.harvest_type ?? r.load_type ?? "").trim(),
    crew: String(r.assigned_to ?? "").trim(),
    startTime: pickScheduleTime(r),
    estimatedAreaM2,
    quantity,
    quantityUom,
    status: deriveScheduleStatus(r),
    actualDate: isValidHarvestScheduleDateString(r.actual_harvest_date)
      ? String(r.actual_harvest_date).trim().slice(0, 10)
      : "",
    estimatedDateStart: isValidHarvestScheduleDateString(r.estimated_harvest_date)
      ? String(r.estimated_harvest_date).trim().slice(0, 10)
      : "",
    estimatedDateEnd: getEstimatedDateEndFromRow(r),
    deliveryDate: isValidHarvestScheduleDateString(r.delivery_harvest_date)
      ? String(r.delivery_harvest_date).trim().slice(0, 10)
      : "",
    truckNote: getTruckNoteFromRow(r),
    generalNote: getGeneralNoteFromRow(r),
  };
}

export function harvestScheduleMonthEntryToCalendar(
  entry: HarvestScheduleMonthEntry,
): HarvestScheduleCalendarEntry {
  return {
    id: entry.id,
    date: entry.date,
    actualDate: entry.actualDate,
    estimatedDateStart: entry.estimatedDateStart,
    estimatedDateEnd: entry.estimatedDateEnd,
    project: entry.project,
    farm: entry.farm,
    zone: entry.zone,
    grassType: entry.grassType,
    harvestType: entry.harvestType,
    quantity: entry.quantity,
    quantityUom: entry.quantityUom,
    status: entry.status,
    estimatedAreaM2: entry.estimatedAreaM2,
    deliveryDate: entry.deliveryDate,
    truckNote: entry.truckNote,
    generalNote: entry.generalNote,
  };
}
