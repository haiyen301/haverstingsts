import ExcelJS from "exceljs";

import {
  FERTILIZER_BALANCE_COLORS,
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
  type FertilizerBalanceWeekBucket,
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

export type FertilizerBalanceSheetLabels = {
  title: string;
  no: string;
  itemCode: string;
  description: string;
  unit: string;
  open: string;
  monthTotal: string;
  /** Use `{date}` for the month-end date (dd/mm/yyyy). */
  inventoryRemaining: string;
  /** Use `{index}`, `{from}`, `{to}` for week bucket labels. */
  weekLabel: string;
  import: string;
  transfer: string;
  consumption: string;
  balance: string;
};

function inventoryEndDateLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

function resolveInventoryRemainingLabel(labels: FertilizerBalanceSheetLabels, monthEndYmd: string): string {
  return labels.inventoryRemaining.replace("{date}", inventoryEndDateLabel(monthEndYmd));
}

function resolveBalanceSheetWeekLabels(
  model: FertilizerBalanceSheetModel,
  labels: FertilizerBalanceSheetLabels,
): string[] {
  return model.weeks.map((bucket: FertilizerBalanceWeekBucket) =>
    labels.weekLabel
      .replace("{index}", String(bucket.index))
      .replace("{from}", `${bucket.startDay}/${model.month}/${model.year}`)
      .replace("{to}", `${bucket.endDay}/${model.month}/${model.year}`),
  );
}

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

export function buildFertilizerBalanceGoogleSheetPayload(
  model: FertilizerBalanceSheetModel,
  labels: FertilizerBalanceSheetLabels,
): {
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
  const weekLabels = resolveBalanceSheetWeekLabels(model, labels);
  const inventoryHeader = resolveInventoryRemainingLabel(labels, model.monthEndYmd);
  const subHeaders = [labels.import, labels.transfer, labels.consumption, labels.balance] as const;

  const r1 = blank();
  r1[0] = labels.title;
  matrix.push(r1);
  mergeRanges.push({ startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 29 });
  for (let c = 0; c < 29; c += 1) pushFill(0, c, FERTILIZER_BALANCE_COLORS.titleBg);

  const r2 = blank();
  r2[0] = labels.no;
  r2[1] = labels.itemCode;
  r2[2] = labels.description;
  r2[3] = labels.unit;
  r2[4] = labels.open;
  weekLabels.forEach((label, i) => {
    r2[weekImportCol(i + 1) - 1] = label;
  });
  r2[21] = labels.monthTotal;
  r2[26] = inventoryHeader;
  matrix.push(r2);
  mergeRanges.push({ startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 1 });
  mergeRanges.push({ startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 2 });
  mergeRanges.push({ startRowIndex: 1, endRowIndex: 2, startColumnIndex: 2, endColumnIndex: 3 });
  mergeRanges.push({ startRowIndex: 1, endRowIndex: 2, startColumnIndex: 3, endColumnIndex: 4 });
  mergeRanges.push({ startRowIndex: 1, endRowIndex: 2, startColumnIndex: 4, endColumnIndex: 5 });
  for (let w = 0; w < 4; w += 1) {
    mergeRanges.push({
      startRowIndex: 1,
      endRowIndex: 2,
      startColumnIndex: weekImportCol(w + 1) - 1,
      endColumnIndex: weekImportCol(w + 1) + 3,
    });
  }
  mergeRanges.push({ startRowIndex: 1, endRowIndex: 2, startColumnIndex: 21, endColumnIndex: 24 });
  mergeRanges.push({ startRowIndex: 1, endRowIndex: 2, startColumnIndex: 26, endColumnIndex: 29 });
  pushFill(1, 21, FERTILIZER_BALANCE_COLORS.monthTotalHeader);
  pushFill(1, 26, FERTILIZER_BALANCE_COLORS.monthTotalHeader);

  const r3 = blank();
  for (let w = 0; w < 4; w += 1) {
    const base = weekImportCol(w + 1) - 1;
    subHeaders.forEach((label, j) => {
      r3[base + j] = label;
    });
  }
  r3[21] = labels.import;
  r3[22] = labels.transfer;
  r3[23] = labels.consumption;
  matrix.push(r3);

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
  labels: FertilizerBalanceSheetLabels,
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

  ws.mergeCells(1, 1, 1, 29);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = labels.title;
  styleHeaderCell(titleCell, { bg: FERTILIZER_BALANCE_COLORS.titleBg, bold: true });
  for (let c = 1; c <= 29; c += 1) {
    if (c > 1) styleHeaderCell(ws.getCell(1, c), { bg: FERTILIZER_BALANCE_COLORS.titleBg });
  }

  const headerRow = 2;
  const subHeaderRow = 3;
  const weekLabels = resolveBalanceSheetWeekLabels(model, labels);
  const inventoryHeader = resolveInventoryRemainingLabel(labels, model.monthEndYmd);
  const subHeaders = [labels.import, labels.transfer, labels.consumption, labels.balance] as const;

  ws.mergeCells(headerRow, COL.no, subHeaderRow, COL.no);
  ws.mergeCells(headerRow, COL.itemCode, subHeaderRow, COL.itemCode);
  ws.mergeCells(headerRow, COL.description, subHeaderRow, COL.description);
  ws.mergeCells(headerRow, COL.unit, subHeaderRow, COL.unit);
  ws.mergeCells(headerRow, COL.open, subHeaderRow, COL.open);

  styleHeaderCell(ws.getCell(headerRow, COL.no), { bold: true });
  ws.getCell(headerRow, COL.no).value = labels.no;
  styleHeaderCell(ws.getCell(headerRow, COL.itemCode), { bold: true });
  ws.getCell(headerRow, COL.itemCode).value = labels.itemCode;
  styleHeaderCell(ws.getCell(headerRow, COL.description), { bold: true });
  ws.getCell(headerRow, COL.description).value = labels.description;
  styleHeaderCell(ws.getCell(headerRow, COL.unit), { bold: true });
  ws.getCell(headerRow, COL.unit).value = labels.unit;
  styleHeaderCell(ws.getCell(headerRow, COL.open), { bold: true });
  ws.getCell(headerRow, COL.open).value = labels.open;

  for (let w = 0; w < 4; w += 1) {
    const importCol = weekImportCol(w + 1);
    ws.mergeCells(headerRow, importCol, headerRow, importCol + 3);
    styleHeaderCell(ws.getCell(headerRow, importCol), { bold: true, wrap: true });
    ws.getCell(headerRow, importCol).value = weekLabels[w] ?? "";

    const subs: Array<{ col: number; bg: string; color?: string; label: string }> = [
      { col: importCol, bg: FERTILIZER_BALANCE_COLORS.importHeader, label: labels.import },
      { col: importCol + 1, bg: FERTILIZER_BALANCE_COLORS.transferHeader, label: labels.transfer },
      {
        col: importCol + 2,
        bg: FERTILIZER_BALANCE_COLORS.consumpHeader,
        color: FERTILIZER_BALANCE_COLORS.headerTextOnRed,
        label: labels.consumption,
      },
      { col: importCol + 3, bg: FERTILIZER_BALANCE_COLORS.balanceHeader, label: labels.balance },
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
  monthTotalCell.value = labels.monthTotal;
  styleHeaderCell(monthTotalCell, { bg: FERTILIZER_BALANCE_COLORS.monthTotalHeader, bold: true });
  const invHeaderCell = ws.getCell(headerRow, COL.invName);
  invHeaderCell.value = inventoryHeader;
  styleHeaderCell(invHeaderCell, { bg: FERTILIZER_BALANCE_COLORS.monthTotalHeader, bold: true });

  const monthSubs: Array<{ col: number; bg: string; color?: string; label: string }> = [
    { col: COL.monthImport, bg: FERTILIZER_BALANCE_COLORS.importHeader, label: labels.import },
    { col: COL.monthTransfer, bg: FERTILIZER_BALANCE_COLORS.transferHeader, label: labels.transfer },
    {
      col: COL.monthConsump,
      bg: FERTILIZER_BALANCE_COLORS.consumpHeader,
      color: FERTILIZER_BALANCE_COLORS.headerTextOnRed,
      label: labels.consumption,
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
  labels: FertilizerBalanceSheetLabels,
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
    fillFertilizerBalanceWorksheet(ws, model, labels);
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
  labels: FertilizerBalanceSheetLabels,
  fileName?: string,
): Promise<void> {
  await exportFertilizerBalanceModelsToXlsx([model], labels, fileName);
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
  labels: FertilizerBalanceSheetLabels,
  fileName?: string,
): void {
  if (models.length === 0) return;

  if (models.length === 1) {
    exportFertilizerBalanceToCsv(models[0]!, labels, fileName);
    return;
  }

  models.forEach((model, index) => {
    const payload = buildFertilizerBalanceGoogleSheetPayload(model, labels);
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
  labels: FertilizerBalanceSheetLabels,
  fileName?: string,
): void {
  const payload = buildFertilizerBalanceGoogleSheetPayload(model, labels);
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
  labels: FertilizerBalanceSheetLabels,
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
    const payload = buildFertilizerBalanceGoogleSheetPayload(model, labels);
    return {
      sheetTabName: payload.sheetTabName ?? fertilizerBalanceSheetTabName(model.farmName, model.year, model.month),
      headers: payload.headers,
      rows: payload.rows,
    };
  });

  const first = models[0]!;
  const firstPayload = buildFertilizerBalanceGoogleSheetPayload(first, labels);
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
  labels: FertilizerBalanceSheetLabels,
): Promise<{
  ok: boolean;
  message?: string;
  needsAuth?: boolean;
  authorizePath?: string;
  spreadsheetUrl?: string;
}> {
  return exportFertilizerBalanceModelsToGoogleSheet([model], labels);
}

export {
  fertilizerBalanceExportFileName,
  fertilizerBalanceBundleExportFileName,
  resolveFertilizerBalanceExportFileName,
};
