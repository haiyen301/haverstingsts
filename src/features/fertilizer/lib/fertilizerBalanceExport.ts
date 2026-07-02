import ExcelJS from "exceljs";

import {
  FERTILIZER_BALANCE_COLORS,
  FERTILIZER_BALANCE_COMPANY,
} from "@/features/fertilizer/lib/fertilizerBalanceColors";
import {
  formatBalanceQty,
  type FertilizerBalanceSheetModel,
} from "@/features/fertilizer/lib/fertilizerBalanceSheetData";
import {
  fertilizerBalanceBundleExportFileName,
  fertilizerBalanceExportFileName,
  fertilizerBalanceSheetTabName,
  resolveFertilizerBalanceExportFileName,
  type FertilizerBalanceYearMonth,
} from "@/features/fertilizer/lib/fertilizerBalanceWeeks";
import type {
  GoogleSheetCellFill,
  GoogleSheetMergeRange,
} from "@/features/project/lib/projectListExport";

export type FertilizerBalanceExportFarm = {
  farmId: number;
  farmName: string;
};

export type FertilizerBalanceExportFilter = {
  farms: FertilizerBalanceExportFarm[];
  fromYear: number;
  fromMonth: number;
  toYear: number;
  toMonth: number;
};

function argb(hex: string): string {
  const h = hex.replace("#", "").toUpperCase();
  return h.length === 6 ? `FF${h}` : h;
}

function thinBorder(): Partial<ExcelJS.Borders> {
  const side: Partial<ExcelJS.Border> = { style: "thin", color: { argb: argb(FERTILIZER_BALANCE_COLORS.border) } };
  return { top: side, left: side, bottom: side, right: side };
}

function fillSolid(hex: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb: argb(hex) } };
}

function styleHeaderCell(
  cell: ExcelJS.Cell,
  opts: { bg?: string; color?: string; bold?: boolean; wrap?: boolean },
): void {
  cell.border = thinBorder();
  cell.alignment = { vertical: "middle", horizontal: "center", wrapText: opts.wrap ?? true };
  cell.font = {
    bold: opts.bold ?? true,
    size: 10,
    color: opts.color ? { argb: argb(opts.color) } : undefined,
  };
  if (opts.bg) cell.fill = fillSolid(opts.bg);
}

function styleDataCell(cell: ExcelJS.Cell, opts?: { bg?: string; color?: string }): void {
  cell.border = thinBorder();
  cell.alignment = { vertical: "middle", horizontal: "center" };
  cell.font = {
    size: 10,
    color: opts?.color ? { argb: argb(opts.color) } : undefined,
  };
  if (opts?.bg) cell.fill = fillSolid(opts.bg);
}

function inventoryEndDateLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

/** Column letters A..AC (29 cols) for the balance layout. */
const COL = {
  no: 1,
  itemCode: 2,
  description: 3,
  unit: 4,
  open: 5,
  wk1Import: 6,
  wk1Transfer: 7,
  wk1Consump: 8,
  wk1Balance: 9,
  wk2Import: 10,
  wk2Transfer: 11,
  wk2Consump: 12,
  wk2Balance: 13,
  wk3Import: 14,
  wk3Transfer: 15,
  wk3Consump: 16,
  wk3Balance: 17,
  wk4Import: 18,
  wk4Transfer: 19,
  wk4Consump: 20,
  wk4Balance: 21,
  monthImport: 22,
  monthTransfer: 23,
  monthConsump: 24,
  invName: 27,
  invUnit: 28,
  invQty: 29,
} as const;

function weekImportCol(weekIndex: number): number {
  return COL.wk1Import + (weekIndex - 1) * 4;
}

export function buildFertilizerBalanceGoogleSheetPayload(model: FertilizerBalanceSheetModel): {
  headers: string[];
  rows: string[][];
  sheetTabName: string;
  mergeRanges: GoogleSheetMergeRange[];
  cellFills: GoogleSheetCellFill[];
} {
  const matrix: string[][] = [];
  const mergeRanges: GoogleSheetMergeRange[] = [];
  const cellFills: GoogleSheetCellFill[] = [];

  const pushFill = (row: number, col: number, hex: string) => {
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    cellFills.push({
      startRowIndex: row,
      endRowIndex: row + 1,
      startColumnIndex: col,
      endColumnIndex: col + 1,
      red: r,
      green: g,
      blue: b,
    });
  };

  const blank = () => Array(29).fill("");
  const r1 = blank();
  r1[2] = FERTILIZER_BALANCE_COMPANY.name;
  matrix.push(r1);
  const r2 = blank();
  r2[2] = FERTILIZER_BALANCE_COMPANY.address1;
  matrix.push(r2);
  const r3 = blank();
  r3[2] = FERTILIZER_BALANCE_COMPANY.address2;
  matrix.push(r3);
  const r4 = blank();
  r4[2] = FERTILIZER_BALANCE_COMPANY.taxCode;
  matrix.push(r4);

  const r5 = blank();
  r5[0] = "BIÊN BẢN SẢN LƯỢNG PHÂN/HOÁ CHẤT CÒN LẠI TRONG KHO";
  matrix.push(r5);
  mergeRanges.push({ startRowIndex: 4, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 29 });
  for (let c = 0; c < 29; c += 1) pushFill(4, c, FERTILIZER_BALANCE_COLORS.titleBg);

  const r6 = blank();
  r6[0] = "MINUTES OF MONTHLYN FERTILIZER/CHEMICALS BALANCE IN STOCK";
  matrix.push(r6);
  mergeRanges.push({ startRowIndex: 5, endRowIndex: 6, startColumnIndex: 0, endColumnIndex: 29 });

  const r7 = blank();
  r7[0] = "No";
  r7[1] = "Item Code";
  r7[2] = "Description";
  r7[3] = "Unit";
  r7[4] = "OPEN ";
  model.weekLabels.forEach((label, i) => {
    r7[weekImportCol(i + 1) - 1] = label;
  });
  r7[21] = "Tổng sử dụng/tháng";
  r7[26] = `Số lượng còn trong kho ${inventoryEndDateLabel(model.monthEndYmd)}`;
  matrix.push(r7);
  mergeRanges.push({ startRowIndex: 6, endRowIndex: 7, startColumnIndex: 0, endColumnIndex: 1 });
  mergeRanges.push({ startRowIndex: 6, endRowIndex: 7, startColumnIndex: 2, endColumnIndex: 3 });
  mergeRanges.push({ startRowIndex: 6, endRowIndex: 7, startColumnIndex: 3, endColumnIndex: 4 });
  mergeRanges.push({ startRowIndex: 6, endRowIndex: 7, startColumnIndex: 4, endColumnIndex: 5 });
  for (let w = 0; w < 4; w += 1) {
    mergeRanges.push({
      startRowIndex: 6,
      endRowIndex: 7,
      startColumnIndex: weekImportCol(w + 1) - 1,
      endColumnIndex: weekImportCol(w + 1) + 3,
    });
  }
  mergeRanges.push({ startRowIndex: 6, endRowIndex: 7, startColumnIndex: 21, endColumnIndex: 24 });
  mergeRanges.push({ startRowIndex: 6, endRowIndex: 7, startColumnIndex: 26, endColumnIndex: 29 });
  pushFill(6, 21, FERTILIZER_BALANCE_COLORS.monthTotalHeader);
  pushFill(6, 26, FERTILIZER_BALANCE_COLORS.monthTotalHeader);

  const r8 = blank();
  r8[1] = "Mã vật tư";
  const subHeaders = ["Import", "Transfer", "Consump", "Balance"] as const;
  for (let w = 0; w < 4; w += 1) {
    const base = weekImportCol(w + 1) - 1;
    subHeaders.forEach((label, j) => {
      r8[base + j] = label;
    });
  }
  r8[21] = "Import";
  r8[22] = "Transfer";
  r8[23] = "Consump";
  matrix.push(r8);

  function productHasInventory(product: FertilizerBalanceSheetModel["productRows"][number]): boolean {
    return (
      product.monthEndBalance !== 0 ||
      product.open !== 0 ||
      product.monthTotal.import !== 0 ||
      product.monthTotal.transfer !== 0 ||
      product.monthTotal.consumption !== 0
    );
  }

  for (let i = 0; i < model.productRows.length; i += 1) {
    const row = blank();
    const product = model.productRows[i];
    if (product) {
      row[0] = String(i + 1);
      row[1] = product.itemCode;
      row[2] = product.description;
      row[3] = product.unit;
      row[4] = formatBalanceQty(product.open);
      product.weeks.forEach((wk, wIdx) => {
        const base = weekImportCol(wIdx + 1) - 1;
        row[base] = formatBalanceQty(wk.import);
        row[base + 1] = formatBalanceQty(wk.transfer);
        row[base + 2] = formatBalanceQty(wk.consumption);
        row[base + 3] = formatBalanceQty(wk.balance);
      });
      row[21] = formatBalanceQty(product.monthTotal.import);
      row[22] = formatBalanceQty(product.monthTotal.transfer);
      row[23] = formatBalanceQty(product.monthTotal.consumption);
      if (productHasInventory(product)) {
        row[26] = product.description;
        row[27] = product.unit;
        row[28] = formatBalanceQty(product.monthEndBalance);
      }
    }
    matrix.push(row);
  }

  return {
    headers: [],
    rows: matrix,
    sheetTabName: fertilizerBalanceSheetTabName(model.farmName, model.year, model.month),
    mergeRanges,
    cellFills,
  };
}

function uniqueSheetTitle(base: string, used: Set<string>): string {
  let title = base.slice(0, 31);
  if (!used.has(title)) {
    used.add(title);
    return title;
  }
  let i = 2;
  while (i < 100) {
    const suffix = ` (${i})`;
    title = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    if (!used.has(title)) {
      used.add(title);
      return title;
    }
    i += 1;
  }
  used.add(title);
  return title;
}

function fillFertilizerBalanceWorksheet(
  ws: ExcelJS.Worksheet,
  model: FertilizerBalanceSheetModel,
): void {
  ws.getColumn(COL.no).width = 5;
  ws.getColumn(COL.itemCode).width = 12;
  ws.getColumn(COL.description).width = 22;
  ws.getColumn(COL.unit).width = 6;
  ws.getColumn(COL.open).width = 8;
  for (let c = COL.wk1Import; c <= COL.wk4Balance; c += 1) ws.getColumn(c).width = 9;
  ws.getColumn(COL.monthImport).width = 9;
  ws.getColumn(COL.monthTransfer).width = 9;
  ws.getColumn(COL.monthConsump).width = 9;
  ws.getColumn(COL.invName).width = 20;
  ws.getColumn(COL.invUnit).width = 6;
  ws.getColumn(COL.invQty).width = 10;

  ws.getCell(1, 3).value = FERTILIZER_BALANCE_COMPANY.name;
  ws.getCell(2, 3).value = FERTILIZER_BALANCE_COMPANY.address1;
  ws.getCell(3, 3).value = FERTILIZER_BALANCE_COMPANY.address2;
  ws.getCell(4, 3).value = FERTILIZER_BALANCE_COMPANY.taxCode;

  ws.mergeCells(5, 1, 5, 29);
  const titleCell = ws.getCell(5, 1);
  titleCell.value = "BIÊN BẢN SẢN LƯỢNG PHÂN/HOÁ CHẤT CÒN LẠI TRONG KHO";
  styleHeaderCell(titleCell, { bg: FERTILIZER_BALANCE_COLORS.titleBg, bold: true });
  for (let c = 1; c <= 29; c += 1) {
    if (c > 1) styleHeaderCell(ws.getCell(5, c), { bg: FERTILIZER_BALANCE_COLORS.titleBg });
  }

  ws.mergeCells(6, 1, 6, 29);
  ws.getCell(6, 1).value = "MINUTES OF MONTHLYN FERTILIZER/CHEMICALS BALANCE IN STOCK";
  styleHeaderCell(ws.getCell(6, 1), { bold: true });

  const headerRow = 7;
  const subHeaderRow = 8;
  ws.mergeCells(headerRow, COL.no, subHeaderRow, COL.no);
  ws.mergeCells(headerRow, COL.description, subHeaderRow, COL.description);
  ws.mergeCells(headerRow, COL.unit, subHeaderRow, COL.unit);
  ws.mergeCells(headerRow, COL.open, subHeaderRow, COL.open);

  styleHeaderCell(ws.getCell(headerRow, COL.no), { bold: true });
  styleHeaderCell(ws.getCell(headerRow, COL.itemCode), { bold: true });
  ws.getCell(headerRow, COL.itemCode).value = "Item Code";
  styleHeaderCell(ws.getCell(subHeaderRow, COL.itemCode), { bold: true });
  ws.getCell(subHeaderRow, COL.itemCode).value = "Mã vật tư";
  styleHeaderCell(ws.getCell(headerRow, COL.description), { bold: true });
  ws.getCell(headerRow, COL.description).value = "Description";
  styleHeaderCell(ws.getCell(headerRow, COL.unit), { bold: true });
  ws.getCell(headerRow, COL.unit).value = "Unit";
  styleHeaderCell(ws.getCell(headerRow, COL.open), { bold: true });
  ws.getCell(headerRow, COL.open).value = "OPEN ";

  for (let w = 0; w < 4; w += 1) {
    const importCol = weekImportCol(w + 1);
    ws.mergeCells(headerRow, importCol, headerRow, importCol + 3);
    styleHeaderCell(ws.getCell(headerRow, importCol), { bold: true, wrap: true });
    ws.getCell(headerRow, importCol).value = model.weekLabels[w] ?? "";

    const subs: Array<{ col: number; bg: string; color?: string; label: string }> = [
      { col: importCol, bg: FERTILIZER_BALANCE_COLORS.importHeader, label: "Import" },
      { col: importCol + 1, bg: FERTILIZER_BALANCE_COLORS.transferHeader, label: "Transfer" },
      {
        col: importCol + 2,
        bg: FERTILIZER_BALANCE_COLORS.consumpHeader,
        color: FERTILIZER_BALANCE_COLORS.headerTextOnRed,
        label: "Consump",
      },
      { col: importCol + 3, bg: FERTILIZER_BALANCE_COLORS.balanceHeader, label: "Balance" },
    ];
    for (const sub of subs) {
      const cell = ws.getCell(subHeaderRow, sub.col);
      cell.value = sub.label;
      styleHeaderCell(cell, { bg: sub.bg, color: sub.color, bold: true });
    }
  }

  ws.mergeCells(headerRow, COL.monthImport, headerRow, COL.monthConsump);
  ws.mergeCells(headerRow, COL.invName, headerRow, COL.invQty);
  const monthTotalCell = ws.getCell(headerRow, COL.monthImport);
  monthTotalCell.value = "Tổng sử dụng/tháng";
  styleHeaderCell(monthTotalCell, { bg: FERTILIZER_BALANCE_COLORS.monthTotalHeader, bold: true });
  const invHeaderCell = ws.getCell(headerRow, COL.invName);
  invHeaderCell.value = `Số lượng còn trong kho ${inventoryEndDateLabel(model.monthEndYmd)}`;
  styleHeaderCell(invHeaderCell, { bg: FERTILIZER_BALANCE_COLORS.monthTotalHeader, bold: true });

  const monthSubs: Array<{ col: number; bg: string; color?: string; label: string }> = [
    { col: COL.monthImport, bg: FERTILIZER_BALANCE_COLORS.importHeader, label: "Import" },
    { col: COL.monthTransfer, bg: FERTILIZER_BALANCE_COLORS.transferHeader, label: "Transfer" },
    {
      col: COL.monthConsump,
      bg: FERTILIZER_BALANCE_COLORS.consumpHeader,
      color: FERTILIZER_BALANCE_COLORS.headerTextOnRed,
      label: "Consump",
    },
  ];
  for (const sub of monthSubs) {
    const cell = ws.getCell(subHeaderRow, sub.col);
    cell.value = sub.label;
    styleHeaderCell(cell, { bg: sub.bg, color: sub.color, bold: true });
  }

  const productHasInventory = (
    product: FertilizerBalanceSheetModel["productRows"][number],
  ): boolean =>
    product.monthEndBalance !== 0 ||
    product.open !== 0 ||
    product.monthTotal.import !== 0 ||
    product.monthTotal.transfer !== 0 ||
    product.monthTotal.consumption !== 0;

  for (let i = 0; i < model.productRows.length; i += 1) {
    const excelRow = subHeaderRow + 1 + i;
    const product = model.productRows[i];

    if (product) {
      styleDataCell(ws.getCell(excelRow, COL.no));
      ws.getCell(excelRow, COL.no).value = i + 1;
      styleDataCell(ws.getCell(excelRow, COL.itemCode));
      ws.getCell(excelRow, COL.itemCode).value = product.itemCode;
      styleDataCell(ws.getCell(excelRow, COL.description));
      ws.getCell(excelRow, COL.description).value = product.description;
      styleDataCell(ws.getCell(excelRow, COL.unit));
      ws.getCell(excelRow, COL.unit).value = product.unit;
      styleDataCell(ws.getCell(excelRow, COL.open), { bg: FERTILIZER_BALANCE_COLORS.openCell });
      ws.getCell(excelRow, COL.open).value = Number(formatBalanceQty(product.open));

      product.weeks.forEach((wk, wIdx) => {
        const importCol = weekImportCol(wIdx + 1);
        const vals = [wk.import, wk.transfer, wk.consumption, wk.balance];
        vals.forEach((v, j) => {
          styleDataCell(ws.getCell(excelRow, importCol + j));
          ws.getCell(excelRow, importCol + j).value = Number(formatBalanceQty(v));
        });
      });

      styleDataCell(ws.getCell(excelRow, COL.monthImport));
      ws.getCell(excelRow, COL.monthImport).value = Number(formatBalanceQty(product.monthTotal.import));
      styleDataCell(ws.getCell(excelRow, COL.monthTransfer));
      ws.getCell(excelRow, COL.monthTransfer).value = Number(formatBalanceQty(product.monthTotal.transfer));
      styleDataCell(ws.getCell(excelRow, COL.monthConsump));
      ws.getCell(excelRow, COL.monthConsump).value = Number(
        formatBalanceQty(product.monthTotal.consumption),
      );

      if (productHasInventory(product)) {
        styleDataCell(ws.getCell(excelRow, COL.invName));
        ws.getCell(excelRow, COL.invName).value = product.description;
        styleDataCell(ws.getCell(excelRow, COL.invUnit));
        ws.getCell(excelRow, COL.invUnit).value = product.unit;
        styleDataCell(ws.getCell(excelRow, COL.invQty), {
          color: FERTILIZER_BALANCE_COLORS.inventoryQtyText,
        });
        ws.getCell(excelRow, COL.invQty).value = Number(formatBalanceQty(product.monthEndBalance));
      }
    }
  }
}

function uniqueFarmNamesFromModels(models: FertilizerBalanceSheetModel[]): string[] {
  return [...new Set(models.map((m) => m.farmName))];
}

function periodRangeFromModels(
  models: FertilizerBalanceSheetModel[],
): { from: FertilizerBalanceYearMonth; to: FertilizerBalanceYearMonth } {
  const sorted = [...models].sort(
    (a, b) => a.year * 12 + a.month - (b.year * 12 + b.month),
  );
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  return {
    from: { year: first.year, month: first.month },
    to: { year: last.year, month: last.month },
  };
}

export async function exportFertilizerBalanceModelsToXlsx(
  models: FertilizerBalanceSheetModel[],
  fileName?: string,
): Promise<void> {
  if (models.length === 0) return;
  const wb = new ExcelJS.Workbook();
  const usedTitles = new Set<string>();
  for (const model of models) {
    const tab = uniqueSheetTitle(
      fertilizerBalanceSheetTabName(model.farmName, model.year, model.month),
      usedTitles,
    );
    const ws = wb.addWorksheet(tab);
    fillFertilizerBalanceWorksheet(ws, model);
  }

  const range = periodRangeFromModels(models);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download =
    fileName ??
    resolveFertilizerBalanceExportFileName(
      uniqueFarmNamesFromModels(models),
      range.from,
      range.to,
      "xlsx",
    );
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportFertilizerBalanceToXlsx(
  model: FertilizerBalanceSheetModel,
  fileName?: string,
): Promise<void> {
  await exportFertilizerBalanceModelsToXlsx([model], fileName);
}

function downloadCsvBlob(csv: string, name: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportFertilizerBalanceModelsToCsv(
  models: FertilizerBalanceSheetModel[],
  fileName?: string,
): void {
  if (models.length === 0) return;

  if (models.length === 1) {
    exportFertilizerBalanceToCsv(models[0]!, fileName);
    return;
  }

  models.forEach((model, index) => {
    const payload = buildFertilizerBalanceGoogleSheetPayload(model);
    const escapeCsv = (v: string) => {
      if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
      return v;
    };
    const lines = payload.rows.map((row) => row.map(escapeCsv).join(","));
    const csv = `\uFEFF${lines.join("\n")}`;
    const perFileName = fertilizerBalanceExportFileName(
      model.farmName,
      model.year,
      model.month,
      "csv",
    );
    window.setTimeout(() => downloadCsvBlob(csv, perFileName), index * 350);
  });
}

export function exportFertilizerBalanceToCsv(
  model: FertilizerBalanceSheetModel,
  fileName?: string,
): void {
  const payload = buildFertilizerBalanceGoogleSheetPayload(model);
  const escapeCsv = (v: string) => {
    if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  };
  const lines = payload.rows.map((row) => row.map(escapeCsv).join(","));
  const csv = `\uFEFF${lines.join("\n")}`;
  downloadCsvBlob(
    csv,
    fileName ?? fertilizerBalanceExportFileName(model.farmName, model.year, model.month, "csv"),
  );
}

export async function exportFertilizerBalanceModelsToGoogleSheet(
  models: FertilizerBalanceSheetModel[],
): Promise<{
  ok: boolean;
  message?: string;
  needsAuth?: boolean;
  authorizePath?: string;
  spreadsheetUrl?: string;
}> {
  if (models.length === 0) {
    return { ok: false, message: "No farms selected." };
  }

  const tabs = models.map((model) => {
    const payload = buildFertilizerBalanceGoogleSheetPayload(model);
    return {
      sheetTabName: payload.sheetTabName ?? fertilizerBalanceSheetTabName(model.farmName, model.year, model.month),
      headers: payload.headers,
      rows: payload.rows,
    };
  });

  const first = models[0]!;
  const firstPayload = buildFertilizerBalanceGoogleSheetPayload(first);
  const range = periodRangeFromModels(models);
  const uniqueFarms = uniqueFarmNamesFromModels(models);
  const spreadsheetTitle = resolveFertilizerBalanceExportFileName(
    uniqueFarms,
    range.from,
    range.to,
    "xlsx",
  ).replace(/\.xlsx$/, "");

  const res = await fetch("/api/projects/export/google-sheet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      headers: firstPayload.headers,
      rows: firstPayload.rows,
      sheetTabName: tabs[0]?.sheetTabName,
      spreadsheetTitle,
      tabs,
      mergeRanges: models.length === 1 ? firstPayload.mergeRanges : undefined,
      cellFills: models.length === 1 ? firstPayload.cellFills : undefined,
    }),
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
  return { ok: true, message: data.message, spreadsheetUrl: data.spreadsheetUrl };
}

export async function exportFertilizerBalanceToGoogleSheet(
  model: FertilizerBalanceSheetModel,
): Promise<{
  ok: boolean;
  message?: string;
  needsAuth?: boolean;
  authorizePath?: string;
  spreadsheetUrl?: string;
}> {
  return exportFertilizerBalanceModelsToGoogleSheet([model]);
}

export {
  fertilizerBalanceExportFileName,
  fertilizerBalanceBundleExportFileName,
  resolveFertilizerBalanceExportFileName,
};
