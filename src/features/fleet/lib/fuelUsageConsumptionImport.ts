import type ExcelJS from "exceljs";

import type {
  FuelUsageImportFuelKind,
  FuelUsageImportRawEntry,
} from "@/features/fleet/lib/fuelUsageImport";

type HeaderMap = {
  date: number | null;
  machine: number | null;
  faCode: number | null;
  fuelType: number | null;
  fuelUsed: number | null;
};

function cellValue(value: ExcelJS.CellValue): string | number | Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    if ("result" in value && value.result != null) {
      return cellValue(value.result as ExcelJS.CellValue);
    }
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text ?? "").join("");
    }
    if ("text" in value && value.text != null) {
      return String(value.text);
    }
  }
  return value as string | number;
}

function cellText(value: ExcelJS.CellValue): string {
  const raw = cellValue(value);
  if (raw == null) return "";
  return String(raw).trim();
}

function parseLitres(value: ExcelJS.CellValue): number | null {
  const raw = cellValue(value);
  if (raw == null || raw === "") return null;
  const litres = Number.parseFloat(String(raw).replace(/,/g, ""));
  if (!Number.isFinite(litres) || litres <= 0) return null;
  return Math.round(litres * 1000) / 1000;
}

function formatYmd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDateCell(value: ExcelJS.CellValue): string {
  const raw = cellValue(value);
  if (raw instanceof Date) {
    const utcY = raw.getUTCFullYear();
    const utcM = raw.getUTCMonth();
    const utcD = raw.getUTCDate();
    const localY = raw.getFullYear();
    const localM = raw.getMonth();
    const localD = raw.getDate();
    if (utcY !== localY || utcM !== localM || utcD !== localD) {
      return formatYmd(localY, localM + 1, localD);
    }
    return formatYmd(utcY, utcM + 1, utcD);
  }
  const text = cellText(value);
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    return text.slice(0, 10);
  }
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (dmy) {
    return formatYmd(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  }
  const dt = new Date(text);
  if (!Number.isNaN(dt.getTime())) {
    return formatYmd(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  }
  return "";
}

function normalizeHeaderLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[–—]/g, "-");
}

function findHeaderRow(ws: ExcelJS.Worksheet): { row: number; map: HeaderMap } | null {
  const maxScan = Math.min(Math.max(ws.rowCount, 1), 30);
  const maxCol = Math.min(Math.max(ws.columnCount, 1), 20);

  for (let row = 1; row <= maxScan; row += 1) {
    const map: HeaderMap = {
      date: null,
      machine: null,
      faCode: null,
      fuelType: null,
      fuelUsed: null,
    };

    for (let col = 1; col <= maxCol; col += 1) {
      const label = normalizeHeaderLabel(cellText(ws.getCell(row, col).value));
      if (!label) continue;

      if (label === "date" || label.startsWith("date/") || label.includes("ngày")) {
        if (map.date == null) map.date = col;
        continue;
      }
      if (
        label.includes("machine/license") ||
        label.includes("tên mmtb") ||
        label.includes("biển xe") ||
        label.includes("biển số") ||
        (label.includes("license plate") && label.includes("machine"))
      ) {
        if (map.machine == null) map.machine = col;
        continue;
      }
      if (label.includes("fa code") || label.includes("mã hiệu") || label.includes("ma hieu")) {
        if (map.faCode == null) map.faCode = col;
        continue;
      }
      if (label === "fuel type" || label.startsWith("fuel type")) {
        if (map.fuelType == null) map.fuelType = col;
        continue;
      }
      if (label.includes("fuel used")) {
        if (map.fuelUsed == null) map.fuelUsed = col;
      }
    }

    if (map.date != null && map.machine != null && map.fuelUsed != null) {
      return { row, map };
    }
  }

  return null;
}

export function isConsumptionReportSheet(ws: ExcelJS.Worksheet): boolean {
  const titleCandidates = [
    cellText(ws.getCell(1, 1).value),
    cellText(ws.getCell(1, 2).value),
    cellText(ws.getCell(1, 3).value),
  ]
    .join(" ")
    .toLowerCase();

  const looksLikeReport =
    titleCandidates.includes("fuel consumption report") ||
    titleCandidates.includes("báo cáo tiêu thụ") ||
    titleCandidates.includes("bao cao tieu thu");

  const header = findHeaderRow(ws);
  if (!header) return false;
  return looksLikeReport || Boolean(header.map.date && header.map.machine && header.map.fuelUsed);
}

function shouldSkipConsumptionRow(machineLabel: string, fuelTypeText: string): boolean {
  const text = machineLabel.trim().toLowerCase();
  const fuelType = fuelTypeText.trim().toLowerCase();
  if (fuelType === "total" || fuelType.startsWith("total ")) return true;
  if (!text) return true;
  if (text.includes("carry forward")) return true;
  if (text.includes("purchasing")) return true;
  return false;
}

function provisionalFuelKindFromText(
  raw: string,
  sheetName: string,
): FuelUsageImportFuelKind | null {
  const text = `${raw} ${sheetName}`.trim().toLowerCase();
  if (!text) return null;
  if (
    text.includes("ron") ||
    text.includes("petrol") ||
    text.includes("xăng") ||
    text.includes("xang") ||
    text.includes("gasoline")
  ) {
    return "petrol";
  }
  if (
    text.includes("diesel") ||
    text.includes("dầu") ||
    text.includes("dau") ||
    text.startsWith("do ") ||
    text.startsWith("do0") ||
    text.startsWith("do_") ||
    /^do[\s,._0-9]/.test(text) ||
    text.includes(" do")
  ) {
    return "diesel";
  }
  // Sheet name alone: DO… / RON…
  if (sheetName.toLowerCase().includes("ron")) return "petrol";
  if (/^do/i.test(sheetName.trim())) return "diesel";
  return null;
}

/**
 * Extract Purpose from Machine/License Plate parentheses:
 * "Xe máy … (đi PT mua đồ ngày 04/02)" → "đi PT mua đồ ngày 04/02"
 * Also supports trailing unclosed "(...." segments.
 */
export function extractPurposeFromMachineLabel(machineLabel: string): string {
  const label = machineLabel.replace(/\r?\n/g, " ").trim();
  if (!label) return "";

  const parts: string[] = [];
  for (const match of label.matchAll(/\(([^)]*)\)/g)) {
    const text = String(match[1] ?? "").trim();
    if (text) parts.push(text);
  }

  const lastOpen = label.lastIndexOf("(");
  const lastClose = label.lastIndexOf(")");
  if (lastOpen >= 0 && lastOpen > lastClose) {
    const trailing = label
      .slice(lastOpen + 1)
      .trim()
      .replace(/[,\s]+$/g, "");
    if (trailing && !parts.includes(trailing)) {
      parts.push(trailing);
    }
  }

  return parts.join("; ").trim();
}

/**
 * Parse Phan Thiet / Fuel Consumption Report sheets (one transaction per row).
 * Skips Carry forward / Purchasing rows. Does not emit stock imports.
 * Stores fuel_type_raw for later catalog resolve (Fleet Option Catalog → fuel types).
 * Parenthetical notes in Machine/License Plate → purpose.
 */
export function parseConsumptionReportSheet(ws: ExcelJS.Worksheet): FuelUsageImportRawEntry[] {
  const header = findHeaderRow(ws);
  if (!header) return [];

  const { row: headerRow, map } = header;
  const entries: FuelUsageImportRawEntry[] = [];
  const entryKeyTotals = new Map<string, FuelUsageImportRawEntry>();
  const maxRow = Math.max(ws.rowCount, headerRow + 1);

  for (let row = headerRow + 1; row <= maxRow; row += 1) {
    const machineLabel = map.machine != null ? cellText(ws.getCell(row, map.machine).value) : "";
    const fuelTypeText = map.fuelType != null ? cellText(ws.getCell(row, map.fuelType).value) : "";
    if (shouldSkipConsumptionRow(machineLabel, fuelTypeText)) continue;

    const fuelDate = map.date != null ? parseDateCell(ws.getCell(row, map.date).value) : "";
    if (!fuelDate) continue;

    const litres = map.fuelUsed != null ? parseLitres(ws.getCell(row, map.fuelUsed).value) : null;
    if (litres == null) continue;

    const fuelKind = provisionalFuelKindFromText(fuelTypeText, ws.name);
    if (!fuelKind) continue;

    const faCode = map.faCode != null ? cellText(ws.getCell(row, map.faCode).value) : "";
    const purpose = extractPurposeFromMachineLabel(machineLabel) || null;
    const key = `${fuelDate}|${machineLabel.toLowerCase()}|${faCode.toLowerCase()}|${fuelKind}|${fuelTypeText.toLowerCase()}|${(purpose ?? "").toLowerCase()}`;
    const existing = entryKeyTotals.get(key);
    if (existing) {
      existing.litres = Math.round((existing.litres + litres) * 1000) / 1000;
      continue;
    }

    const entry: FuelUsageImportRawEntry = {
      fuel_date: fuelDate,
      vehicle_label: machineLabel,
      fa_code: faCode || undefined,
      fuel_type_raw: fuelTypeText || undefined,
      purpose,
      fuel_kind: fuelKind,
      litres,
      sheet_name: ws.name,
    };
    entryKeyTotals.set(key, entry);
    entries.push(entry);
  }

  return entries;
}
