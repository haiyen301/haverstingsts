import ExcelJS from "exceljs";

import {
  buildHarvestExportRowGroups,
  buildHarvestExportSheetFormatting,
  HARVEST_EXPORT_GROUP_FILL_COLORS,
  isFirstRowInHarvestExportGroup,
  isHarvestExportClientColumn,
  isHarvestExportShadedProjectColumn,
  resolveHarvestExportGroupKey,
  sortHarvestRowsForProjectGrouping,
} from "@/features/harvest/lib/harvestListExportGrouping";
import {
  buildHarvestListImageProxyPath,
  collectHarvestListExportImageCells,
  filterHarvestListExportColumnsForCsv,
  HARVEST_LIST_EXPORT_IMAGE_COLUMN_KEYS,
  isHarvestListExportImageColumn,
  type HarvestListExportImageCellRef,
} from "@/features/harvest/lib/harvestListExportImages";
import type {
  GoogleSheetCellFill,
  GoogleSheetMergeRange,
} from "@/features/project/lib/projectListExport";
import { fetchProjectDynamicFieldsByProjectId } from "@/entities/projects/api/projectsApi";
import { getGeneralNoteFromRow } from "@/shared/lib/harvestPlanExtendedFields";
import { getAttachmentUrls } from "@/shared/lib/harvestAttachmentImages";
import { formatDateDisplayDmy, isValidDate } from "@/shared/lib/format/date";
import { findProjectRowBySelectId } from "@/shared/lib/harvestReferenceData";
import { stsProxyGetHarvestingIndex } from "@/shared/api/stsProxyClient";

export { HARVEST_LIST_EXPORT_IMAGE_COLUMN_KEYS, type HarvestListExportImageCellRef };

export const HARVEST_LIST_EXPORT_COLUMN_KEYS = [
  "client",
  "grass_type",
  "farm",
  "quantity",
  "uom",
  "actual_harvest_date",
  "delivery_harvest_date",
  "shipment_required_date",
  "general_note",
  ...HARVEST_LIST_EXPORT_IMAGE_COLUMN_KEYS,
] as const;

export type HarvestListExportColumnKey =
  (typeof HARVEST_LIST_EXPORT_COLUMN_KEYS)[number];

export const HARVEST_LIST_EXPORT_DEFAULT_SELECTED_KEYS: readonly HarvestListExportColumnKey[] =
  [
    "client",
    "grass_type",
    "farm",
    "quantity",
    "uom",
    "actual_harvest_date",
    "delivery_harvest_date",
    "shipment_required_date",
    "general_note",
  ];

const DEFAULT_SELECTED_SET = new Set(HARVEST_LIST_EXPORT_DEFAULT_SELECTED_KEYS);
const IMAGE_COLUMN_SET = new Set<string>(HARVEST_LIST_EXPORT_IMAGE_COLUMN_KEYS);

export type HarvestListExportFilter = {
  search: string;
  farmIds: string;
  grassIds: string;
  projectIds: string;
  statusValues: string;
  deliveryHarvestFrom: string;
  deliveryHarvestTo: string;
  userId?: string | number;
  farmUserMeta?: string;
};

export type HarvestListExportResolveContext = {
  /** `sts_projects` catalog (`id`, `alias_title`, `title`). */
  projects: unknown[];
  grasses: unknown[];
  locale?: string;
  /** `project_id` → `company_name` from `sts_dynamic_table_data` (same `id_row`). */
  dynamicCompanyByProjectId?: ReadonlyMap<string, string>;
  /** `project_id` → `sts_projects.title` from harvest list API (`project_name`). */
  projectTitleByProjectId?: ReadonlyMap<string, string>;
};

export type HarvestListExportBuildResult = {
  rows: Array<Record<string, unknown>>;
  resolveContext: HarvestListExportResolveContext;
};

export { filterHarvestListExportColumnsForCsv, isHarvestListExportImageColumn };

/** Map image field → HarvestForm i18n key (same labels as harvest/new photo slots). */
export const HARVEST_LIST_EXPORT_PHOTO_LABEL_KEYS: Record<string, string> = {
  payment_img: "photoSlotPayment",
  shipping_note_img: "photoSlotShipping",
  thermostats_img: "photoSlotThermostat",
  truck_license_plate_img: "photoSlotPlate",
  product_being_cut_img: "photoSlotCutting",
  truck_loaded_img: "photoSlotLoaded",
};

function buildExportApiParams(
  filter: HarvestListExportFilter,
  page: number,
  perPage: number,
): Record<string, string | number | undefined> {
  const params: Record<string, string | number | undefined> = {
    page,
    per_page: perPage,
    user_id: filter.userId,
  };
  if (filter.farmUserMeta) params.farm_user_id = filter.farmUserMeta;
  if (filter.search.trim()) params.search = filter.search.trim();
  if (filter.farmIds.trim()) params.farm_id = filter.farmIds.trim();
  if (filter.grassIds.trim()) params.product_id = filter.grassIds.trim();
  if (filter.projectIds.trim()) params.project_id = filter.projectIds.trim();
  if (filter.statusValues.trim()) params.harvest_status = filter.statusValues.trim();
  if (filter.deliveryHarvestFrom && filter.deliveryHarvestTo) {
    params.delivery_harvest_date_from = filter.deliveryHarvestFrom;
    params.delivery_harvest_date_to = filter.deliveryHarvestTo;
  }
  return params;
}

async function fetchAllHarvestRowsForExport(
  filter: HarvestListExportFilter,
): Promise<Array<Record<string, unknown>>> {
  const perPage = 200;
  const maxPages = 100;
  let page = 1;
  let allRows: Array<Record<string, unknown>> = [];
  let totalRecords: number | null = null;

  for (;;) {
    const res = await stsProxyGetHarvestingIndex(
      buildExportApiParams(filter, page, perPage),
    );
    const list = res.rows
      .filter((r) => r && typeof r === "object")
      .map((r) => r as Record<string, unknown>);
    if (totalRecords == null && res.totalRecords != null) {
      totalRecords = res.totalRecords;
    }
    if (list.length === 0) break;
    allRows = allRows.concat(list);
    const hasMore =
      totalRecords != null
        ? allRows.length < totalRecords
        : list.length >= perPage;
    if (!hasMore) break;
    page += 1;
    if (page > maxPages) break;
  }

  return allRows;
}

function grassLabelById(grasses: unknown[], productId: string): string {
  const pid = String(productId ?? "").trim();
  if (!pid) return "";
  for (const g of grasses) {
    if (!g || typeof g !== "object") continue;
    const rec = g as Record<string, unknown>;
    if (String(rec.id ?? "").trim() !== pid) continue;
    return String(rec.title ?? rec.name ?? "").trim();
  }
  return "";
}

const CLIENT_LABEL_PLACEHOLDER_RE =
  /^(n\/a|na|noname|no\s*name|no_name|none|undefined|null|-+|—+)$/i;

function isMeaningfulClientLabel(v: unknown): boolean {
  const s = String(v ?? "").trim();
  return !!s && !CLIENT_LABEL_PLACEHOLDER_RE.test(s);
}

function findStsProjectById(
  projects: unknown[],
  projectId: string,
): Record<string, unknown> | null {
  return findProjectRowBySelectId(projects, projectId) ?? null;
}

function buildProjectTitleByProjectId(
  rows: Array<Record<string, unknown>>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const projectId = String(row.project_id ?? "").trim();
    const title = String(row.project_name ?? "").trim();
    if (!projectId || !isMeaningfulClientLabel(title)) continue;
    if (!map.has(projectId)) map.set(projectId, title);
  }
  return map;
}

function resolveStsProjectTitle(
  projectId: string,
  catalog: Record<string, unknown> | null,
  row: Record<string, unknown>,
  ctx?: HarvestListExportResolveContext,
): string {
  const fromCatalog = String(catalog?.title ?? catalog?.name ?? "").trim();
  if (isMeaningfulClientLabel(fromCatalog)) return fromCatalog;

  const fromHarvestMap = projectId
    ? String(ctx?.projectTitleByProjectId?.get(projectId) ?? "").trim()
    : "";
  if (isMeaningfulClientLabel(fromHarvestMap)) return fromHarvestMap;

  const fromRow = String(row.project_name ?? "").trim();
  if (isMeaningfulClientLabel(fromRow)) return fromRow;

  return "";
}

function extractCompanyNameFromDynamicFields(
  rows: Array<Record<string, unknown>>,
): string {
  for (const r of rows) {
    const direct = String(r.company_name ?? "").trim();
    if (isMeaningfulClientLabel(direct)) return direct;
    if (String(r.name ?? "").trim().toLowerCase() === "company_name") {
      const v = String(r.value ?? "").trim();
      if (isMeaningfulClientLabel(v)) return v;
    }
  }
  return "";
}

async function loadDynamicCompanyNames(
  projectIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = Array.from(new Set(projectIds.map((x) => x.trim()).filter(Boolean)));
  const batchSize = 8;
  for (let i = 0; i < unique.length; i += batchSize) {
    const chunk = unique.slice(i, i + batchSize);
    await Promise.all(
      chunk.map(async (projectId) => {
        try {
          const fields = await fetchProjectDynamicFieldsByProjectId(projectId);
          const company = extractCompanyNameFromDynamicFields(fields);
          if (company) map.set(projectId, company);
        } catch {
          // Skip per-project dynamic lookup failures.
        }
      }),
    );
  }
  return map;
}

/**
 * Client label priority:
 * 1. `sts_projects.alias_title`
 * 2. `sts_dynamic_table_data.company_name` (same `id_row` as `project_id` field)
 * 3. `sts_projects.title` (always present)
 */
function resolveExportClientLabel(
  row: Record<string, unknown>,
  ctx?: HarvestListExportResolveContext,
): string {
  const projectId = String(row.project_id ?? "").trim();
  const catalog = projectId
    ? findStsProjectById(ctx?.projects ?? [], projectId)
    : null;

  const alias = String(catalog?.alias_title ?? "").trim();
  if (isMeaningfulClientLabel(alias)) return alias;

  const dynamicCompany = projectId
    ? String(ctx?.dynamicCompanyByProjectId?.get(projectId) ?? "").trim()
    : "";
  if (isMeaningfulClientLabel(dynamicCompany)) return dynamicCompany;

  return resolveStsProjectTitle(projectId, catalog, row, ctx);
}

function projectIdsNeedingDynamicCompanyLookup(
  rows: Array<Record<string, unknown>>,
  projects: unknown[],
): string[] {
  const out = new Set<string>();
  for (const row of rows) {
    const projectId = String(row.project_id ?? "").trim();
    if (!projectId) continue;
    const catalog = findStsProjectById(projects, projectId);
    const alias = String(catalog?.alias_title ?? "").trim();
    if (!isMeaningfulClientLabel(alias)) out.add(projectId);
  }
  return Array.from(out);
}

function formatExportDate(v: unknown, locale?: string): string {
  const s = String(v ?? "").trim();
  if (!isValidDate(s)) return "";
  const formatted = formatDateDisplayDmy(s);
  return formatted === "-" ? "" : formatted;
}

export async function buildHarvestListExportRows(
  filter: HarvestListExportFilter,
  ctx: HarvestListExportResolveContext,
): Promise<HarvestListExportBuildResult> {
  const rows = await fetchAllHarvestRowsForExport(filter);
  rows.sort((a, b) => {
    const ad = formatExportDate(a.actual_harvest_date);
    const bd = formatExportDate(b.actual_harvest_date);
    if (ad !== bd) return bd.localeCompare(ad);
    return String(b.id ?? "").localeCompare(String(a.id ?? ""));
  });

  const dynamicCompanyByProjectId = await loadDynamicCompanyNames(
    projectIdsNeedingDynamicCompanyLookup(rows, ctx.projects),
  );
  const projectTitleByProjectId = buildProjectTitleByProjectId(rows);

  return {
    rows,
    resolveContext: {
      ...ctx,
      dynamicCompanyByProjectId,
      projectTitleByProjectId,
    },
  };
}

export function discoverHarvestListExportColumns(): string[] {
  return [...HARVEST_LIST_EXPORT_COLUMN_KEYS];
}

export function defaultSelectedHarvestListExportColumns(
  allColumns: string[],
): Record<string, boolean> {
  const selected: Record<string, boolean> = {};
  for (const col of allColumns) {
    selected[col] = DEFAULT_SELECTED_SET.has(col as HarvestListExportColumnKey);
  }
  return selected;
}

export function harvestListExportColumnLabel(
  translateHarvest: (key: string) => string,
  translateHarvestForm: (key: string) => string,
  columnKey: string,
): string {
  const photoKey = HARVEST_LIST_EXPORT_PHOTO_LABEL_KEYS[columnKey];
  if (photoKey) {
    return translateHarvestForm(photoKey);
  }
  return translateHarvest(`exportCol_${columnKey}`);
}

function resolveHarvestListExportCellValue(
  columnKey: string,
  row: Record<string, unknown>,
  ctx?: HarvestListExportResolveContext,
): string | number {
  if (columnKey === "client") {
    return resolveExportClientLabel(row, ctx);
  }
  if (columnKey === "grass_type") {
    const fromRow = String(row.grass_name ?? "").trim();
    if (fromRow) return fromRow;
    return grassLabelById(ctx?.grasses ?? [], String(row.product_id ?? ""));
  }
  if (columnKey === "farm") {
    return String(row.farm_name ?? "").trim();
  }
  if (columnKey === "quantity") {
    const q = Number(row.quantity);
    return Number.isFinite(q) ? q : "";
  }
  if (columnKey === "uom") {
    return String(row.uom ?? "").trim();
  }
  if (columnKey === "actual_harvest_date") {
    return formatExportDate(row.actual_harvest_date, ctx?.locale);
  }
  if (columnKey === "delivery_harvest_date") {
    return formatExportDate(row.delivery_harvest_date, ctx?.locale);
  }
  if (columnKey === "shipment_required_date") {
    return formatExportDate(row.shipment_required_date, ctx?.locale);
  }
  if (columnKey === "general_note") {
    return getGeneralNoteFromRow(row);
  }
  if (IMAGE_COLUMN_SET.has(columnKey)) {
    return getAttachmentUrls(row[columnKey])[0] ?? "";
  }
  return String(row[columnKey] ?? "").trim();
}

function cellToExportString(value: string | number): string {
  if (value == null) return "";
  return String(value);
}

function prepareGroupedHarvestExportRows(
  rows: Array<Record<string, unknown>>,
  selectedColumns: string[],
  resolveContext?: HarvestListExportResolveContext,
): {
  sortedRows: Array<Record<string, unknown>>;
  groups: ReturnType<typeof buildHarvestExportRowGroups>;
} {
  const sortedRows = sortHarvestRowsForProjectGrouping(
    rows,
    resolveContext,
    (row, ctx) =>
      resolveHarvestExportGroupKey(row, ctx, resolveExportClientLabel),
  );
  const groups = buildHarvestExportRowGroups(sortedRows, resolveContext, (row, ctx) =>
    resolveHarvestExportGroupKey(row, ctx, resolveExportClientLabel),
  );
  return { sortedRows, groups };
}

function resolveGroupedHarvestListExportCellValue(
  columnKey: string,
  row: Record<string, unknown>,
  rowIndex: number,
  groups: ReturnType<typeof buildHarvestExportRowGroups>,
  ctx?: HarvestListExportResolveContext,
): string | number {
  if (
    isHarvestExportClientColumn(columnKey) &&
    !isFirstRowInHarvestExportGroup(rowIndex, groups)
  ) {
    return "";
  }
  return resolveHarvestListExportCellValue(columnKey, row, ctx);
}

function applyHarvestExportXlsxProjectGrouping(
  ws: ExcelJS.Worksheet,
  selectedColumns: string[],
  groups: ReturnType<typeof buildHarvestExportRowGroups>,
): void {
  const clientColumnNumber =
    selectedColumns.findIndex((col) => isHarvestExportClientColumn(col)) + 1;
  const shadedColumnNumbers = selectedColumns
    .map((col, idx) => (isHarvestExportShadedProjectColumn(col) ? idx + 1 : -1))
    .filter((idx) => idx >= 0);

  for (const group of groups) {
    const excelStartRow = group.startIndex + 2;
    const excelEndRow = group.endIndex + 2;
    const shade =
      HARVEST_EXPORT_GROUP_FILL_COLORS[group.shadeIndex % 2] ??
      HARVEST_EXPORT_GROUP_FILL_COLORS[0];

    for (const colNumber of shadedColumnNumbers) {
      for (let rowNumber = excelStartRow; rowNumber <= excelEndRow; rowNumber += 1) {
        const cell = ws.getCell(rowNumber, colNumber);
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: shade.argb },
        };
        cell.alignment = { vertical: "middle", wrapText: true };
      }
    }

    if (excelEndRow > excelStartRow && clientColumnNumber > 0) {
      ws.mergeCells(excelStartRow, clientColumnNumber, excelEndRow, clientColumnNumber);
    }
  }
}

export function buildHarvestListExportFileName(format: "csv" | "xlsx"): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `harvests-export-${stamp}.${format}`;
}

export function exportHarvestListRowsToCsv(opts: {
  rows: Array<Record<string, unknown>>;
  selectedColumns: string[];
  fileName: string;
  columnLabel?: (key: string) => string;
  resolveContext?: HarvestListExportResolveContext;
}): void {
  const { rows, fileName, resolveContext } = opts;
  const selectedColumns = filterHarvestListExportColumnsForCsv(opts.selectedColumns);
  if (rows.length === 0 || selectedColumns.length === 0) return;

  const label = opts.columnLabel ?? ((k) => k);
  const escapeCsv = (v: string) => {
    if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  };

  const { sortedRows, groups } = prepareGroupedHarvestExportRows(
    rows,
    selectedColumns,
    resolveContext,
  );

  const header = selectedColumns.map((c) => escapeCsv(label(c))).join(",");
  const lines = sortedRows.map((row, rowIndex) =>
    selectedColumns
      .map((col) =>
        escapeCsv(
          cellToExportString(
            resolveGroupedHarvestListExportCellValue(
              col,
              row,
              rowIndex,
              groups,
              resolveContext,
            ),
          ),
        ),
      )
      .join(","),
  );
  const csv = `\uFEFF${header}\n${lines.join("\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

async function fetchImageBuffer(url: string): Promise<ArrayBuffer | null> {
  const u = url.trim();
  if (!u) return null;
  try {
    const proxyPath = buildHarvestListImageProxyPath(u);
    const res = await fetch(proxyPath, { credentials: "include" });
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

function extensionFromUrl(url: string): "png" | "jpeg" | "gif" {
  const lower = url.toLowerCase();
  if (lower.includes(".png")) return "png";
  if (lower.includes(".gif")) return "gif";
  return "jpeg";
}

export async function exportHarvestListRowsToXlsxWithImages(opts: {
  rows: Array<Record<string, unknown>>;
  selectedColumns: string[];
  fileName: string;
  columnLabel?: (key: string) => string;
  resolveContext?: HarvestListExportResolveContext;
  onProgress?: (message: string) => void;
}): Promise<void> {
  const { rows, selectedColumns, fileName, resolveContext } = opts;
  if (rows.length === 0 || selectedColumns.length === 0) return;

  const label = opts.columnLabel ?? ((k) => k);
  const imageColumnIndexes = selectedColumns
    .map((col, idx) => (IMAGE_COLUMN_SET.has(col) ? idx : -1))
    .filter((idx) => idx >= 0);

  const { sortedRows, groups } = prepareGroupedHarvestExportRows(
    rows,
    selectedColumns,
    resolveContext,
  );

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("harvests");

  ws.addRow(selectedColumns.map(label));

  const imageCache = new Map<string, ArrayBuffer | null>();

  for (let rowIdx = 0; rowIdx < sortedRows.length; rowIdx += 1) {
    const row = sortedRows[rowIdx]!;
    const values = selectedColumns.map((col) => {
      if (IMAGE_COLUMN_SET.has(col)) return "";
      return resolveGroupedHarvestListExportCellValue(
        col,
        row,
        rowIdx,
        groups,
        resolveContext,
      );
    });
    ws.addRow(values);
    const excelRowNumber = rowIdx + 2;
    if (imageColumnIndexes.length > 0) {
      ws.getRow(excelRowNumber).height = 72;
    }

    for (const colIdx of imageColumnIndexes) {
      const colKey = selectedColumns[colIdx]!;
      const url = cellToExportString(
        resolveHarvestListExportCellValue(colKey, row, resolveContext),
      );
      if (!url) continue;

      let buffer = imageCache.get(url);
      if (buffer === undefined) {
        opts.onProgress?.(`Loading image ${imageCache.size + 1}…`);
        buffer = await fetchImageBuffer(url);
        imageCache.set(url, buffer);
      }

      if (buffer) {
        const ext = extensionFromUrl(url);
        const imageId = wb.addImage({ buffer, extension: ext });
        ws.addImage(imageId, {
          tl: { col: colIdx + 0.05, row: excelRowNumber - 1 + 0.05 },
          ext: { width: 88, height: 66 },
        });
      }
    }
  }

  selectedColumns.forEach((col, idx) => {
    const width = IMAGE_COLUMN_SET.has(col) ? 16 : 14;
    ws.getColumn(idx + 1).width = width;
  });

  applyHarvestExportXlsxProjectGrouping(ws, selectedColumns, groups);

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

export type HarvestListGoogleSheetExportPayload = {
  headers: string[];
  rows: string[][];
  imageCells?: HarvestListExportImageCellRef[];
  sheetTabName?: string;
  mergeRanges?: GoogleSheetMergeRange[];
  cellFills?: GoogleSheetCellFill[];
};

export function buildHarvestListGoogleSheetExportPayload(opts: {
  rows: Array<Record<string, unknown>>;
  selectedColumns: string[];
  columnLabel?: (key: string) => string;
  resolveContext?: HarvestListExportResolveContext;
  sheetTabName?: string;
}): HarvestListGoogleSheetExportPayload {
  const { rows, selectedColumns, resolveContext } = opts;
  const label = opts.columnLabel ?? ((k) => k);
  const { sortedRows, groups } = prepareGroupedHarvestExportRows(
    rows,
    selectedColumns,
    resolveContext,
  );
  const sheetFormatting = buildHarvestExportSheetFormatting(selectedColumns, groups);

  return {
    headers: selectedColumns.map(label),
    rows: sortedRows.map((row, rowIndex) =>
      selectedColumns.map((col) => {
        if (IMAGE_COLUMN_SET.has(col)) return "";
        return cellToExportString(
          resolveGroupedHarvestListExportCellValue(
            col,
            row,
            rowIndex,
            groups,
            resolveContext,
          ),
        );
      }),
    ),
    imageCells: collectHarvestListExportImageCells(sortedRows, selectedColumns),
    sheetTabName: opts.sheetTabName ?? "harvests",
    mergeRanges: sheetFormatting.mergeRanges,
    cellFills: sheetFormatting.cellFills,
  };
}

export async function exportHarvestListRowsToGoogleSheet(opts: {
  rows: Array<Record<string, unknown>>;
  selectedColumns: string[];
  columnLabel?: (key: string) => string;
  resolveContext?: HarvestListExportResolveContext;
}): Promise<{
  ok: boolean;
  message?: string;
  needsAuth?: boolean;
  authorizePath?: string;
  spreadsheetUrl?: string;
}> {
  const { rows, selectedColumns, resolveContext } = opts;
  if (rows.length === 0 || selectedColumns.length === 0) {
    return { ok: false, message: "No rows to export." };
  }

  const payload = buildHarvestListGoogleSheetExportPayload(opts);

  const res = await fetch("/api/projects/export/google-sheet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
