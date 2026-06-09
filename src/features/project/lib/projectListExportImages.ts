import { getAttachmentUrls, HARVEST_ATTACHMENT_SOURCES } from "@/shared/lib/harvestAttachmentImages";

/** Image columns from `sts_project_harvesting_plan` (labels match Harvest form photo slots). */
export const PROJECT_LIST_EXPORT_IMAGE_COLUMN_KEYS = HARVEST_ATTACHMENT_SOURCES.map(
  (x) => x.field,
);

export const PROJECT_LIST_EXPORT_IMAGE_COLUMN_SET = new Set<string>(
  PROJECT_LIST_EXPORT_IMAGE_COLUMN_KEYS,
);

export function isProjectListExportImageColumn(columnKey: string): boolean {
  return PROJECT_LIST_EXPORT_IMAGE_COLUMN_SET.has(columnKey);
}

/** CSV cannot embed images — omit image columns entirely. */
export function filterProjectListExportColumnsForCsv(
  selectedColumns: string[],
): string[] {
  return selectedColumns.filter((col) => !isProjectListExportImageColumn(col));
}

export function projectListExportImageUrlFromRow(
  row: Record<string, unknown>,
  columnKey: string,
): string {
  if (!isProjectListExportImageColumn(columnKey)) return "";
  return getAttachmentUrls(row[columnKey])[0] ?? "";
}

export function buildProjectListHarvestImageProxyPath(sourceUrl: string): string {
  const u = sourceUrl.trim();
  if (!u) return "";
  return `/api/projects/export/harvest-image?src=${encodeURIComponent(u)}`;
}

export type ProjectListExportImageCellRef = {
  /** 0-based index in `rows` (not counting header). */
  rowIndex: number;
  /** 0-based column index in export grid. */
  columnIndex: number;
  sourceUrl: string;
};

export function collectProjectListExportImageCells(
  rows: Array<Record<string, unknown>>,
  selectedColumns: string[],
): ProjectListExportImageCellRef[] {
  const out: ProjectListExportImageCellRef[] = [];
  rows.forEach((row, rowIndex) => {
    selectedColumns.forEach((col, columnIndex) => {
      if (!isProjectListExportImageColumn(col)) return;
      const sourceUrl = projectListExportImageUrlFromRow(row, col);
      if (!sourceUrl) return;
      out.push({ rowIndex, columnIndex, sourceUrl });
    });
  });
  return out;
}
