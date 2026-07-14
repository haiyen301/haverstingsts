import ExcelJS from "exceljs";

import type { VehicleInspectionRow } from "@/features/fleet/api/vehicleInspectionsApi";
import {
  isConsumptionReportSheet,
  parseConsumptionReportSheet,
} from "@/features/fleet/lib/fuelUsageConsumptionImport";
import { resolveFuelStockImportFuelKind } from "@/features/fleet/lib/fuelStockImport";

const DAYS_PER_BLOCK = 7;
const TOTAL_COL_INDEX = 1 + DAYS_PER_BLOCK * 2;

export type FuelUsageImportFuelKind = string;

export type FuelUsageImportRawEntry = {
  fuel_date: string;
  vehicle_label: string;
  /** Optional FA / asset code from Fuel Consumption Report (Phan Thiet). */
  fa_code?: string;
  /**
   * Raw Excel Fuel Type text (e.g. "DO 0,05_II", "RON 95_III") before catalog resolve.
   * Diary imports may omit this.
   */
  fuel_type_raw?: string;
  /** Catalog value after resolve (typically diesel / petrol). */
  fuel_kind: FuelUsageImportFuelKind;
  litres: number;
  sheet_name: string;
};

export type FuelStockImportRawEntry = {
  balance_date: string;
  fuel_kind: FuelUsageImportFuelKind;
  import_qty: number;
  sheet_name: string;
};

export type FuelUsageImportSheetSummary = {
  sheet_name: string;
  entry_count: number;
  stock_import_count: number;
};

export type FuelUsageImportParseResult = {
  entries: FuelUsageImportRawEntry[];
  stock_imports: FuelStockImportRawEntry[];
  sheets: FuelUsageImportSheetSummary[];
  date_from: string | null;
  date_to: string | null;
};

export type FuelUsageImportPreviewRow = FuelUsageImportRawEntry & {
  vehicle_inspection_id: number | null;
  vehicle_type: string;
  matched_vehicle_label: string;
  status: "ready" | "unmatched";
};

export type FuelUsageImportMatchResult = {
  rows: FuelUsageImportPreviewRow[];
  readyCount: number;
  unmatchedCount: number;
  unmatchedLabels: string[];
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
    // Legacy exports stored local midnight (calendar day differs between UTC and local).
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

function stripDiacritics(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "");
}

/** Collapse spaces, strip parenthetical trip notes, lowercase. */
function normalizeForFuzzyMatch(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/[^\p{L}\p{N}/]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeVehicleKey(label: string): string {
  return normalizeForFuzzyMatch(label);
}

/** Full label + each side of `/` (bilingual PT names), with and without diacritics. */
function vehicleMatchVariants(label: string): string[] {
  const base = normalizeForFuzzyMatch(label);
  if (!base) return [];
  const parts = [base, ...base.split("/").map((part) => part.trim()).filter(Boolean)];
  const keys = new Set<string>();
  for (const part of parts) {
    if (!part) continue;
    keys.add(part);
    const folded = stripDiacritics(part).replace(/\s+/g, " ").trim();
    if (folded) keys.add(folded);
  }
  return Array.from(keys);
}

function tokenizeMatchKey(key: string): string[] {
  return key
    .split(/[\s/]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

const SHORT_NOISE_TOKENS = new Set([
  "may",
  "máy",
  "xe",
  "anh",
  "tym",
  "a",
  "an",
  "the",
  "and",
  "of",
  "in",
  "to",
  "for",
]);

function isNoiseOnlyTokenMatch(sharedTokens: string[]): boolean {
  if (sharedTokens.length === 0) return true;
  if (sharedTokens.length === 1) {
    const token = sharedTokens[0]!;
    return token.length < 4 || SHORT_NOISE_TOKENS.has(token) || SHORT_NOISE_TOKENS.has(stripDiacritics(token));
  }
  return false;
}

function normalizeFaCode(code: string): string {
  return code.trim().toLowerCase().replace(/\s+/g, "");
}

/** Real FA/asset codes (e.g. TS102) — ignore category fillers like "machine". */
function isUsableFaCode(code: string): boolean {
  const fa = normalizeFaCode(code);
  if (!fa) return false;
  if (!/[0-9]/.test(fa)) return false;
  if (fa === "machine" || fa === "motobike" || fa === "mtobike" || fa === "farm") {
    return false;
  }
  return true;
}

function isDateHeaderLabel(label: string): boolean {
  const text = label.trim().toLowerCase();
  return (
    text === "date" ||
    text.includes("ngày/date") ||
    (text.startsWith("ngày/") && text.includes("date"))
  );
}

function isDateHeaderRow(ws: ExcelJS.Worksheet, row: number): boolean {
  const label = cellText(ws.getCell(row, 1).value);
  const firstDate = parseDateCell(ws.getCell(row, 2).value);
  if (!firstDate) return false;
  return isDateHeaderLabel(label);
}

function isSummarySheet(ws: ExcelJS.Worksheet): boolean {
  const row2 = cellText(ws.getCell(2, 1).value).toLowerCase();
  if (row2.includes("month") || row2.includes("tháng")) {
    return true;
  }
  const row1 = cellText(ws.getCell(1, 1).value).toLowerCase();
  return row1.includes("report at farm") && row2.includes("month");
}

function isDiarySheet(ws: ExcelJS.Worksheet): boolean {
  if (isSummarySheet(ws)) return false;
  for (let row = 1; row <= 12; row += 1) {
    if (isDateHeaderRow(ws, row)) return true;
  }
  return false;
}

function isSectionHeaderLabel(label: string): boolean {
  const text = label.trim().toLowerCase();
  if (!text) return false;
  // Diary section titles only — not equipment rows like "Diesel Pump (Pump)" / "Petrol Pump (Pump)".
  if (
    text === "máy dầu/diesel" ||
    text === "diesel machines" ||
    text.startsWith("máy dầu/") ||
    text.includes("เครื่องดีเซล")
  ) {
    return true;
  }
  if (
    text === "máy xăng/petro" ||
    text === "máy xăng/petrol" ||
    text === "petrol machines" ||
    text.startsWith("máy xăng/") ||
    text.includes("เครื่องเบนซิน")
  ) {
    return true;
  }
  return false;
}

function sectionForLabel(label: string): FuelUsageImportFuelKind | null {
  if (!isSectionHeaderLabel(label)) return null;
  const text = label.trim().toLowerCase();
  if (
    text.includes("diesel") ||
    text.includes("máy dầu") ||
    text.includes("may dau") ||
    text.includes("เครื่องดีเซล")
  ) {
    return "diesel";
  }
  if (
    text.includes("petrol") ||
    text.includes("petro") ||
    text.includes("xăng") ||
    text.includes("xang") ||
    text.includes("máy xăng") ||
    text.includes("เครื่องเบนซิน")
  ) {
    return "petrol";
  }
  return null;
}

function shouldSkipVehicleRow(label: string): boolean {
  const text = label.trim().toLowerCase();
  if (!text) return true;
  if (isDateHeaderLabel(label)) return true;
  if (text.startsWith("diary fuel")) return true;
  // "Mechanical" is a real petrol equipment row in the diary — do not skip it.
  if (isStockImportRowLabel(label)) return true;
  if (text.includes("remaining") || text.includes("tồn")) return true;
  if (text.includes("total amount")) return true;
  if (text === "tổng sl" || text === "total qty") return true;
  return false;
}

/** End of equipment list for the current fuel section (Import diesel / Import gasoline). */
function isSectionEndLabel(label: string): boolean {
  return isStockImportRowLabel(label);
}

function isStockImportRowLabel(label: string): boolean {
  return stockImportKindForLabel(label) !== null;
}

function stockImportKindForLabel(label: string): FuelUsageImportFuelKind | null {
  const text = label.trim().toLowerCase();
  if (!text.includes("import")) return null;
  if (text.includes("diesel") || text.includes("dầu") || text.includes("dau")) {
    return "diesel";
  }
  if (
    text.includes("petrol") ||
    text.includes("petro") ||
    text.includes("xăng") ||
    text.includes("xang") ||
    text.includes("gas")
  ) {
    return "petrol";
  }
  return null;
}

function vehicleDisplayLabel(row: VehicleInspectionRow): string {
  const alias = String(row.alias_name ?? "").trim();
  const name = String(row.vehicle_name ?? "").trim();
  if (alias && name && alias !== name) {
    return `${alias} (${name})`;
  }
  return alias || name || `#${row.id}`;
}

type VehicleMatchCandidate = {
  vehicle: VehicleInspectionRow;
  variants: string[];
  faCode: string | null;
};

type ScoredVehicleMatch = {
  vehicle: VehicleInspectionRow;
  score: number;
};

function farmVehiclesForMatch(
  vehicles: VehicleInspectionRow[],
  farmId: number,
): VehicleMatchCandidate[] {
  const candidates: VehicleMatchCandidate[] = [];
  for (const vehicle of vehicles) {
    if (Number(vehicle.farm_id) !== farmId) continue;
    const labels = [
      String(vehicle.alias_name ?? "").trim(),
      String(vehicle.vehicle_name ?? "").trim(),
      vehicleDisplayLabel(vehicle),
      String(vehicle.registration ?? "").trim(),
    ].filter(Boolean);
    const variantSet = new Set<string>();
    for (const label of labels) {
      for (const variant of vehicleMatchVariants(label)) {
        variantSet.add(variant);
      }
    }
    const registration = String(vehicle.registration ?? "").trim();
    candidates.push({
      vehicle,
      variants: Array.from(variantSet),
      faCode: isUsableFaCode(registration) ? normalizeFaCode(registration) : null,
    });
  }
  return candidates;
}

function scoreContainment(excelKey: string, vehicleKey: string): number {
  if (!excelKey || !vehicleKey) return 0;
  if (excelKey === vehicleKey) return 100;

  const shorter = excelKey.length <= vehicleKey.length ? excelKey : vehicleKey;
  const longer = excelKey.length <= vehicleKey.length ? vehicleKey : excelKey;
  const shortTokens = tokenizeMatchKey(shorter);
  if (shortTokens.length < 2 && shorter.length < 6) return 0;
  if (!longer.includes(shorter)) return 0;

  // Prefer longer overlapping substring relative to excel label.
  const ratio = shorter.length / Math.max(excelKey.length, 1);
  if (ratio >= 0.85) return 85;
  if (ratio >= 0.6) return 78;
  if (shorter.length >= 10 || shortTokens.length >= 2) return 70;
  return 0;
}

function scoreTokenOverlap(excelKey: string, vehicleKey: string): number {
  const excelTokens = tokenizeMatchKey(excelKey).filter(
    (token) => !SHORT_NOISE_TOKENS.has(token) && !SHORT_NOISE_TOKENS.has(stripDiacritics(token)),
  );
  const vehicleTokens = new Set(
    tokenizeMatchKey(vehicleKey).filter(
      (token) => !SHORT_NOISE_TOKENS.has(token) && !SHORT_NOISE_TOKENS.has(stripDiacritics(token)),
    ),
  );
  if (excelTokens.length === 0 || vehicleTokens.size === 0) return 0;

  const shared = excelTokens.filter((token) => vehicleTokens.has(token));
  if (isNoiseOnlyTokenMatch(shared)) return 0;

  const overlap = shared.length / excelTokens.length;
  if (overlap < 0.7) return 0;
  if (overlap >= 0.95) return 75;
  if (overlap >= 0.85) return 70;
  return 60;
}

function bestScoreAgainstVariants(excelVariants: string[], vehicleVariants: string[]): number {
  let best = 0;
  for (const excelKey of excelVariants) {
    for (const vehicleKey of vehicleVariants) {
      if (excelKey === vehicleKey) return 100;
      best = Math.max(best, scoreContainment(excelKey, vehicleKey));
      best = Math.max(best, scoreTokenOverlap(excelKey, vehicleKey));
    }
  }
  return best;
}

function scoreVehicleCandidates(
  entry: FuelUsageImportRawEntry,
  candidates: VehicleMatchCandidate[],
): ScoredVehicleMatch[] {
  const excelVariants = vehicleMatchVariants(entry.vehicle_label);
  const entryFa = isUsableFaCode(entry.fa_code ?? "")
    ? normalizeFaCode(entry.fa_code ?? "")
    : null;

  const scored: ScoredVehicleMatch[] = [];
  for (const candidate of candidates) {
    let score = bestScoreAgainstVariants(excelVariants, candidate.variants);
    if (entryFa && candidate.faCode && entryFa === candidate.faCode) {
      score = Math.max(score, 90);
    }
    if (score > 0) {
      scored.push({ vehicle: candidate.vehicle, score });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return Number(a.vehicle.id) - Number(b.vehicle.id);
  });
  return scored;
}

const MIN_ACCEPT_SCORE = 60;
const MIN_SCORE_GAP = 15;

/**
 * Pick a unique clear winner. Reject ties and weak/ambiguous matches
 * (e.g. bare "TYM" matching TYM 1/2/3).
 */
function resolveVehicleFromScores(scored: ScoredVehicleMatch[]): VehicleInspectionRow | null {
  if (scored.length === 0) return null;
  const top = scored[0]!;
  if (top.score < MIN_ACCEPT_SCORE) return null;
  const second = scored[1];
  if (second && second.score === top.score) return null;
  if (second && top.score < 90 && top.score - second.score < MIN_SCORE_GAP) return null;
  return top.vehicle;
}

function resolveVehicleForEntry(
  entry: FuelUsageImportRawEntry,
  candidates: VehicleMatchCandidate[],
): VehicleInspectionRow | null {
  return resolveVehicleFromScores(scoreVehicleCandidates(entry, candidates));
}

function parseDiarySheet(ws: ExcelJS.Worksheet): FuelUsageImportRawEntry[] {
  const entries: FuelUsageImportRawEntry[] = [];
  const entryKeyTotals = new Map<string, FuelUsageImportRawEntry>();
  const maxRow = Math.max(ws.rowCount, 200);
  let row = 1;

  while (row <= maxRow) {
    if (!isDateHeaderRow(ws, row)) {
      row += 1;
      continue;
    }

    const dateRow = row;
    const dateByCol = new Map<number, string>();
    for (let col = 2; col <= TOTAL_COL_INDEX; col += 2) {
      let date = parseDateCell(ws.getCell(dateRow, col).value);
      if (!date) {
        date = parseDateCell(ws.getCell(dateRow, col + 1).value);
      }
      if (date) dateByCol.set(col, date);
    }

    if (dateByCol.size === 0) {
      row += 1;
      continue;
    }

    let currentSection: FuelUsageImportFuelKind | null = null;
    row = dateRow + 2;

    while (row <= maxRow) {
      if (isDateHeaderRow(ws, row)) {
        break;
      }

      const label = cellText(ws.getCell(row, 1).value);
      const section = sectionForLabel(label);
      if (section) {
        // Start equipment range: máy dầu/diesel … or Máy Xăng/Petro …
        currentSection = section;
        row += 1;
        continue;
      }
      // End equipment range at Import diesel / Ngày nhập xăng/Import gasoline.
      if (isSectionEndLabel(label)) {
        currentSection = null;
        row += 1;
        continue;
      }
      if (!currentSection || shouldSkipVehicleRow(label)) {
        row += 1;
        continue;
      }

      for (const [col, fuelDate] of dateByCol.entries()) {
        const litres = parseLitres(ws.getCell(row, col).value);
        if (litres == null) continue;
        const key = `${fuelDate}|${normalizeVehicleKey(label)}|${currentSection}`;
        const existing = entryKeyTotals.get(key);
        if (existing) {
          existing.litres = Math.round((existing.litres + litres) * 1000) / 1000;
          continue;
        }
        const entry: FuelUsageImportRawEntry = {
          fuel_date: fuelDate,
          vehicle_label: label,
          fuel_kind: currentSection,
          litres,
          sheet_name: ws.name,
        };
        entryKeyTotals.set(key, entry);
        entries.push(entry);
      }

      row += 1;
    }
  }

  return entries;
}

function parseDiaryStockImports(ws: ExcelJS.Worksheet): FuelStockImportRawEntry[] {
  const imports: FuelStockImportRawEntry[] = [];
  const importKeyTotals = new Map<string, FuelStockImportRawEntry>();
  const maxRow = Math.max(ws.rowCount, 200);
  let row = 1;

  while (row <= maxRow) {
    if (!isDateHeaderRow(ws, row)) {
      row += 1;
      continue;
    }

    const dateRow = row;
    const dateByCol = new Map<number, string>();
    for (let col = 2; col <= TOTAL_COL_INDEX; col += 2) {
      let date = parseDateCell(ws.getCell(dateRow, col).value);
      if (!date) {
        date = parseDateCell(ws.getCell(dateRow, col + 1).value);
      }
      if (date) dateByCol.set(col, date);
    }

    if (dateByCol.size === 0) {
      row += 1;
      continue;
    }

    row = dateRow + 2;

    while (row <= maxRow) {
      if (isDateHeaderRow(ws, row)) {
        break;
      }

      const label = cellText(ws.getCell(row, 1).value);
      const fuelKind = stockImportKindForLabel(label);
      if (!fuelKind) {
        row += 1;
        continue;
      }

      for (const [col, balanceDate] of dateByCol.entries()) {
        const importQty = parseLitres(ws.getCell(row, col).value);
        if (importQty == null) continue;
        const key = `${balanceDate}|${fuelKind}`;
        const existing = importKeyTotals.get(key);
        if (existing) {
          existing.import_qty = Math.round((existing.import_qty + importQty) * 1000) / 1000;
          continue;
        }
        const entry: FuelStockImportRawEntry = {
          balance_date: balanceDate,
          fuel_kind: fuelKind,
          import_qty: importQty,
          sheet_name: ws.name,
        };
        importKeyTotals.set(key, entry);
        imports.push(entry);
      }

      row += 1;
    }
  }

  return imports;
}

export function isFuelDiaryWorkbook(fileName: string): boolean {
  const lower = fileName.trim().toLowerCase();
  return lower.endsWith(".xlsx") || lower.endsWith(".xls");
}

export type FuelUsageImportFuelTypeOption = {
  value: string;
  label: string;
};

/**
 * Resolve entry.fuel_kind against Fleet Option Catalog (fleet_fuel_types).
 * Uses Excel fuel_type_raw when present (Phan Thiet), else provisional fuel_kind (diary).
 */
export function resolveFuelUsageImportFuelKinds(
  entries: FuelUsageImportRawEntry[],
  fuelTypeOptions: FuelUsageImportFuelTypeOption[],
): FuelUsageImportRawEntry[] {
  return entries.map((entry) => {
    const raw = String(entry.fuel_type_raw ?? entry.fuel_kind ?? "").trim();
    if (!raw) return entry;
    const resolved = resolveFuelStockImportFuelKind(raw, fuelTypeOptions);
    if (!resolved) return entry;
    return { ...entry, fuel_kind: resolved };
  });
}

export async function parseFuelUsageImportWorkbook(
  buffer: ArrayBuffer,
): Promise<FuelUsageImportParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const entries: FuelUsageImportRawEntry[] = [];
  const stockImports: FuelStockImportRawEntry[] = [];
  const sheets: FuelUsageImportSheetSummary[] = [];

  for (const worksheet of workbook.worksheets) {
    // Phan Thiet Fuel Consumption Report first (has Month/Tháng title rows).
    if (isConsumptionReportSheet(worksheet)) {
      const sheetEntries = parseConsumptionReportSheet(worksheet);
      if (sheetEntries.length === 0) continue;
      entries.push(...sheetEntries);
      sheets.push({
        sheet_name: worksheet.name,
        entry_count: sheetEntries.length,
        stock_import_count: 0,
      });
      continue;
    }

    if (!isDiarySheet(worksheet)) continue;
    const sheetEntries = parseDiarySheet(worksheet);
    const sheetStockImports = parseDiaryStockImports(worksheet);
    if (sheetEntries.length === 0 && sheetStockImports.length === 0) continue;
    entries.push(...sheetEntries);
    stockImports.push(...sheetStockImports);
    sheets.push({
      sheet_name: worksheet.name,
      entry_count: sheetEntries.length,
      stock_import_count: sheetStockImports.length,
    });
  }

  entries.sort((a, b) => {
    const dateCmp = a.fuel_date.localeCompare(b.fuel_date);
    if (dateCmp !== 0) return dateCmp;
    return a.vehicle_label.localeCompare(b.vehicle_label);
  });

  stockImports.sort((a, b) => {
    const dateCmp = a.balance_date.localeCompare(b.balance_date);
    if (dateCmp !== 0) return dateCmp;
    return a.fuel_kind.localeCompare(b.fuel_kind);
  });

  const allDates = [
    ...entries.map((entry) => entry.fuel_date),
    ...stockImports.map((entry) => entry.balance_date),
  ].sort();

  return {
    entries,
    stock_imports: stockImports,
    sheets,
    date_from: allDates[0] ?? null,
    date_to: allDates.at(-1) ?? null,
  };
}

export function matchFuelUsageImportEntries(
  entries: FuelUsageImportRawEntry[],
  vehicles: VehicleInspectionRow[],
  farmId: number,
): FuelUsageImportMatchResult {
  const candidates = farmVehiclesForMatch(vehicles, farmId);
  const rows: FuelUsageImportPreviewRow[] = [];
  const unmatchedByKey = new Map<string, string>();

  for (const entry of entries) {
    if (isDateHeaderLabel(entry.vehicle_label) || shouldSkipVehicleRow(entry.vehicle_label)) {
      continue;
    }
    const vehicle = resolveVehicleForEntry(entry, candidates);
    if (!vehicle) {
      const key =
        normalizeVehicleKey(entry.vehicle_label) ||
        normalizeFaCode(entry.fa_code ?? "") ||
        entry.vehicle_label.trim();
      if (key && !unmatchedByKey.has(key)) {
        unmatchedByKey.set(key, entry.vehicle_label.trim() || entry.fa_code?.trim() || key);
      }
      rows.push({
        ...entry,
        vehicle_inspection_id: null,
        vehicle_type: "",
        matched_vehicle_label: "",
        status: "unmatched",
      });
      continue;
    }
    rows.push({
      ...entry,
      vehicle_inspection_id: Number(vehicle.id),
      vehicle_type: String(vehicle.vehicle_type ?? "").trim(),
      matched_vehicle_label: vehicleDisplayLabel(vehicle),
      status: "ready",
    });
  }

  const readyCount = rows.filter((row) => row.status === "ready").length;

  return {
    rows,
    readyCount,
    unmatchedCount: rows.length - readyCount,
    unmatchedLabels: Array.from(unmatchedByKey.values()).sort((a, b) => a.localeCompare(b)),
  };
}
