/** Per-line columns — one row per grass / quantity (not merged; still shaded per client block). */
const LINE_ITEM_COLUMN_KEYS = new Set(["grass_type", "quantity", "uom"]);

/** Columns shaded per client group row block (only `client` is merged vertically). */
const SHADED_GROUP_COLUMN_KEYS = new Set([
  "client",
  "grass_type",
  "farm",
  "quantity",
  "uom",
  "actual_harvest_date",
  "delivery_harvest_date",
  "shipment_required_date",
  "general_note",
]);

/** Alternating project-block fills (beige / white) like reference spreadsheet. */
export const HARVEST_EXPORT_GROUP_FILL_COLORS = [
  { argb: "FFF5E6D3", sheets: { red: 245 / 255, green: 230 / 255, blue: 211 / 255 } },
  { argb: "FFFFFFFF", sheets: { red: 1, green: 1, blue: 1 } },
] as const;

export type HarvestExportRowGroup = {
  startIndex: number;
  endIndex: number;
  shadeIndex: number;
};

export type HarvestExportSheetFormatting = {
  mergeRanges: Array<{
    startRowIndex: number;
    endRowIndex: number;
    startColumnIndex: number;
    endColumnIndex: number;
  }>;
  cellFills: Array<{
    startRowIndex: number;
    endRowIndex: number;
    startColumnIndex: number;
    endColumnIndex: number;
    red: number;
    green: number;
    blue: number;
  }>;
};

export function isHarvestExportLineItemColumn(columnKey: string): boolean {
  return LINE_ITEM_COLUMN_KEYS.has(columnKey);
}

export function isHarvestExportClientColumn(columnKey: string): boolean {
  return columnKey === "client";
}

export function isHarvestExportShadedProjectColumn(columnKey: string): boolean {
  return SHADED_GROUP_COLUMN_KEYS.has(columnKey);
}

export function resolveHarvestExportGroupKey<TCtx>(
  row: Record<string, unknown>,
  ctx?: TCtx,
  resolveClientLabel?: (row: Record<string, unknown>, ctx?: TCtx) => string,
): string {
  const client = resolveClientLabel?.(row, ctx)?.trim().toLowerCase() ?? "";
  if (client) return `client:${client}`;

  const projectId = String(row.project_id ?? "").trim();
  if (projectId) return `pid:${projectId}`;

  return `hid:${String(row.id ?? "")}`;
}

export function sortHarvestRowsForProjectGrouping<TCtx>(
  rows: Array<Record<string, unknown>>,
  ctx: TCtx | undefined,
  resolveGroupKey: (row: Record<string, unknown>, ctx?: TCtx) => string,
): Array<Record<string, unknown>> {
  return [...rows].sort((a, b) => {
    const ga = resolveGroupKey(a, ctx);
    const gb = resolveGroupKey(b, ctx);
    if (ga !== gb) return ga.localeCompare(gb);

    const ad = String(a.actual_harvest_date ?? "").trim();
    const bd = String(b.actual_harvest_date ?? "").trim();
    if (ad !== bd) return bd.localeCompare(ad);

    const grassA = String(a.grass_name ?? a.product_id ?? "").trim();
    const grassB = String(b.grass_name ?? b.product_id ?? "").trim();
    if (grassA !== grassB) return grassA.localeCompare(grassB);

    return String(b.id ?? "").localeCompare(String(a.id ?? ""));
  });
}

export function buildHarvestExportRowGroups<TCtx>(
  sortedRows: Array<Record<string, unknown>>,
  ctx: TCtx | undefined,
  resolveGroupKey: (row: Record<string, unknown>, ctx?: TCtx) => string,
): HarvestExportRowGroup[] {
  if (sortedRows.length === 0) return [];

  const groups: HarvestExportRowGroup[] = [];
  let shadeIndex = 0;
  let start = 0;
  let currentKey = resolveGroupKey(sortedRows[0]!, ctx);

  for (let i = 1; i <= sortedRows.length; i += 1) {
    const nextKey =
      i < sortedRows.length ? resolveGroupKey(sortedRows[i]!, ctx) : null;
    if (nextKey === currentKey) continue;

    groups.push({ startIndex: start, endIndex: i - 1, shadeIndex });
    shadeIndex += 1;
    if (i < sortedRows.length) {
      start = i;
      currentKey = nextKey!;
    }
  }

  return groups;
}

export function isFirstRowInHarvestExportGroup(
  rowIndex: number,
  groups: HarvestExportRowGroup[],
): boolean {
  for (const group of groups) {
    if (rowIndex >= group.startIndex && rowIndex <= group.endIndex) {
      return rowIndex === group.startIndex;
    }
  }
  return true;
}

export function buildHarvestExportSheetFormatting(
  selectedColumns: string[],
  groups: HarvestExportRowGroup[],
): HarvestExportSheetFormatting {
  const mergeRanges: HarvestExportSheetFormatting["mergeRanges"] = [];
  const cellFills: HarvestExportSheetFormatting["cellFills"] = [];

  const clientColumnIndex = selectedColumns.findIndex((col) =>
    isHarvestExportClientColumn(col),
  );
  const shadedColumnIndexes = selectedColumns
    .map((col, idx) => (isHarvestExportShadedProjectColumn(col) ? idx : -1))
    .filter((idx) => idx >= 0);

  for (const group of groups) {
    const rowCount = group.endIndex - group.startIndex + 1;
    const shade = HARVEST_EXPORT_GROUP_FILL_COLORS[group.shadeIndex % 2]!;

    for (const colIdx of shadedColumnIndexes) {
      cellFills.push({
        startRowIndex: group.startIndex,
        endRowIndex: group.endIndex + 1,
        startColumnIndex: colIdx,
        endColumnIndex: colIdx + 1,
        red: shade.sheets.red,
        green: shade.sheets.green,
        blue: shade.sheets.blue,
      });
    }

    if (rowCount > 1 && clientColumnIndex >= 0) {
      mergeRanges.push({
        startRowIndex: group.startIndex,
        endRowIndex: group.endIndex + 1,
        startColumnIndex: clientColumnIndex,
        endColumnIndex: clientColumnIndex + 1,
      });
    }
  }

  return { mergeRanges, cellFills };
}
