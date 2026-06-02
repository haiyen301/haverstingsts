import * as XLSX from "xlsx";

import {
  farmNameByIdFromRows,
  findProjectRowBySelectId,
  harvestRecordZoneStoredValue,
  type FarmZoneReferenceRow,
  zoneIdToLabel,
} from "@/shared/lib/harvestReferenceData";
import { harvestTypeDisplayLabel } from "@/shared/lib/harvestType";

/**
 * Columns offered on project detail harvest export (user-selected subset of
 * `sts_project_harvesting_plan`).
 */
export const PROJECT_DETAIL_HARVEST_EXPORT_COLUMN_KEYS = [
  "id",
  "project_id",
  "product_id",
  "zone",
  "farm_id",
  "quantity",
  "uom",
  "load_type",
  "harvested_area",
  "estimated_harvest_date",
  "estimated_harvest_end_date",
  "actual_harvest_date",
  "actual_harvest_end_date",
  "delivery_harvest_date",
  "shipment_required_date",
  "do_so_number",
  "do_so_date",
  "do_so_note",
  "truck_note",
  "shipping_dispatch_details",
  "general_note",
  "license_plate",
] as const;

export type ProjectDetailHarvestExportColumnKey =
  (typeof PROJECT_DETAIL_HARVEST_EXPORT_COLUMN_KEYS)[number];

export type HarvestPlanExportResolveContext = {
  projects: unknown[];
  products: unknown[];
  farms: unknown[];
  farmZones: FarmZoneReferenceRow[];
  /** When catalog lookup misses (e.g. current project title). */
  defaultProjectLabel?: string;
};

/** Export picker columns (fixed allowlist only). */
export function discoverHarvestPlanExportColumns(
  _rows: Array<Record<string, unknown>>,
): string[] {
  return [...PROJECT_DETAIL_HARVEST_EXPORT_COLUMN_KEYS];
}

export function defaultSelectedHarvestPlanExportColumns(
  allColumns: string[],
): Record<string, boolean> {
  const selected: Record<string, boolean> = {};
  for (const col of allColumns) selected[col] = true;
  return selected;
}

function formatCellValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") {
    const s = value.trim();
    if (s.startsWith("0000-00-00")) return "";
    return s;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 19).replace("T", " ");
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function humanizeHarvestPlanColumnKey(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function productNameFromId(
  products: unknown[],
  productId: string,
): string {
  if (!productId) return "";
  for (const row of products) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (String(r.id ?? "").trim() !== productId) continue;
    return String(r.name ?? r.title ?? "").trim();
  }
  return "";
}

/** Resolve FK / zone keys to display names for Excel cells. */
export function resolveHarvestPlanExportCellValue(
  columnKey: string,
  row: Record<string, unknown>,
  ctx?: HarvestPlanExportResolveContext,
): string {
  if (!ctx) return formatCellValue(row[columnKey]);

  switch (columnKey) {
    case "project_id": {
      const pid = String(row.project_id ?? "").trim();
      if (!pid) return "";
      const proj = findProjectRowBySelectId(ctx.projects, pid);
      const fromCatalog = proj
        ? String(proj.title ?? proj.name ?? "").trim()
        : "";
      return (
        fromCatalog ||
        String(row.project_name ?? "").trim() ||
        ctx.defaultProjectLabel?.trim() ||
        pid
      );
    }
    case "product_id": {
      const productId = String(row.product_id ?? "").trim();
      const fromRow = String(
        row.grass_name ?? row.commodity_name ?? "",
      ).trim();
      if (fromRow) return fromRow;
      const fromCatalog = productNameFromId(ctx.products, productId);
      return fromCatalog || productId;
    }
    case "zone": {
      const stored = harvestRecordZoneStoredValue(row);
      const fromRow = String(row.zone_name ?? "").trim();
      const fromCatalog = zoneIdToLabel(stored, ctx.farmZones);
      return fromCatalog || fromRow || stored;
    }
    case "farm_id": {
      const farmId = String(row.farm_id ?? "").trim();
      const fromRow = String(row.farm_name ?? "").trim();
      const fromCatalog = farmNameByIdFromRows(ctx.farms, farmId);
      return fromCatalog || fromRow || farmId;
    }
    case "load_type": {
      const raw = String(
        row.load_type ??
          row.harvest_type ??
          row.harvestType ??
          row.select_harvest_type ??
          row.selectHarvestType ??
          "",
      ).trim();
      if (!raw) return "";
      return harvestTypeDisplayLabel(raw) || raw;
    }
    default:
      return formatCellValue(row[columnKey]);
  }
}

export function exportHarvestPlanRowsToXlsx(opts: {
  rows: Array<Record<string, unknown>>;
  selectedColumns: string[];
  sheetName?: string;
  fileName: string;
  columnLabel?: (key: string) => string;
  resolveContext?: HarvestPlanExportResolveContext;
}): void {
  const { rows, selectedColumns, fileName, resolveContext } = opts;
  if (rows.length === 0 || selectedColumns.length === 0) return;

  const label = opts.columnLabel ?? humanizeHarvestPlanColumnKey;
  const headerRow = selectedColumns.map(label);
  const dataRows = rows.map((row) =>
    selectedColumns.map((col) =>
      resolveHarvestPlanExportCellValue(col, row, resolveContext),
    ),
  );

  const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    ws,
    (opts.sheetName ?? "harvests").slice(0, 31),
  );
  XLSX.writeFile(wb, fileName);
}

export function buildProjectHarvestExportFileName(
  projectLabel: string,
  projectId: string,
): string {
  const safe =
    projectLabel
      .replace(/[^\w\u00C0-\u024F\u1E00-\u1EFF\-]+/gu, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 60) || "project";
  const id = projectId.trim() || "unknown";
  const stamp = new Date().toISOString().slice(0, 10);
  return `${safe}-harvests-${id}-${stamp}.xlsx`;
}
