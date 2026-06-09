import ExcelJS from "exceljs";
import * as XLSX from "xlsx";

import {
  fetchMondayProjectRowsFromServer,
  type MondayProjectServerRow,
} from "@/entities/projects";
import { resolveMondayCardStatusForListFilter } from "@/features/project/lib/buildProjectCardData";
import {
  projectHarvestDisplayDateFromRecord,
  resolveHarvestPlanExportCellValue,
  type HarvestPlanExportResolveContext,
} from "@/features/project/lib/projectHarvestPlanExport";
import {
  buildProjectListHarvestImageProxyPath,
  collectProjectListExportImageCells,
  filterProjectListExportColumnsForCsv,
  isProjectListExportImageColumn,
  PROJECT_LIST_EXPORT_IMAGE_COLUMN_KEYS,
  type ProjectListExportImageCellRef,
} from "@/features/project/lib/projectListExportImages";
import { getAttachmentUrls } from "@/shared/lib/harvestAttachmentImages";
import { formatDateDisplayDmy } from "@/shared/lib/format/date";
import { parseJsonMaybe, parseQuantityRequiredRows } from "@/shared/lib/parseJsonMaybe";

export { PROJECT_LIST_EXPORT_IMAGE_COLUMN_KEYS, type ProjectListExportImageCellRef };

/**
 * All exportable columns for Projects list (harvest plan lines scoped to current filters).
 */
export const PROJECT_LIST_EXPORT_COLUMN_KEYS = [
  "date",
  "project_id",
  "project_name",
  "pit",
  "project_status",
  "country_name",
  "farm_name",
  "zone",
  "grass_type",
  "load_type",
  "quantity",
  "uom",
  "area",
  ...PROJECT_LIST_EXPORT_IMAGE_COLUMN_KEYS,
] as const;

export type ProjectListExportColumnKey =
  (typeof PROJECT_LIST_EXPORT_COLUMN_KEYS)[number];

/** Default ticked columns (1–13 from product spec). */
export const PROJECT_LIST_EXPORT_DEFAULT_SELECTED_KEYS: readonly ProjectListExportColumnKey[] =
  [
    "date",
    "project_id",
    "project_name",
    "pit",
    "project_status",
    "country_name",
    "farm_name",
    "zone",
    "grass_type",
    "load_type",
    "quantity",
    "uom",
    "area",
  ];

const DEFAULT_SELECTED_SET = new Set(PROJECT_LIST_EXPORT_DEFAULT_SELECTED_KEYS);

export type ProjectListExportFilter = {
  search: string;
  countryIds: string[];
  farmIds: string[];
  grassIds: string[];
  projectIds: string[];
  statusValues: string[];
};

export type ProjectListExportResolveContext = HarvestPlanExportResolveContext & {
  countries?: unknown[];
  staffs?: unknown[];
  projectStatusLabel?: (status: string) => string;
};

export type ProjectListExportProjectMeta = {
  projectId: string;
  projectName: string;
  pit: string;
  projectStatus: string;
  countryName: string;
};

const IMAGE_COLUMN_SET = new Set<string>(PROJECT_LIST_EXPORT_IMAGE_COLUMN_KEYS);

export { filterProjectListExportColumnsForCsv, isProjectListExportImageColumn };

function normalizeProjectStatusLabel(v: unknown): string {
  const s = String(v ?? "").toLowerCase().trim();
  if (!s) return "";
  if (s.includes("done") || s.includes("complete")) return "Done";
  if (s.includes("future")) return "Future";
  if (s.includes("warning")) return "Warning";
  if (s.includes("ongoing")) return "Ongoing";
  return "";
}

function normalizeDynamicFieldName(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function normalizeDynamicFieldValue(v: unknown): string {
  return String(v ?? "").trim();
}

function makeRowTableKey(row: Record<string, unknown>): string {
  const rowId = String(row.row_id ?? row.id_row ?? row.id ?? "").trim();
  const tableId = String(row.table_id ?? row.table ?? "").trim();
  return `${rowId}__${tableId}`;
}

function isAllProjectStatusesSelected(values: string[]): boolean {
  if (values.length === 0) return true;
  const picked = new Set(
    values.map((x) => normalizeProjectStatusLabel(x)).filter(Boolean),
  );
  return (["Ongoing", "Future", "Done", "Warning"] as const).every((s) =>
    picked.has(s),
  );
}

function buildStatusQuery(statusValues: string[]): string {
  if (isAllProjectStatusesSelected(statusValues)) return "";
  return statusValues
    .map((x) => normalizeProjectStatusLabel(x))
    .filter(Boolean)
    .join(",");
}

function farmIdInQuantityRequiredRaw(raw: unknown, farmId: string): boolean {
  const fid = String(farmId ?? "").trim();
  if (!fid) return false;
  return parseQuantityRequiredRows(raw).some(
    (line) => String(line.farm_id ?? "").trim() === fid,
  );
}

function rowHasGrassProduct(row: MondayProjectServerRow, productId: string): boolean {
  const pid = String(productId ?? "").trim();
  if (!pid) return false;
  const raw = (row as Record<string, unknown>).quantity_required_sprig_sod;
  const parsed = parseJsonMaybe(raw);
  if (!Array.isArray(parsed)) return false;
  return parsed.some((item) => {
    if (!item || typeof item !== "object") return false;
    const rec = item as Record<string, unknown>;
    return String(rec.product_id ?? "").trim() === pid;
  });
}

function rowHasFarmInSubitems(row: MondayProjectServerRow, farmId: string): boolean {
  const fid = String(farmId ?? "").trim();
  if (!fid) return false;
  const raw = (row as Record<string, unknown>).subitems;
  const parsed = parseJsonMaybe(raw);
  if (!Array.isArray(parsed)) return false;
  return parsed.some((item) => {
    if (!item || typeof item !== "object") return false;
    const rec = item as Record<string, unknown>;
    return String(rec.farm_id ?? "").trim() === fid;
  });
}

function quantityRequiredRawFromDynamicGroup(
  grouped: Record<string, unknown>[],
): unknown {
  for (const rec of grouped) {
    const fieldName = normalizeDynamicFieldName(rec.name);
    if (fieldName === "quantity_required_sprig_sod") {
      return rec.value ?? rec.quantity_required_sprig_sod;
    }
  }
  for (const rec of grouped) {
    if (rec.quantity_required_sprig_sod != null) {
      return rec.quantity_required_sprig_sod;
    }
  }
  return undefined;
}

function projectIdFromDynamicGroup(grouped: Record<string, unknown>[]): string {
  for (const rec of grouped) {
    const fieldName = normalizeDynamicFieldName(rec.name);
    if (fieldName === "project_id") {
      return normalizeDynamicFieldValue(rec.value ?? rec.project_id);
    }
  }
  for (const rec of grouped) {
    const pid = String(rec.project_id ?? "").trim();
    if (pid) return pid;
  }
  return "";
}

function buildQuantityRequiredByProjectId(
  allRows: Record<string, unknown>[],
): Map<string, unknown[]> {
  const byRowTable = new Map<string, Record<string, unknown>[]>();
  for (const row of allRows) {
    const key = makeRowTableKey(row);
    if (!key || key === "__") continue;
    const list = byRowTable.get(key) ?? [];
    list.push(row);
    byRowTable.set(key, list);
  }

  const map = new Map<string, unknown[]>();
  for (const grouped of byRowTable.values()) {
    const projectId = projectIdFromDynamicGroup(grouped);
    if (!projectId) continue;
    const raw = quantityRequiredRawFromDynamicGroup(grouped);
    if (raw == null) continue;
    const list = map.get(projectId) ?? [];
    list.push(raw);
    map.set(projectId, list);
  }
  return map;
}

function rowMatchesFarmFilter(
  row: MondayProjectServerRow,
  farmId: string,
  qtyRequiredByProjectId: Map<string, unknown[]>,
): boolean {
  const fid = String(farmId ?? "").trim();
  if (!fid) return false;

  if (
    farmIdInQuantityRequiredRaw(
      (row as Record<string, unknown>).quantity_required_sprig_sod,
      fid,
    )
  ) {
    return true;
  }

  const projectId = String((row as Record<string, unknown>).project_id ?? "").trim();
  if (projectId) {
    const raws = qtyRequiredByProjectId.get(projectId);
    if (raws?.some((raw) => farmIdInQuantityRequiredRaw(raw, fid))) {
      return true;
    }
  }

  return rowHasFarmInSubitems(row, fid);
}

function staffNameById(staffs: unknown[] | undefined, staffId: string): string {
  const id = String(staffId ?? "").trim();
  if (!id) return "";
  for (const row of staffs ?? []) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    if (String(rec.id ?? "").trim() !== id) continue;
    return String(
      rec.first_name ?? rec.full_name ?? rec.name ?? rec.title ?? "",
    ).trim();
  }
  return "";
}

function countryNameById(
  countries: unknown[] | undefined,
  countryId: string,
): string {
  const id = String(countryId ?? "").trim();
  if (!id) return "";
  for (const row of countries ?? []) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    if (String(rec.id ?? "").trim() !== id) continue;
    return String(rec.country_name ?? rec.name ?? rec.title ?? "").trim();
  }
  return "";
}

function projectTitleById(projects: unknown[] | undefined, projectId: string): string {
  const id = String(projectId ?? "").trim();
  if (!id) return "";
  for (const row of projects ?? []) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    if (String(rec.id ?? "").trim() !== id) continue;
    return String(rec.title ?? rec.name ?? "").trim();
  }
  return "";
}

function buildProjectMetaMap(
  mondayRows: MondayProjectServerRow[],
  ctx: ProjectListExportResolveContext,
): Map<string, ProjectListExportProjectMeta> {
  const map = new Map<string, ProjectListExportProjectMeta>();
  for (const row of mondayRows) {
    const projectId = String((row as Record<string, unknown>).project_id ?? "").trim();
    if (!projectId || map.has(projectId)) continue;
    const status = resolveMondayCardStatusForListFilter(row);
    const statusLabel = ctx.projectStatusLabel?.(status) ?? status;
    const picId = String((row as Record<string, unknown>).pic ?? "").trim();
    const countryId = String((row as Record<string, unknown>).country_id ?? "").trim();
    map.set(projectId, {
      projectId,
      projectName:
        projectTitleById(ctx.projects, projectId) ||
        String((row as Record<string, unknown>).project_name ?? "").trim() ||
        projectId,
      pit: staffNameById(ctx.staffs, picId) || picId,
      projectStatus: statusLabel,
      countryName:
        countryNameById(ctx.countries, countryId) ||
        String((row as Record<string, unknown>).country_name ?? "").trim(),
    });
  }
  return map;
}

function filterMondayRowsForExport(
  rows: MondayProjectServerRow[],
  filter: ProjectListExportFilter,
): MondayProjectServerRow[] {
  const {
    countryIds: countryFilterIds,
    farmIds: farmFilterIds,
    grassIds: grassFilterIds,
    projectIds: projectFilterIds,
  } = filter;

  const qtyRequiredByProjectId =
    farmFilterIds.length > 0
      ? buildQuantityRequiredByProjectId(rows as unknown as Record<string, unknown>[])
      : new Map<string, unknown[]>();

  const allowedProjectIdsByCountry = new Set<string>();
  if (countryFilterIds.length > 0) {
    const byRowTable = new Map<string, Record<string, unknown>[]>();
    for (const row of rows as unknown as Record<string, unknown>[]) {
      const key = makeRowTableKey(row);
      if (!key || key === "__") continue;
      const list = byRowTable.get(key) ?? [];
      list.push(row);
      byRowTable.set(key, list);
    }

    for (const grouped of byRowTable.values()) {
      let matchedCountry = false;
      for (const rec of grouped) {
        const fieldName = normalizeDynamicFieldName(rec.name);
        if (fieldName !== "country_id") continue;
        const fieldValue = normalizeDynamicFieldValue(rec.value);
        if (countryFilterIds.includes(fieldValue)) {
          matchedCountry = true;
          break;
        }
      }
      if (!matchedCountry) continue;

      for (const rec of grouped) {
        const fieldName = normalizeDynamicFieldName(rec.name);
        if (fieldName !== "project_id") continue;
        const projectId = normalizeDynamicFieldValue(rec.value ?? rec.project_id);
        if (projectId) allowedProjectIdsByCountry.add(projectId);
      }
    }
  }

  return rows.filter((data) => {
    const rec = data as Record<string, unknown>;
    const recProjectId = String(rec.project_id ?? "").trim();
    const visibleByServerRow = recProjectId !== "";
    const countryOk =
      countryFilterIds.length === 0 ||
      countryFilterIds.includes(String(rec.country_id ?? "").trim()) ||
      (recProjectId ? allowedProjectIdsByCountry.has(recProjectId) : false);
    const farmOk =
      farmFilterIds.length === 0 ||
      farmFilterIds.some((id) =>
        rowMatchesFarmFilter(data, id, qtyRequiredByProjectId),
      );
    const grassOk =
      grassFilterIds.length === 0 ||
      grassFilterIds.some((id) => rowHasGrassProduct(data, id));
    const projectOk =
      projectFilterIds.length === 0 ||
      projectFilterIds.includes(recProjectId);
    return visibleByServerRow && countryOk && farmOk && grassOk && projectOk;
  });
}

async function fetchAllMondayProjectRowsForExport(
  filter: ProjectListExportFilter,
): Promise<MondayProjectServerRow[]> {
  const statusQuery = buildStatusQuery(filter.statusValues);
  const search = filter.search.trim() || undefined;
  const perPage = 200;
  const maxPages = 50;
  let page = 1;
  let allRows: MondayProjectServerRow[] = [];
  let totalRecords: number | null = null;

  for (;;) {
    const res = await fetchMondayProjectRowsFromServer({
      module: "project",
      search,
      page,
      perPage,
      status: statusQuery || undefined,
      sortBy: "project_id",
      sortDir: "desc",
      listPaged: true,
    });
    const list = res.rows as MondayProjectServerRow[];
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

function harvestRowMatchesLineFilters(
  row: Record<string, unknown>,
  filter: ProjectListExportFilter,
): boolean {
  const farmId = String(row.farm_id ?? "").trim();
  const productId = String(row.product_id ?? "").trim();
  const farmOk =
    filter.farmIds.length === 0 || filter.farmIds.includes(farmId);
  const grassOk =
    filter.grassIds.length === 0 || filter.grassIds.includes(productId);
  return farmOk && grassOk;
}

/**
 * Load all Monday rows matching server filters, apply client filters, then expand
 * harvest plan lines for export (respects current Projects page filter state).
 */
export async function buildProjectListExportRows(
  filter: ProjectListExportFilter,
  harvestPlanRows: Array<Record<string, unknown>>,
  ctx: ProjectListExportResolveContext,
): Promise<Array<Record<string, unknown>>> {
  const mondayRows = await fetchAllMondayProjectRowsForExport(filter);
  const filteredProjects = filterMondayRowsForExport(mondayRows, filter);
  const allowedProjectIds = new Set(
    filteredProjects
      .map((r) => String((r as Record<string, unknown>).project_id ?? "").trim())
      .filter(Boolean),
  );
  if (allowedProjectIds.size === 0) return [];

  const projectMeta = buildProjectMetaMap(filteredProjects, ctx);
  const out: Array<Record<string, unknown>> = [];

  for (const plan of harvestPlanRows) {
    const projectId = String(plan.project_id ?? "").trim();
    if (!projectId || !allowedProjectIds.has(projectId)) continue;
    if (!harvestRowMatchesLineFilters(plan, filter)) continue;

    const meta = projectMeta.get(projectId);
    out.push({
      ...plan,
      project_name: meta?.projectName ?? "",
      pit: meta?.pit ?? "",
      project_status: meta?.projectStatus ?? "",
      country_name: meta?.countryName ?? "",
    });
  }

  out.sort((a, b) => {
    const ad = formatDateDisplayDmy(projectHarvestDisplayDateFromRecord(a, ctx.locale));
    const bd = formatDateDisplayDmy(projectHarvestDisplayDateFromRecord(b, ctx.locale));
    if (ad !== bd && ad !== "-" && bd !== "-") return ad.localeCompare(bd);
    const ap = String(a.project_id ?? "");
    const bp = String(b.project_id ?? "");
    if (ap !== bp) return ap.localeCompare(bp);
    return String(a.id ?? "").localeCompare(String(b.id ?? ""));
  });

  return out;
}

export function discoverProjectListExportColumns(): string[] {
  return [...PROJECT_LIST_EXPORT_COLUMN_KEYS];
}

export function defaultSelectedProjectListExportColumns(
  allColumns: string[],
): Record<string, boolean> {
  const selected: Record<string, boolean> = {};
  for (const col of allColumns) {
    selected[col] = DEFAULT_SELECTED_SET.has(col as ProjectListExportColumnKey);
  }
  return selected;
}

/** Map image field → HarvestForm i18n key (same labels as harvest/new photo slots). */
export const PROJECT_LIST_EXPORT_PHOTO_LABEL_KEYS: Record<string, string> = {
  payment_img: "photoSlotPayment",
  shipping_note_img: "photoSlotShipping",
  thermostats_img: "photoSlotThermostat",
  truck_license_plate_img: "photoSlotPlate",
  product_being_cut_img: "photoSlotCutting",
  truck_loaded_img: "photoSlotLoaded",
};

export function projectListExportColumnLabel(
  translateProjects: (key: string) => string,
  translateHarvestForm: (key: string) => string,
  columnKey: string,
): string {
  const photoKey = PROJECT_LIST_EXPORT_PHOTO_LABEL_KEYS[columnKey];
  if (photoKey) {
    return translateHarvestForm(photoKey);
  }
  return translateProjects(`exportCol_${columnKey}`);
}

function resolveProjectListExportCellValue(
  columnKey: string,
  row: Record<string, unknown>,
  ctx?: ProjectListExportResolveContext,
): string | number {
  if (columnKey === "date") {
    const formatted = formatDateDisplayDmy(
      projectHarvestDisplayDateFromRecord(row, ctx?.locale),
    );
    return formatted === "-" ? "" : formatted;
  }
  if (columnKey === "project_id") {
    return String(row.project_id ?? "").trim();
  }
  if (columnKey === "project_name") {
    return String(row.project_name ?? "").trim();
  }
  if (columnKey === "pit") {
    return String(row.pit ?? "").trim();
  }
  if (columnKey === "project_status") {
    return String(row.project_status ?? "").trim();
  }
  if (columnKey === "country_name") {
    return String(row.country_name ?? "").trim();
  }
  if (columnKey === "grass_type") {
    return String(resolveHarvestPlanExportCellValue("product_id", row, ctx));
  }
  if (columnKey === "area") {
    return resolveHarvestPlanExportCellValue("harvested_area", row, ctx);
  }
  if (columnKey === "farm_name") {
    return String(resolveHarvestPlanExportCellValue("farm_id", row, ctx));
  }
  if (IMAGE_COLUMN_SET.has(columnKey)) {
    const urls = getAttachmentUrls(row[columnKey]);
    return urls[0] ?? "";
  }

  const harvestKeyMap: Record<string, string> = {
    zone: "zone",
    load_type: "load_type",
    quantity: "quantity",
    uom: "uom",
  };
  const harvestKey = harvestKeyMap[columnKey];
  if (harvestKey) {
    return resolveHarvestPlanExportCellValue(harvestKey, row, ctx);
  }
  return String(row[columnKey] ?? "").trim();
}

function cellToExportString(value: string | number): string {
  if (value == null) return "";
  return String(value);
}

export function buildProjectListExportFileName(format: "csv" | "xlsx"): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `projects-export-${stamp}.${format}`;
}

export function exportProjectListRowsToCsv(opts: {
  rows: Array<Record<string, unknown>>;
  selectedColumns: string[];
  fileName: string;
  columnLabel?: (key: string) => string;
  resolveContext?: ProjectListExportResolveContext;
}): void {
  const { rows, fileName, resolveContext } = opts;
  const selectedColumns = filterProjectListExportColumnsForCsv(opts.selectedColumns);
  if (rows.length === 0 || selectedColumns.length === 0) return;

  const label = opts.columnLabel ?? ((k) => k);
  const escapeCsv = (v: string) => {
    if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  };

  const header = selectedColumns.map((c) => escapeCsv(label(c))).join(",");
  const lines = rows.map((row) =>
    selectedColumns
      .map((col) =>
        escapeCsv(
          cellToExportString(
            resolveProjectListExportCellValue(col, row, resolveContext),
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

export function exportProjectListRowsToXlsx(opts: {
  rows: Array<Record<string, unknown>>;
  selectedColumns: string[];
  fileName: string;
  columnLabel?: (key: string) => string;
  resolveContext?: ProjectListExportResolveContext;
}): void {
  const { rows, selectedColumns, fileName, resolveContext } = opts;
  if (rows.length === 0 || selectedColumns.length === 0) return;

  const label = opts.columnLabel ?? ((k) => k);
  const headerRow = selectedColumns.map(label);
  const dataRows = rows.map((row) =>
    selectedColumns.map((col) =>
      resolveProjectListExportCellValue(col, row, resolveContext),
    ),
  );

  const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows], {
    cellDates: false,
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "projects".slice(0, 31));
  XLSX.writeFile(wb, fileName);
}

async function fetchImageBuffer(url: string): Promise<ArrayBuffer | null> {
  const u = url.trim();
  if (!u) return null;
  try {
    const proxyPath = buildProjectListHarvestImageProxyPath(u);
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

/**
 * Excel export with images embedded via the authenticated harvest-image proxy.
 */
export async function exportProjectListRowsToXlsxWithImages(opts: {
  rows: Array<Record<string, unknown>>;
  selectedColumns: string[];
  fileName: string;
  columnLabel?: (key: string) => string;
  resolveContext?: ProjectListExportResolveContext;
  onProgress?: (message: string) => void;
}): Promise<void> {
  const { rows, selectedColumns, fileName, resolveContext } = opts;
  if (rows.length === 0 || selectedColumns.length === 0) return;

  const label = opts.columnLabel ?? ((k) => k);
  const imageColumnIndexes = selectedColumns
    .map((col, idx) => (IMAGE_COLUMN_SET.has(col) ? idx : -1))
    .filter((idx) => idx >= 0);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("projects");

  ws.addRow(selectedColumns.map(label));

  const imageCache = new Map<string, ArrayBuffer | null>();

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx += 1) {
    const row = rows[rowIdx]!;
    const values = selectedColumns.map((col) => {
      if (IMAGE_COLUMN_SET.has(col)) return "";
      return resolveProjectListExportCellValue(col, row, resolveContext);
    });
    ws.addRow(values);
    const excelRowNumber = rowIdx + 2;
    if (imageColumnIndexes.length > 0) {
      ws.getRow(excelRowNumber).height = 72;
    }

    for (const colIdx of imageColumnIndexes) {
      const colKey = selectedColumns[colIdx]!;
      const url = cellToExportString(
        resolveProjectListExportCellValue(colKey, row, resolveContext),
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
        const imageId = wb.addImage({
          buffer,
          extension: ext,
        });
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

export type GoogleSheetMergeRange = {
  /** 0-based index of first data row (0 = row immediately below header). */
  startRowIndex: number;
  /** Exclusive end row index. */
  endRowIndex: number;
  startColumnIndex: number;
  endColumnIndex: number;
};

export type GoogleSheetCellFill = {
  startRowIndex: number;
  endRowIndex: number;
  startColumnIndex: number;
  endColumnIndex: number;
  red: number;
  green: number;
  blue: number;
};

export type ProjectListGoogleSheetExportPayload = {
  headers: string[];
  rows: string[][];
  imageCells?: ProjectListExportImageCellRef[];
  sheetTabName?: string;
  mergeRanges?: GoogleSheetMergeRange[];
  cellFills?: GoogleSheetCellFill[];
};

export async function exportProjectListRowsToGoogleSheet(opts: {
  rows: Array<Record<string, unknown>>;
  selectedColumns: string[];
  columnLabel?: (key: string) => string;
  resolveContext?: ProjectListExportResolveContext;
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

  const label = opts.columnLabel ?? ((k) => k);
  const payload: ProjectListGoogleSheetExportPayload = {
    headers: selectedColumns.map(label),
    rows: rows.map((row) =>
      selectedColumns.map((col) => {
        if (IMAGE_COLUMN_SET.has(col)) return "";
        return cellToExportString(
          resolveProjectListExportCellValue(col, row, resolveContext),
        );
      }),
    ),
    imageCells: collectProjectListExportImageCells(rows, selectedColumns),
  };

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
