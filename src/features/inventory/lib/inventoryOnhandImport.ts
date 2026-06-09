import type { WorkSheet } from "xlsx";
import * as XLSX from "xlsx";

export type InventoryImportFileCountry = "vn" | "th";

export type InventoryImportRow = {
  "Sku STS": unknown;
  "On Hand": unknown;
};

export const DEFAULT_COUNTRY_ID: Record<InventoryImportFileCountry, string> = {
  vn: "1",
  th: "2",
};

const VIETNAM_ITEM_CODE_COL = 1; // column B
const THAILAND_SKU_COL = 3; // column D
const THAILAND_QTY_COL = 12; // column M

const THAILAND_SKIP_TOKENS = ["to", "stock code", "group"];

export function normalizeImportHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function findColumnIndex(headerRow: (string | undefined)[], candidates: string[]): number {
  for (const candidate of candidates) {
    const index = headerRow.findIndex((headerCell) => {
      return normalizeImportHeader(String(headerCell ?? "")) === candidate;
    });
    if (index >= 0) return index;
  }
  return -1;
}

function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number" && !Number.isFinite(value)) return "";
  return String(value).trim();
}

function containsThailandSkipToken(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return THAILAND_SKIP_TOKENS.some((token) => normalized === token || normalized.includes(token));
}

export function shouldSkipThailandInventoryRow(skuValue: unknown): boolean {
  const sku = cellText(skuValue);
  if (!sku) return true;
  return containsThailandSkipToken(sku);
}

export function inventoryImportMissingColumnsMessage(
  fileCountry: InventoryImportFileCountry,
): { skuLabel: string; quantityLabel: string } {
  if (fileCountry === "th") {
    return { skuLabel: "D", quantityLabel: "M" };
  }
  return { skuLabel: "Alias", quantityLabel: "Item in stock" };
}

function parseVietnamInventorySheet(sheet: WorkSheet, range: XLSX.Range): InventoryImportRow[] {
  const headerRow = XLSX.utils.sheet_to_json<(string | undefined)[]>(sheet, {
    header: 1,
    range: range.s.r,
    blankrows: false,
  })[0] ?? [];

  const aliasColIndex = findColumnIndex(headerRow, ["alias"]);
  const itemInStockColIndex = findColumnIndex(headerRow, ["iteminstock"]);
  const quantityColIndex = findColumnIndex(headerRow, ["quantity"]);

  const qtyColIndex = itemInStockColIndex >= 0 ? itemInStockColIndex : quantityColIndex;
  if (aliasColIndex < 0 || qtyColIndex < 0) {
    return [];
  }

  const usesItemListFormat = itemInStockColIndex >= 0;
  const rows: InventoryImportRow[] = [];

  for (let r = range.s.r + 1; r <= range.e.r; r += 1) {
    const aliasCell = sheet[XLSX.utils.encode_cell({ r, c: aliasColIndex })];
    const quantityCell = sheet[XLSX.utils.encode_cell({ r, c: qtyColIndex })];

    if (usesItemListFormat) {
      const itemCode = cellText(sheet[XLSX.utils.encode_cell({ r, c: VIETNAM_ITEM_CODE_COL })]?.v);
      if (!itemCode) continue;

      const alias = cellText(aliasCell?.v);
      rows.push({
        "Sku STS": alias || itemCode,
        "On Hand": quantityCell?.v ?? "",
      });
      continue;
    }

    rows.push({
      "Sku STS": aliasCell?.v ?? "",
      "On Hand": quantityCell?.v ?? "",
    });
  }

  return rows;
}

function parseThailandInventorySheet(sheet: WorkSheet, range: XLSX.Range): InventoryImportRow[] {
  const rows: InventoryImportRow[] = [];
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const skuCell = sheet[XLSX.utils.encode_cell({ r, c: THAILAND_SKU_COL })];
    const qtyCell = sheet[XLSX.utils.encode_cell({ r, c: THAILAND_QTY_COL })];
    if (shouldSkipThailandInventoryRow(skuCell?.v)) continue;
    rows.push({
      "Sku STS": skuCell?.v ?? "",
      "On Hand": qtyCell?.v ?? "",
    });
  }
  return rows;
}

export function parseInventoryRawSheet(
  sheet: WorkSheet,
  fileCountry: InventoryImportFileCountry,
): { rows: InventoryImportRow[] } | { error: "invalidSheet" } | { error: "missingColumns" } {
  if (!sheet["!ref"]) {
    return { error: "invalidSheet" };
  }

  const range = XLSX.utils.decode_range(sheet["!ref"]);

  if (fileCountry === "th") {
    const rows = parseThailandInventorySheet(sheet, range);
    if (!rows.length) {
      return { error: "missingColumns" };
    }
    return { rows };
  }

  const rows = parseVietnamInventorySheet(sheet, range);
  if (!rows.length) {
    return { error: "missingColumns" };
  }
  return { rows };
}
