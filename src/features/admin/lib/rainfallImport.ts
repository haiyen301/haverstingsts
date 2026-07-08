import ExcelJS from "exceljs";

const MONTH_MAP: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

export type RainfallImportEntry = {
  record_date: string;
  rainfall_mm: number;
};

export type RainfallImportSheetSummary = {
  sheet_name: string;
  year: number;
  entry_count: number;
};

export type RainfallImportParseResult = {
  entries: RainfallImportEntry[];
  sheets: RainfallImportSheetSummary[];
  date_from: string | null;
  date_to: string | null;
};

function cellValue(value: ExcelJS.CellValue): string | number | null {
  if (value == null) return null;
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

function parseMonthHeader(value: string): number {
  const key = value.toLowerCase().replace(/[^a-z]/g, "");
  return MONTH_MAP[key] ?? 0;
}

function parseRainfallMm(value: ExcelJS.CellValue): number | null {
  const raw = cellValue(value);
  if (raw == null || raw === "") return null;
  const mm = Number.parseFloat(String(raw).replace(/,/g, ""));
  if (!Number.isFinite(mm) || mm < 0) return null;
  return Math.round(mm * 100) / 100;
}

function parseYearFromCell(value: ExcelJS.CellValue, sheetName: string): number {
  const fromCell = Number.parseInt(cellText(value), 10);
  if (Number.isFinite(fromCell) && fromCell >= 1900 && fromCell <= 2100) {
    return fromCell;
  }
  const fromSheet = Number.parseInt(sheetName.trim(), 10);
  if (Number.isFinite(fromSheet) && fromSheet >= 1900 && fromSheet <= 2100) {
    return fromSheet;
  }
  return 0;
}

function findDateHeaderRow(ws: ExcelJS.Worksheet): number {
  for (let row = 1; row <= 12; row += 1) {
    if (cellText(ws.getCell(row, 1).value).toUpperCase() === "DATE") {
      return row;
    }
  }
  return 0;
}

export async function parseRainfallImportWorkbook(buffer: ArrayBuffer): Promise<RainfallImportParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const entriesByDate = new Map<string, number>();
  const sheets: RainfallImportSheetSummary[] = [];

  for (const worksheet of workbook.worksheets) {
    const headerRow = findDateHeaderRow(worksheet);
    if (headerRow <= 0) continue;

    const dataStartRow = headerRow + 2;
    const year = parseYearFromCell(worksheet.getCell(headerRow - 1, 1).value, worksheet.name);
    if (year <= 0) continue;

    const months: number[] = [];
    for (let col = 2; col <= 13; col += 1) {
      months.push(parseMonthHeader(cellText(worksheet.getCell(headerRow, col).value)));
    }

    let entryCount = 0;
    for (let day = 1; day <= 31; day += 1) {
      const row = dataStartRow + day - 1;
      for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
        const month = months[monthIndex];
        if (!month) continue;
        const daysInMonth = new Date(year, month, 0).getDate();
        if (day > daysInMonth) continue;

        const rainfallMm = parseRainfallMm(worksheet.getCell(row, monthIndex + 2).value);
        if (rainfallMm == null) continue;

        const recordDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        entriesByDate.set(recordDate, rainfallMm);
        entryCount += 1;
      }
    }

    sheets.push({
      sheet_name: worksheet.name,
      year,
      entry_count: entryCount,
    });
  }

  const entries = Array.from(entriesByDate.entries())
    .map(([record_date, rainfall_mm]) => ({ record_date, rainfall_mm }))
    .sort((a, b) => a.record_date.localeCompare(b.record_date));

  return {
    entries,
    sheets: sheets.sort((a, b) => a.year - b.year),
    date_from: entries[0]?.record_date ?? null,
    date_to: entries.at(-1)?.record_date ?? null,
  };
}

export function isRainfallChartWorkbook(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".xlsx") || lower.endsWith(".xls");
}
