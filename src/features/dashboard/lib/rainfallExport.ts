import type { RainfallRecentEntry } from "@/features/dashboard/api/rainfallApi";
import type { ProjectListGoogleSheetExportPayload } from "@/features/project/lib/projectListExport";
import ExcelJS from "exceljs";

const COMPANY_NAME = "SPORTS TURF SOLUTIONS";
const MATRIX_COLS = 14;

const CHART_BLUE = "FF333399";
/** 1-based Excel row of the DATE / month header row in `buildRainfallChartMatrix`. */
const TABLE_HEADER_ROW = 5;
/** 1-based Excel row of the monthly Totals row. */
const TOTALS_ROW = 38;

type BorderStyle = ExcelJS.BorderStyle;

function cellBorder(
  top: BorderStyle,
  left: BorderStyle,
  bottom: BorderStyle,
  right: BorderStyle,
): Partial<ExcelJS.Borders> {
  return {
    top: { style: top },
    left: { style: left },
    bottom: { style: bottom },
    right: { style: right },
  };
}

function styleRainfallWorksheet(ws: ExcelJS.Worksheet, rowCount: number): void {
  ws.mergeCells(1, 1, 1, MATRIX_COLS);
  ws.mergeCells(2, 1, 2, MATRIX_COLS);
  ws.mergeCells(3, 1, 3, MATRIX_COLS);

  const titleCell = ws.getCell(1, 1);
  titleCell.font = { name: "Arial", size: 16, color: { argb: CHART_BLUE } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };

  const farmCell = ws.getCell(2, 1);
  farmCell.font = { name: "Arial", size: 10, bold: true, color: { argb: CHART_BLUE } };
  farmCell.alignment = { horizontal: "center", vertical: "middle" };

  const companyCell = ws.getCell(3, 1);
  companyCell.font = { name: "Arial", size: 10, bold: true, color: { argb: CHART_BLUE } };
  companyCell.alignment = { horizontal: "center", vertical: "middle" };

  ws.getCell(4, 1).font = { name: "Arial", size: 14, color: { argb: CHART_BLUE } };

  for (let col = 1; col <= MATRIX_COLS; col += 1) {
    const header = ws.getCell(TABLE_HEADER_ROW, col);
    header.font = { name: "Arial", size: 8, bold: true };
    header.alignment = { horizontal: "center", vertical: "middle" };

    const mm = ws.getCell(TABLE_HEADER_ROW + 1, col);
    mm.font = { name: "Arial", size: 8, bold: true };
    mm.alignment = { horizontal: "center", vertical: "middle" };
  }

  const tableEnd = Math.max(rowCount, TABLE_HEADER_ROW);
  for (let row = TABLE_HEADER_ROW; row <= tableEnd; row += 1) {
    for (let col = 1; col <= MATRIX_COLS; col += 1) {
      const cell = ws.getCell(row, col);
      const top: BorderStyle = row === TABLE_HEADER_ROW ? "medium" : "thin";
      const bottom: BorderStyle =
        row === TOTALS_ROW ? "double" : row === tableEnd ? "medium" : "thin";
      const left: BorderStyle = col === 1 ? "medium" : "thin";
      const right: BorderStyle = col === MATRIX_COLS ? "medium" : "thin";
      cell.border = cellBorder(top, left, bottom, right);
      if (row >= TABLE_HEADER_ROW + 2) {
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.font = { name: "Arial", size: 7 };
      }
    }
  }

  ws.getColumn(1).width = 7.5;
  for (let col = 2; col <= 13; col += 1) {
    ws.getColumn(col).width = 6.7;
  }
  ws.getColumn(14).width = 6.7;

  ws.getRow(1).height = 22;
  ws.getRow(2).height = 18;
  ws.getRow(3).height = 18;
}

function roundMm(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatCumulativeCell(total: number, emptyDash: string): string | number {
  if (total <= 0) return emptyDash;
  return `  ${roundMm(total)} `;
}

export type RainfallChartLabels = {
  chartTitle: string;
  date: string;
  unitMm: string;
  monthHeaders: string[];
  monthAvgHeaders: string[];
  totals: string;
  noOf: string;
  days: string;
  cumulativeHeaders: string[];
  average: string;
  yearCol: string;
  all: string;
  years: string;
  emptyDash: string;
};

const EXCEL_SHEET_NAME_MAX = 31;
const GOOGLE_SHEET_NAME_MAX = 100;

export function sanitizeRainfallSheetName(name: string, maxLen = EXCEL_SHEET_NAME_MAX): string {
  const sanitized = name
    .replace(/[\\/*?:\[\]]/g, "")
    .trim()
    .slice(0, maxLen);
  return sanitized || "Farm";
}

export function uniqueRainfallSheetNames(
  farms: Array<{ id: string; label: string }>,
  maxLen = EXCEL_SHEET_NAME_MAX,
): Map<string, string> {
  const used = new Map<string, number>();
  const result = new Map<string, string>();
  for (const farm of farms) {
    const base = sanitizeRainfallSheetName(farm.label, maxLen);
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    const sheetName =
      count > 1
        ? sanitizeRainfallSheetName(`${base.slice(0, Math.max(1, maxLen - 2))}_${count}`, maxLen)
        : base;
    result.set(farm.id, sheetName);
  }
  return result;
}

export type BuildRainfallChartMatrixOpts = {
  year: number;
  farmId: string | number;
  farmName: string;
  entries: RainfallRecentEntry[];
  labels: RainfallChartLabels;
  /** Match dashboard manual-only rainfall display. */
  manualOnly?: boolean;
};

/**
 * STS rainfall registration chart — same layout as the legacy Excel template
 * (days 1–31 × months, monthly totals, cumulative summary rows).
 */
export function buildRainfallChartMatrix(opts: BuildRainfallChartMatrixOpts): unknown[][] {
  const { year, farmId, farmName, entries, labels, manualOnly = false } = opts;
  const farmKey = String(farmId);
  const monthHeaders = labels.monthHeaders.slice(0, 12);
  const monthAvgHeaders = labels.monthAvgHeaders.slice(0, 12);
  const cumulativeHeaders = labels.cumulativeHeaders.slice(0, 12);

  const byDate = new Map<string, number>();
  for (const entry of entries) {
    if (String(entry.farm_id) !== farmKey) continue;
    if (!entry.date.startsWith(String(year))) continue;
    if (manualOnly && entry.source !== "manual") continue;
    byDate.set(entry.date, entry.rainfall_mm);
  }

  const dayGrid: Array<Array<number | "">> = Array.from({ length: 31 }, () =>
    Array.from({ length: 12 }, () => ""),
  );

  for (let month = 1; month <= 12; month += 1) {
    const daysInMonth = new Date(year, month, 0).getDate();
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const mm = byDate.get(date);
      if (mm != null && mm > 0) {
        dayGrid[day - 1][month - 1] = roundMm(mm);
      }
    }
  }

  const monthlyTotals = Array.from({ length: 12 }, (_, monthIndex) => {
    let sum = 0;
    for (let day = 0; day < 31; day += 1) {
      const cell = dayGrid[day][monthIndex];
      if (typeof cell === "number") sum += cell;
    }
    return roundMm(sum);
  });

  const yearTotal = roundMm(monthlyTotals.reduce((sum, mm) => sum + mm, 0));

  const matrix: unknown[][] = [];
  matrix.push([labels.chartTitle]);
  matrix.push([farmName.trim() || "Farm"]);
  matrix.push([COMPANY_NAME]);
  matrix.push([year, ...Array(MATRIX_COLS - 1).fill("")]);
  matrix.push([labels.date, ...monthHeaders, labels.date]);
  matrix.push(["", ...monthHeaders.map(() => labels.unitMm), ""]);

  for (let day = 1; day <= 31; day += 1) {
    const row = dayGrid[day - 1];
    matrix.push([day, ...row, day]);
  }

  matrix.push([labels.totals, ...monthlyTotals, ""]);
  matrix.push([labels.noOf, ...Array(MATRIX_COLS - 1).fill("")]);
  matrix.push([labels.days, ...Array(MATRIX_COLS - 1).fill("")]);
  matrix.push(["", ...cumulativeHeaders, ""]);
  matrix.push([
    labels.totals,
    ...monthlyTotals.map((mm) => formatCumulativeCell(mm, labels.emptyDash)),
    yearTotal > 0 ? `  ${yearTotal} ` : labels.emptyDash,
    "",
  ]);
  matrix.push([labels.average, ...monthAvgHeaders, labels.yearCol]);
  matrix.push([labels.all, ...Array(MATRIX_COLS - 1).fill("")]);
  matrix.push([labels.years, ...Array(MATRIX_COLS - 1).fill("")]);

  return matrix;
}

export type RainfallExportSheet = {
  farmId: string;
  farmName: string;
  matrix: unknown[][];
};

function matrixToGoogleTab(matrix: unknown[][], sheetTabName: string) {
  return {
    sheetTabName,
    headers: (matrix[0] ?? []).map((h) => (h == null ? "" : String(h))),
    rows: matrix.slice(1).map((row) => row.map((cell) => (cell == null ? "" : String(cell)))),
  };
}

export function buildRainfallExportFileName(
  year: number,
  format: "csv" | "xlsx",
  farmName?: string,
): string {
  if (farmName?.trim()) {
    const safeFarm = farmName.replace(/[^\w\-]+/g, "-").replace(/-+/g, "-") || "farm";
    return `RAINFALLS-CHART-${safeFarm}-${year}.${format}`;
  }
  return `RAINFALLS-CHART-${year}.${format}`;
}

export function exportRainfallWorkbookToCsv(sheets: RainfallExportSheet[], fileName: string): void {
  if (sheets.length === 0) return;

  const escapeCsv = (v: unknown) => {
    const s = v == null ? "" : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const blocks = sheets.map((sheet) =>
    sheet.matrix.map((row) => row.map((cell) => escapeCsv(cell)).join(",")).join("\n"),
  );
  const csv = `\uFEFF${blocks.join("\n\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportRainfallWorkbookToXlsx(
  sheets: RainfallExportSheet[],
  fileName: string,
): Promise<void> {
  if (sheets.length === 0) return;

  const wb = new ExcelJS.Workbook();
  const sheetNames = uniqueRainfallSheetNames(
    sheets.map((sheet) => ({ id: sheet.farmId, label: sheet.farmName })),
  );

  for (const sheet of sheets) {
    const tabName = sheetNames.get(sheet.farmId) ?? sanitizeRainfallSheetName(sheet.farmName);
    const ws = wb.addWorksheet(tabName);
    for (const row of sheet.matrix) {
      ws.addRow(row);
    }
    styleRainfallWorksheet(ws, sheet.matrix.length);
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(objectUrl);
}

export async function exportRainfallWorkbookToGoogleSheet(opts: {
  sheets: RainfallExportSheet[];
  year: number;
  spreadsheetTitle: string;
}): Promise<{
  ok: boolean;
  message?: string;
  needsAuth?: boolean;
  authorizePath?: string;
  spreadsheetUrl?: string;
}> {
  const { sheets, year, spreadsheetTitle } = opts;
  if (sheets.length === 0) {
    return { ok: false, message: "No data to export." };
  }

  const sheetNames = uniqueRainfallSheetNames(
    sheets.map((sheet) => ({ id: sheet.farmId, label: sheet.farmName })),
    GOOGLE_SHEET_NAME_MAX,
  );

  const tabs = sheets.map((sheet) =>
    matrixToGoogleTab(sheet.matrix, sheetNames.get(sheet.farmId) ?? sheet.farmName),
  );

  const payload: ProjectListGoogleSheetExportPayload = {
    headers: tabs[0]?.headers ?? [],
    rows: tabs[0]?.rows ?? [],
    spreadsheetTitle,
    tabs,
  };

  const res = await fetch("/api/projects/export/google-sheet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    message?: string;
    needsAuth?: boolean;
    authorizePath?: string;
    spreadsheetUrl?: string;
  };

  if (data.needsAuth) {
    return {
      ok: false,
      needsAuth: true,
      authorizePath:
        data.authorizePath ?? "/api/projects/export/google-sheet/oauth/authorize",
      message: data.message,
    };
  }
  if (!res.ok || !data.ok) {
    return {
      ok: false,
      message: data.message ?? `Google Sheet export failed (${res.status}).`,
    };
  }
  return {
    ok: true,
    message: data.message,
    spreadsheetUrl: data.spreadsheetUrl,
  };
}
