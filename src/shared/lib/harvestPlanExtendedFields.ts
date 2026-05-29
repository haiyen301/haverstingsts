/** Legacy delimiter when shipping details were appended to `truck_note`. */
export const HARVEST_SHIPPING_NOTE_SPLIT = "\n\n--- Shipping / dispatch ---\n\n";

function toDateInput(v: unknown): string {
  if (typeof v !== "string" || !v.trim()) return "";
  const s = v.trim();
  if (s.startsWith("0000")) return "";
  return s.length >= 10 ? s.slice(0, 10) : s;
}

export function isHarvestLimitDescription(raw: unknown): boolean {
  const value = String(raw ?? "").trim().toLowerCase();
  return value === "limit" || value === "over limit" || value === "overlimit";
}

type ParsedHarvestDescription = {
  generalNote: string;
  estimatedDateEnd: string;
  actualHarvestEndDate: string;
};

function parseDescriptionFromRow(description: string): ParsedHarvestDescription {
  const raw = String(description ?? "").trim();
  if (!raw || isHarvestLimitDescription(raw)) {
    return {
      generalNote: "",
      estimatedDateEnd: "",
      actualHarvestEndDate: "",
    };
  }
  let estimatedDateEnd = "";
  let actualHarvestEndDate = "";
  const body: string[] = [];
  for (const block of raw.split(/\n\n+/)) {
    const mEst = block.match(/^Estimated harvest end:\s*(\d{4}-\d{2}-\d{2})\s*$/i);
    const mAct = block.match(/^Harvest end:\s*(\d{4}-\d{2}-\d{2})\s*$/i);
    if (mEst) {
      estimatedDateEnd = mEst[1];
      continue;
    }
    if (mAct) {
      actualHarvestEndDate = mAct[1];
      continue;
    }
    body.push(block);
  }
  return {
    generalNote: body.join("\n\n").trim(),
    estimatedDateEnd,
    actualHarvestEndDate,
  };
}

function splitTruckNoteFromRow(raw: string): {
  truckNote: string;
  shippingDispatchDetails: string;
} {
  const s = String(raw ?? "");
  const idx = s.indexOf(HARVEST_SHIPPING_NOTE_SPLIT);
  if (idx === -1) {
    return { truckNote: s.trim(), shippingDispatchDetails: "" };
  }
  return {
    truckNote: s.slice(0, idx).trim(),
    shippingDispatchDetails: s.slice(idx + HARVEST_SHIPPING_NOTE_SPLIT.length).trim(),
  };
}

export function getEstimatedDateEndFromRow(row: Record<string, unknown>): string {
  const parsed = parseDescriptionFromRow(String(row.description ?? ""));
  return toDateInput(row.estimated_harvest_end_date) || parsed.estimatedDateEnd;
}

export function getActualHarvestEndDateFromRow(row: Record<string, unknown>): string {
  const parsed = parseDescriptionFromRow(String(row.description ?? ""));
  return toDateInput(row.actual_harvest_end_date) || parsed.actualHarvestEndDate;
}

export function getGeneralNoteFromRow(row: Record<string, unknown>): string {
  const dedicated = String(row.general_note ?? "").trim();
  if (dedicated) return dedicated;
  return parseDescriptionFromRow(String(row.description ?? "")).generalNote;
}

export function getShippingDispatchDetailsFromRow(row: Record<string, unknown>): string {
  const dedicated = String(row.shipping_dispatch_details ?? "").trim();
  if (dedicated) return dedicated;
  return splitTruckNoteFromRow(String(row.truck_note ?? "")).shippingDispatchDetails;
}

export function getTruckNoteFromRow(row: Record<string, unknown>): string {
  const dedicatedShipping = String(row.shipping_dispatch_details ?? "").trim();
  if (dedicatedShipping) {
    return String(row.truck_note ?? "").trim();
  }
  return splitTruckNoteFromRow(String(row.truck_note ?? "")).truckNote;
}
