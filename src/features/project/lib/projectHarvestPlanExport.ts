import * as XLSX from "xlsx";

import {
  farmNameByIdFromRows,
  findProjectRowBySelectId,
  harvestRecordZoneStoredValue,
  type FarmZoneReferenceRow,
  zoneIdToLabel,
} from "@/shared/lib/harvestReferenceData";
import { formatDateDisplay, isValidDate } from "@/shared/lib/format/date";
import { harvestTypeDisplayLabel } from "@/shared/lib/harvestType";

/**
 * Columns offered on project detail harvest export (user-selected subset of
 * `sts_project_harvesting_plan`).
 */
export const PROJECT_DETAIL_HARVEST_EXPORT_COLUMN_KEYS = [
  "id",
  "date",
  "product_id",
  "farm_id",
  "zone",
  "quantity",
  "uom",
  "harvested_area",
  "status",
  "project_id",
  "load_type",
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

/** Default export selection — same columns as project detail harvest table. */
export const PROJECT_DETAIL_HARVEST_EXPORT_DEFAULT_SELECTED_KEYS: readonly ProjectDetailHarvestExportColumnKey[] =
  [
    "date",
    "product_id",
    "farm_id",
    "zone",
    "quantity",
    "uom",
    "harvested_area",
    "status",
  ];

const PROJECT_DETAIL_HARVEST_EXPORT_DEFAULT_SELECTED_SET = new Set(
  PROJECT_DETAIL_HARVEST_EXPORT_DEFAULT_SELECTED_KEYS,
);

export type HarvestPlanExportResolveContext = {
  projects: unknown[];
  products: unknown[];
  farms: unknown[];
  farmZones: FarmZoneReferenceRow[];
  /** When catalog lookup misses (e.g. current project title). */
  defaultProjectLabel?: string;
  /** Same locale as project detail table (`formatDateDisplay`). */
  locale?: string;
  /** Localized scheduled / harvested / delivered labels for export cells. */
  projectHarvestLineStatusLabel?: (
    status: ProjectHarvestLineStatus,
  ) => string;
};

export type ProjectHarvestLineStatus = "scheduled" | "harvested" | "delivered";

/** Same rule as project detail harvest table status column. */
export function deriveProjectHarvestStatusFromRecord(
  row: Record<string, unknown>,
): ProjectHarvestLineStatus {
  const delivery = String(row.delivery_harvest_date ?? "").trim();
  const harvest = String(row.actual_harvest_date ?? "").trim();
  if (isValidDate(delivery)) return "delivered";
  if (isValidDate(harvest)) return "harvested";
  return "scheduled";
}

export function projectHarvestLineStatusLabel(
  translate: (key: string) => string,
  status: ProjectHarvestLineStatus,
): string {
  switch (status) {
    case "scheduled":
      return translate("harvestStatus_scheduled");
    case "harvested":
      return translate("harvestStatus_harvested");
    case "delivered":
      return translate("harvestStatus_delivered");
    default:
      return status;
  }
}

/**
 * Same rule as project detail table + harvest detail popup (`h.date` /
 * `displayDate`): actual harvest date if valid, else estimated.
 */
export function projectHarvestDisplayDateFromRecord(
  row: Record<string, unknown>,
  locale?: string,
): string {
  const actual = String(row.actual_harvest_date ?? "").trim();
  const estimated = String(row.estimated_harvest_date ?? "").trim();
  return formatDateDisplay(
    isValidDate(actual) ? actual : estimated,
    locale,
  );
}

function harvestPlanDisplayDateForExport(
  row: Record<string, unknown>,
  locale?: string,
): string {
  const fromUi = String(row.date ?? "").trim();
  if (fromUi && fromUi !== "-") return fromUi;
  const formatted = projectHarvestDisplayDateFromRecord(row, locale);
  return formatted === "-" ? "" : formatted;
}

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
  for (const col of allColumns) {
    selected[col] = PROJECT_DETAIL_HARVEST_EXPORT_DEFAULT_SELECTED_SET.has(
      col as ProjectDetailHarvestExportColumnKey,
    );
  }
  return selected;
}

const EXPORT_NUMERIC_STRING_RE = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

function parseExportNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const s = value.trim().replace(/,/g, "");
    if (!s || !EXPORT_NUMERIC_STRING_RE.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Excel-friendly numbers: `0` not `0.000…`, strip trailing fractional zeros (text cells). */
function formatExportNumericValue(value: unknown): string {
  const n = parseExportNumber(value);
  if (n == null) return "";
  const cell = normalizeExportNumeric(n);
  if (cell === "") return "";
  return Number.isInteger(cell)
    ? String(cell)
    : String(cell).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

/** Numeric Excel cells (`quantity`, `harvested_area`) — not text. */
function normalizeExportNumeric(n: number): number | "" {
  if (Object.is(n, -0) || Math.abs(n) < 1e-12) return 0;
  if (Number.isInteger(n) || Math.abs(n - Math.round(n)) < 1e-9) {
    return Math.round(n);
  }
  return parseFloat(n.toPrecision(12));
}

function exportNumericCellValue(value: unknown): number | "" {
  const n = parseExportNumber(value);
  if (n == null) return "";
  return normalizeExportNumeric(n);
}

function formatCellValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number") {
    return formatExportNumericValue(value);
  }
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return "";
    if (s.startsWith("0000-00-00")) return "";
    const n = parseExportNumber(s);
    if (n != null) return formatExportNumericValue(n);
    return s;
  }
  if (typeof value === "boolean") {
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

/** Column labels in export dialog / Excel header (`ProjectDetail.exportCol_*`). */
export function projectDetailHarvestExportColumnLabel(
  translate: (key: string) => string,
  columnKey: string,
): string {
  const stripLabel = (label: string) => label.replace(/:+\s*$/, "").trim();
  // Use `exportCol_*` keys — all export columns define these in `ProjectDetail` messages.
  return stripLabel(translate(`exportCol_${columnKey}` as "exportCol_id"));
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

export type HarvestPlanExportCellValue = string | number;

/** Resolve FK / zone keys to display names for Excel cells. */
export function resolveHarvestPlanExportCellValue(
  columnKey: string,
  row: Record<string, unknown>,
  ctx?: HarvestPlanExportResolveContext,
): HarvestPlanExportCellValue {
  if (columnKey === "quantity" || columnKey === "harvested_area") {
    return exportNumericCellValue(row[columnKey]);
  }

  if (columnKey === "date") {
    return harvestPlanDisplayDateForExport(row, ctx?.locale);
  }

  if (columnKey === "status") {
    const fromUi = String(row.status_label ?? "").trim();
    if (fromUi) return fromUi;
    const status = deriveProjectHarvestStatusFromRecord(row);
    return ctx?.projectHarvestLineStatusLabel?.(status) ?? status;
  }

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
  const headerRow: HarvestPlanExportCellValue[] = selectedColumns.map(label);
  const dataRows: HarvestPlanExportCellValue[][] = rows.map((row) =>
    selectedColumns.map((col) =>
      resolveHarvestPlanExportCellValue(col, row, resolveContext),
    ),
  );

  const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows], {
    cellDates: false,
  });
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
