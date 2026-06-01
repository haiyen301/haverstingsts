import * as XLSX from "xlsx";

type ExcelRow = Record<string, unknown>;

/** Template column order on `Harvests-Import-Template.xlsx` → import field keys. */
const TEMPLATE_HEADER_TO_FIELD = {
  Customer: "customerName",
  Project: "projectName",
  Name: "name",
  "Grass Type": "grass",
  "Turf Type": "turfType",
  "Harvest Type": "harvestType",
  UOM: "uom",
  Quantity: "quantity",
  "Ref Harvest Qty Sprig": "refHrvQtySprig",
  "Reference Harvest UOM": "referenceHarvestUom",
  "Harvested Area": "harvestedArea",
  Zone: "zone",
  Farm: "farm",
  Country: "country",
  "Estimated Harvest Date": "estimatedDate",
  "Estimated Harvest End Date": "estimatedDateEnd",
  "Actual Harvest Date": "actualDate",
  "Actual Harvest End Date": "actualHarvestEndDate",
  "Delivery Harvest Date": "deliveryDate",
  "Shipment Required Date": "shipmentRequiredDate",
  "DO/SO #": "doSoNumber",
  "DO/SO Date": "doSoDate",
  "Truck Note": "truckNote",
  "Shipping Dispatch Details": "shippingDispatchDetails",
  "General Note": "generalNote",
  "License Plate": "licensePlate",
  "Payment ID": "paymentId",
} as const;

type TemplateHeader = keyof typeof TEMPLATE_HEADER_TO_FIELD;
type HarvestImportFieldKey =
  (typeof TEMPLATE_HEADER_TO_FIELD)[TemplateHeader];

export type HarvestImportFieldMapping = Partial<
  Record<HarvestImportFieldKey, string>
>;

const ERROR_MESSAGE_HEADER = "Error Message";
const ERROR_FILE_NAME = "Harvests-Import-Errors.xlsx";

function readTemplateHeaderRow(ws: XLSX.WorkSheet): string[] {
  const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "" });
  const raw = (aoa[0] ?? []) as string[];
  let last = raw.length - 1;
  while (last >= 0 && !String(raw[last] ?? "").trim()) last -= 1;
  return raw.slice(0, last + 1).map((h) => String(h ?? "").trim());
}

function formatCellValue(v: unknown): string | number {
  if (v == null) return "";
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return String(v).trim();
}

function setCell(
  ws: XLSX.WorkSheet,
  row: number,
  col: number,
  value: unknown,
): void {
  const formatted = formatCellValue(value);
  if (formatted === "") return;
  if (typeof formatted === "number") {
    ws[XLSX.utils.encode_cell({ r: row, c: col })] = { v: formatted, t: "n" };
    return;
  }
  ws[XLSX.utils.encode_cell({ r: row, c: col })] = { v: formatted, t: "s" };
}

function clearDataRows(ws: XLSX.WorkSheet, maxCol: number): void {
  const ref = ws["!ref"];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  for (let r = 1; r <= range.e.r; r += 1) {
    for (let c = 0; c <= maxCol; c += 1) {
      delete ws[XLSX.utils.encode_cell({ r, c })];
    }
  }
}

function valueFromImportedRow(
  source: ExcelRow,
  mapping: HarvestImportFieldMapping,
  fieldKey: HarvestImportFieldKey,
): unknown {
  const excelCol = mapping[fieldKey]?.trim();
  if (!excelCol) return "";
  return source[excelCol];
}

/**
 * Builds an error workbook from the official import template layout, filled with
 * **original cell values** from the user's uploaded file (only failed rows).
 */
export async function downloadHarvestImportErrors(
  errorLogs: Array<{ rowNumber: number; message: string; source: ExcelRow }>,
  mapping: HarvestImportFieldMapping,
  uploadedFileName?: string,
): Promise<void> {
  if (!errorLogs.length) return;

  const res = await fetch("/api/harvest/import-template", { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Could not load import template (${res.status}).`);
  }

  const buf = await res.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName =
    wb.SheetNames.find((n) => n.trim().toLowerCase() === "data") ?? wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error("Import template has no data sheet.");

  const headers = readTemplateHeaderRow(ws);
  const errorColIdx = headers.length;
  clearDataRows(ws, errorColIdx);

  ws[XLSX.utils.encode_cell({ r: 0, c: errorColIdx })] = {
    v: ERROR_MESSAGE_HEADER,
    t: "s",
  };

  errorLogs.forEach((log, i) => {
    const rowIdx = i + 1;
    headers.forEach((header, col) => {
      const fieldKey =
        TEMPLATE_HEADER_TO_FIELD[header as TemplateHeader];
      if (!fieldKey) return;
      setCell(
        ws,
        rowIdx,
        col,
        valueFromImportedRow(log.source, mapping, fieldKey),
      );
    });
    setCell(ws, rowIdx, errorColIdx, log.message);
  });

  ws["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: Math.max(0, errorLogs.length), c: errorColIdx },
  });

  const base = (uploadedFileName ?? "").replace(/\.(xlsx|xls)$/i, "").trim();
  const outName = base ? `${base}-errors.xlsx` : ERROR_FILE_NAME;
  XLSX.writeFile(wb, outName);
}
