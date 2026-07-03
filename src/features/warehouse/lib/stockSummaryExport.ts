import * as XLSX from "xlsx";

import {
  fetchStockSummaryPage,
  type StockSummaryRow,
} from "@/features/warehouse/api/stockSummaryApi";
import type { ProjectListGoogleSheetExportPayload } from "@/features/project/lib/projectListExport";
import type { ItemCategoryNode } from "@/shared/lib/itemCategoryPath";
import { formatDateTimeDisplayDmyHms } from "@/shared/lib/format/date";
import { formatNumber } from "@/shared/lib/format/number";

export const STOCK_SUMMARY_EXPORT_COLUMN_KEYS = [
  "brand",
  "category",
  "sku_sts",
  "code",
  "name",
  "unit",
  "country",
  "on_hand",
  "last_update",
] as const;

export type StockSummaryExportColumnKey =
  (typeof STOCK_SUMMARY_EXPORT_COLUMN_KEYS)[number];

export const STOCK_SUMMARY_EXPORT_DEFAULT_SELECTED_KEYS: readonly StockSummaryExportColumnKey[] =
  ["brand", "category", "sku_sts", "name", "country", "on_hand"];

const DEFAULT_SELECTED_SET = new Set<string>(STOCK_SUMMARY_EXPORT_DEFAULT_SELECTED_KEYS);

export type StockSummaryExportFilter = {
  countryIds: string[];
  brandIds: string[];
  categoryIds: string[];
  search: string;
};

export type StockSummaryExportResolveContext = {
  codeLabels: {
    th: string;
    my: string;
    myn: string;
    sg: string;
    oldSku: string;
  };
  countryCodeById: Map<string, string>;
  categories: ItemCategoryNode[];
};

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number" && !Number.isFinite(value)) return "";
  return String(value).trim();
}

function collectCategoryDescendantIdsForRoot(
  categoryId: string,
  categories: ItemCategoryNode[],
): number[] {
  const rootId = Number(categoryId);
  if (!Number.isFinite(rootId) || rootId <= 0) return [];

  const childrenByParent = new Map<number, number[]>();
  for (const cat of categories) {
    const id = Number(cat.id);
    const parentId = Number(cat.parent_id ?? 0);
    if (!Number.isFinite(id) || id <= 0) continue;
    if (!Number.isFinite(parentId) || parentId <= 0) continue;
    const list = childrenByParent.get(parentId) ?? [];
    list.push(id);
    childrenByParent.set(parentId, list);
  }

  const ids: number[] = [];
  const stack = [rootId];
  const seen = new Set<number>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    ids.push(current);
    for (const childId of childrenByParent.get(current) ?? []) {
      stack.push(childId);
    }
  }

  return ids;
}

function collectCategoryDescendantIds(
  categoryIds: string[],
  categories: ItemCategoryNode[],
): string {
  const allIds = new Set<number>();
  for (const categoryId of categoryIds) {
    for (const id of collectCategoryDescendantIdsForRoot(categoryId, categories)) {
      allIds.add(id);
    }
  }
  return [...allIds].join(",");
}

function buildCodeExportValue(
  row: StockSummaryRow,
  codeLabels: StockSummaryExportResolveContext["codeLabels"],
): string {
  const lines: string[] = [];
  const base = cellText(row.commodity_code);
  if (base) lines.push(base);
  if (cellText(row.thai_code)) lines.push(`${codeLabels.th}: ${cellText(row.thai_code)}`);
  if (cellText(row.malaysia_code)) lines.push(`${codeLabels.my}: ${cellText(row.malaysia_code)}`);
  if (cellText(row.myanmar_code)) lines.push(`${codeLabels.myn}: ${cellText(row.myanmar_code)}`);
  if (cellText(row.singapore_code)) lines.push(`${codeLabels.sg}: ${cellText(row.singapore_code)}`);
  if (cellText(row.old_sku)) lines.push(`${codeLabels.oldSku}: ${cellText(row.old_sku)}`);
  return lines.join("\n");
}

export function resolveStockSummaryExportCellValue(
  column: string,
  row: StockSummaryRow,
  context: StockSummaryExportResolveContext,
): string {
  switch (column) {
    case "brand":
      return cellText(row.brand_name);
    case "category":
      return cellText(row.category_title);
    case "sku_sts":
      return cellText(row.sku_sts);
    case "code":
      return buildCodeExportValue(row, context.codeLabels);
    case "name":
      return cellText(row.commodity_name);
    case "unit":
      return cellText(row.unit_name);
    case "country":
      return cellText(row.country_code);
    case "on_hand":
      return formatNumber(num(row.on_hand));
    case "last_update":
      return formatDateTimeDisplayDmyHms(row.last_update);
    default:
      return "";
  }
}

function applyClientFilters(
  data: StockSummaryRow[],
  filter: StockSummaryExportFilter,
  context: StockSummaryExportResolveContext,
): StockSummaryRow[] {
  const selectedCountryCodeSet = new Set<string>();
  for (const id of filter.countryIds) {
    const code = context.countryCodeById.get(id);
    if (code) selectedCountryCodeSet.add(code);
  }
  const selectedBrandIdSet = new Set(filter.brandIds);

  return data.filter((row) => {
    if (filter.countryIds.length > 1) {
      const code = cellText(row.country_code).toUpperCase();
      if (!code || !selectedCountryCodeSet.has(code)) return false;
    }
    if (filter.brandIds.length > 1) {
      const brandId = String(row.brand_id ?? "");
      if (!brandId || !selectedBrandIdSet.has(brandId)) return false;
    }
    return true;
  });
}

function buildApiParams(
  filter: StockSummaryExportFilter,
  context: StockSummaryExportResolveContext,
  page: number,
  perPage: number,
) {
  const categoryId =
    filter.categoryIds.length > 0 && context.categories.length > 0
      ? collectCategoryDescendantIds(filter.categoryIds, context.categories)
      : undefined;

  return {
    country_id: filter.countryIds.length === 1 ? filter.countryIds[0] : undefined,
    brand_id: filter.brandIds.length === 1 ? filter.brandIds[0] : undefined,
    category_id: categoryId || undefined,
    search: filter.search.trim() || undefined,
    page,
    per_page: perPage,
  };
}

export async function buildStockSummaryExportRows(
  filter: StockSummaryExportFilter,
  context: StockSummaryExportResolveContext,
): Promise<StockSummaryRow[]> {
  const perPage = 200;
  const maxPages = 100;
  let page = 1;
  let allRows: StockSummaryRow[] = [];
  let totalRecords: number | null = null;

  for (;;) {
    const result = await fetchStockSummaryPage(buildApiParams(filter, context, page, perPage));
    if (totalRecords == null && result.totalRecords != null) {
      totalRecords = result.totalRecords;
    }
    if (result.rows.length === 0) break;
    allRows = allRows.concat(result.rows);
    const hasMore =
      totalRecords != null ? allRows.length < totalRecords : result.rows.length >= perPage;
    if (!hasMore) break;
    page += 1;
    if (page > maxPages) break;
  }

  return applyClientFilters(allRows, filter, context);
}

export function discoverStockSummaryExportColumns(): StockSummaryExportColumnKey[] {
  return [...STOCK_SUMMARY_EXPORT_COLUMN_KEYS];
}

export function defaultSelectedStockSummaryExportColumns(
  columns: readonly string[],
): Record<string, boolean> {
  const selected: Record<string, boolean> = {};
  for (const col of columns) {
    selected[col] = DEFAULT_SELECTED_SET.has(col);
  }
  return selected;
}

export function stockSummaryExportColumnLabel(
  t: (key: string) => string,
  column: string,
): string {
  return t(`exportCol_${column}`);
}

export function buildStockSummaryExportFileName(format: "csv" | "xlsx"): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `stock-summary-export-${stamp}.${format}`;
}

function buildExportMatrix(
  rows: StockSummaryRow[],
  selectedColumns: string[],
  columnLabel: (key: string) => string,
  context: StockSummaryExportResolveContext,
): { headers: string[]; body: string[][] } {
  const headers = selectedColumns.map(columnLabel);
  const body = rows.map((row) =>
    selectedColumns.map((col) => resolveStockSummaryExportCellValue(col, row, context)),
  );
  return { headers, body };
}

export function exportStockSummaryRowsToCsv(opts: {
  rows: StockSummaryRow[];
  selectedColumns: string[];
  fileName: string;
  columnLabel: (key: string) => string;
  resolveContext: StockSummaryExportResolveContext;
}): void {
  const { rows, selectedColumns, fileName, columnLabel, resolveContext } = opts;
  if (rows.length === 0 || selectedColumns.length === 0) return;

  const escapeCsv = (value: string) => {
    if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
    return value;
  };

  const { headers, body } = buildExportMatrix(
    rows,
    selectedColumns,
    columnLabel,
    resolveContext,
  );
  const lines = [
    headers.map((header) => escapeCsv(header)).join(","),
    ...body.map((row) => row.map((cell) => escapeCsv(cell)).join(",")),
  ];
  const csv = `\uFEFF${lines.join("\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportStockSummaryRowsToXlsx(opts: {
  rows: StockSummaryRow[];
  selectedColumns: string[];
  fileName: string;
  columnLabel: (key: string) => string;
  resolveContext: StockSummaryExportResolveContext;
}): void {
  const { rows, selectedColumns, fileName, columnLabel, resolveContext } = opts;
  if (rows.length === 0 || selectedColumns.length === 0) return;

  const { headers, body } = buildExportMatrix(
    rows,
    selectedColumns,
    columnLabel,
    resolveContext,
  );
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...body]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Stock Summary");
  XLSX.writeFile(workbook, fileName);
}

export async function exportStockSummaryRowsToGoogleSheet(opts: {
  rows: StockSummaryRow[];
  selectedColumns: string[];
  columnLabel: (key: string) => string;
  resolveContext: StockSummaryExportResolveContext;
}): Promise<{
  ok: boolean;
  message?: string;
  needsAuth?: boolean;
  authorizePath?: string;
  spreadsheetUrl?: string;
}> {
  const { rows, selectedColumns } = opts;
  if (rows.length === 0 || selectedColumns.length === 0) {
    return { ok: false, message: "No rows to export." };
  }

  const { headers, body } = buildExportMatrix(
    rows,
    selectedColumns,
    opts.columnLabel,
    opts.resolveContext,
  );

  const payload: ProjectListGoogleSheetExportPayload = {
    headers,
    rows: body,
    sheetTabName: "Stock Summary",
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
      message:
        data.message ??
        `Google Sheet export failed (${res.status}). See projectListGoogleSheetConfig.ts.`,
    };
  }
  return {
    ok: true,
    message: data.message,
    spreadsheetUrl: data.spreadsheetUrl,
  };
}
