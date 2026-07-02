import ExcelJS from "exceljs";

export type FuelDiaryRowMeta =
  | "title"
  | "date_header"
  | "units"
  | "section_diesel"
  | "section_petrol"
  | "vehicle"
  | "section_total"
  | "import_diesel"
  | "import_petrol"
  | "remaining"
  | "blank"
  | "data";

const DAYS_PER_BLOCK = 7;
const TOTAL_COL_INDEX = 1 + DAYS_PER_BLOCK * 2; // column Q (1-based: 17)

const COLORS = {
  /** Date header row — unified light gray */
  dateGray: "FFF2F2F2",
  /** Liters columns — Blue Accent 5 Lighter 80% */
  litersBlue: "FFD9E2F3",
  /** Hours meter columns — Orange Accent 2 Lighter 40% */
  hoursOrange: "FFF8CBAD",
  /** Section / remaining highlight */
  orange: "FFF4B083",
  yellow: "FFFFE598",
  yellowBright: "FFFFFF00",
  red: "FFFF0000",
  sectionBlue: "FF00B0F0",
  black: "FF000000",
  white: "FFFFFFFF",
};

const thinBorder: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: COLORS.black } },
  left: { style: "thin", color: { argb: COLORS.black } },
  bottom: { style: "thin", color: { argb: COLORS.black } },
  right: { style: "thin", color: { argb: COLORS.black } },
};

function litColNumbers(): number[] {
  const cols: number[] = [];
  for (let day = 0; day < DAYS_PER_BLOCK; day++) {
    cols.push(2 + day * 2);
  }
  return cols;
}

function hoursColNumbers(): number[] {
  const cols: number[] = [];
  for (let day = 0; day < DAYS_PER_BLOCK; day++) {
    cols.push(3 + day * 2);
  }
  return cols;
}

function isDateAreaCol(colNumber: number): boolean {
  return colNumber > 1 && colNumber <= 15;
}

function totalFormulaForRow(excelRow: number): string {
  const refs = litColNumbers().map((col) => `${colToLetter(col)}${excelRow}`);
  return `SUM(${refs.join(",")})`;
}

function colToLetter(col: number): string {
  let n = col;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function setFill(cell: ExcelJS.Cell, argb: string): void {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function applyCellStyle(
  cell: ExcelJS.Cell,
  meta: FuelDiaryRowMeta,
  colNumber: number,
  isLitCol: boolean,
  isHoursCol: boolean,
  isTotalCol: boolean,
): void {
  cell.border = thinBorder;
  cell.alignment = { vertical: "middle", horizontal: colNumber === 1 ? "left" : "center" };

  if (meta === "title") {
    if (colNumber === 1) {
      cell.font = { bold: true, size: 14, name: "Calibri" };
    }
    if (isTotalCol) {
      setFill(cell, COLORS.yellowBright);
      cell.font = { bold: true, size: 12, color: { argb: COLORS.red }, name: "Calibri" };
    }
    return;
  }

  if (meta === "date_header") {
    if (colNumber === 1) {
      cell.font = { size: 12, name: "Times New Roman" };
    } else if (isDateAreaCol(colNumber)) {
      setFill(cell, COLORS.dateGray);
      cell.numFmt = "dd/mm/yyyy";
      cell.font = { size: 12, name: "Times New Roman" };
    }
    return;
  }

  if (meta === "units") {
    if (isLitCol) {
      setFill(cell, COLORS.litersBlue);
      cell.font = { size: 12, name: "Times New Roman" };
    } else if (isHoursCol) {
      setFill(cell, COLORS.hoursOrange);
      cell.font = { size: 12, name: "Times New Roman" };
    }
    return;
  }

  if (meta === "section_diesel" || meta === "section_petrol") {
    if (colNumber === 1) {
      cell.font = { size: 12, color: { argb: COLORS.sectionBlue }, name: "Times New Roman" };
    }
    return;
  }

  if (meta === "import_diesel" || meta === "import_petrol") {
    setFill(cell, COLORS.yellow);
    cell.font = { size: 12, name: "Times New Roman" };
    return;
  }

  if (meta === "remaining") {
    if (isTotalCol) {
      setFill(cell, COLORS.red);
      cell.font = { bold: true, size: 12, color: { argb: COLORS.white }, name: "Calibri" };
    } else {
      setFill(cell, COLORS.orange);
      cell.font =
        colNumber === 1
          ? { bold: true, size: 12, name: "Calibri" }
          : { size: 12, name: "Times New Roman" };
    }
    return;
  }

  if (meta === "vehicle" || meta === "section_total") {
    if (isLitCol) {
      setFill(cell, COLORS.litersBlue);
    } else if (isHoursCol) {
      setFill(cell, COLORS.hoursOrange);
    }
    if (isTotalCol && meta === "section_total") {
      cell.font = { bold: true, size: 12, name: "Times New Roman" };
    }
    return;
  }
}

function parseDiaryDate(value: unknown): Date | unknown {
  if (value == null || value === "") return value;
  if (value instanceof Date) return value;
  const text = String(value).trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (!m) return value;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  return new Date(year, month - 1, day);
}

function applyLayoutMerges(
  ws: ExcelJS.Worksheet,
  placements: Array<{ meta: FuelDiaryRowMeta; excelRow: number }>,
): void {
  for (const { meta, excelRow } of placements) {
    if (meta === "title") {
      ws.mergeCells(excelRow, 1, excelRow, 15);
      continue;
    }
    if (meta === "date_header") {
      for (let day = 0; day < DAYS_PER_BLOCK; day++) {
        const col = 2 + day * 2;
        ws.mergeCells(excelRow, col, excelRow, col + 1);
      }
    }
  }
}

export async function exportFuelDiaryStyledXlsx(opts: {
  matrix?: unknown[][];
  rowMeta?: string[];
  sheets?: Array<{
    matrix: unknown[][];
    row_meta?: string[];
    farm_name?: string;
    period_label?: string;
  }>;
  fileName: string;
  sheetName?: string;
}): Promise<void> {
  const { fileName } = opts;
  const sheetPayloads =
    opts.sheets && opts.sheets.length > 0
      ? opts.sheets
      : opts.matrix && opts.matrix.length > 0
        ? [{ matrix: opts.matrix, row_meta: opts.rowMeta, farm_name: opts.sheetName }]
        : [];

  if (sheetPayloads.length === 0) return;

  const wb = new ExcelJS.Workbook();

  for (const sheetData of sheetPayloads) {
    const { matrix, row_meta: sheetRowMeta } = sheetData;
    if (!matrix || matrix.length === 0) continue;

    const rowMeta = (sheetRowMeta ?? []) as FuelDiaryRowMeta[];
    const litCols = litColNumbers();
    const hoursCols = hoursColNumbers();
    const totalColNumber = TOTAL_COL_INDEX + 1;
    const tabName = (sheetData.farm_name || sheetData.period_label || opts.sheetName || "Fuel Diary")
      .replace(/[\\/*?:[\]]/g, "-")
      .slice(0, 31);
    const ws = wb.addWorksheet(tabName);

    ws.getColumn(1).width = 41.29;
    for (let day = 0; day < DAYS_PER_BLOCK; day++) {
      ws.getColumn(2 + day * 2).width = 8.71;
      ws.getColumn(3 + day * 2).width = 12.14;
    }
    ws.getColumn(totalColNumber).width = 10;

    const placements: Array<{ meta: FuelDiaryRowMeta; excelRow: number }> = [];

    matrix.forEach((rawRow, rowIndex) => {
      const meta = rowMeta[rowIndex] ?? "data";
      if (meta === "blank") {
        ws.addRow([]);
        return;
      }

      const values = Array.from({ length: TOTAL_COL_INDEX + 1 }, (_, colIndex) => {
        const raw = rawRow[colIndex] ?? "";
        if (meta === "date_header" && colIndex > 0 && colIndex <= 14 && colIndex % 2 === 1) {
          return parseDiaryDate(raw);
        }
        if (
          (meta === "vehicle" || meta === "section_total" || meta === "import_diesel" || meta === "import_petrol") &&
          colIndex > 0 &&
          colIndex < totalColNumber &&
          (raw === "" || raw === null)
        ) {
          return null;
        }
        return raw;
      });

      const row = ws.addRow(values);
      const excelRow = row.number;
      placements.push({ meta, excelRow });

      if (meta === "vehicle") {
        const totalCell = row.getCell(totalColNumber);
        totalCell.value = { formula: totalFormulaForRow(excelRow) };
      }

      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        if (colNumber > totalColNumber) return;
        const isLitCol = litCols.includes(colNumber);
        const isHoursCol = hoursCols.includes(colNumber);
        const isTotalCol = colNumber === totalColNumber;
        applyCellStyle(cell, meta, colNumber, isLitCol, isHoursCol, isTotalCol);

        if (meta === "date_header" && isLitCol) {
          cell.numFmt = "dd/mm/yyyy";
        } else if (typeof cell.value === "number" && meta !== "date_header") {
          cell.numFmt = "#,##0";
        }
      });
    });

    applyLayoutMerges(ws, placements);
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
