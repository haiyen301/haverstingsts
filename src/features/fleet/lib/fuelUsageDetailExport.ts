import ExcelJS from "exceljs";

import type { FleetFuelImportRow } from "@/features/fleet/api/fleetFuelImportsApi";
import { fetchFleetFuelImports } from "@/features/fleet/api/fleetFuelImportsApi";
import type { FleetStockLedgerRow } from "@/features/fleet/api/fleetStockLedgerApi";
import { fetchFleetStockLedger } from "@/features/fleet/api/fleetStockLedgerApi";
import type { FuelUsageRow } from "@/features/fleet/api/fuelUsageApi";
import {
  fetchFuelUsage,
  fuelUsageFuelKindLabel,
  fuelUsageVehicleLabel,
} from "@/features/fleet/api/fuelUsageApi";
import {
  buildFuelUsageBalanceIndex,
  fuelRowRemainingLitres,
  normalizeFuelKind,
} from "@/features/fleet/lib/fuelUsageBalance";
import { formatDateDisplay } from "@/shared/lib/format/date";
import { stripDecimalGrouping } from "@/shared/lib/format/number";

export type FuelUsageExportKind = "usage" | "imports" | "openings";

export type FuelUsageExportFilter = {
  farmIds: string[];
  dateFrom: string;
  dateTo: string;
  kinds: FuelUsageExportKind[];
};

export type FuelUsageDetailExportLabels = {
  date: string;
  vehicle: string;
  farm: string;
  fuelKind: string;
  litres: string;
  remaining: string;
  costPerLitre: string;
  cost: string;
  odometer: string;
  operator: string;
  purpose: string;
  notes: string;
};

export type FuelUsageImportExportLabels = {
  date: string;
  line: string;
  farm: string;
  fuelKind: string;
  importQty: string;
  importAmount: string;
  unitCost: string;
  notes: string;
};

export type FuelUsageOpeningExportLabels = {
  date: string;
  farm: string;
  fuelKind: string;
  openingQty: string;
  notes: string;
};

export type FuelUsageDetailExportRow = {
  fuel_date: string;
  vehicle: string;
  farm: string;
  fuel_kind: string;
  litres: number | null;
  remaining_litres: number | null;
  cost_per_litre: number | null;
  cost: number | null;
  odometer_km: number | null;
  operator: string;
  purpose: string;
  notes: string;
};

export type FuelUsageImportExportRow = {
  import_date: string;
  line_no: number;
  farm: string;
  fuel_kind: string;
  import_qty: number | null;
  import_amount: number | null;
  unit_cost: number | null;
  notes: string;
};

export type FuelUsageOpeningExportRow = {
  opening_date: string;
  farm: string;
  fuel_kind: string;
  opening_qty: number | null;
  notes: string;
};

export type FuelUsageExportBundle = {
  usageRows: FuelUsageDetailExportRow[];
  importRows: FuelUsageImportExportRow[];
  openingRows: FuelUsageOpeningExportRow[];
};

export type FuelUsageExportSheetLabels = {
  usage: FuelUsageDetailExportLabels;
  imports: FuelUsageImportExportLabels;
  openings: FuelUsageOpeningExportLabels;
  sheetNames: {
    usage: string;
    imports: string;
    openings: string;
  };
};

const USAGE_COLUMN_KEYS: (keyof FuelUsageDetailExportLabels)[] = [
  "date",
  "vehicle",
  "farm",
  "fuelKind",
  "litres",
  "remaining",
  "costPerLitre",
  "cost",
  "odometer",
  "operator",
  "purpose",
  "notes",
];

const IMPORT_COLUMN_KEYS: (keyof FuelUsageImportExportLabels)[] = [
  "date",
  "line",
  "farm",
  "fuelKind",
  "importQty",
  "importAmount",
  "unitCost",
  "notes",
];

const OPENING_COLUMN_KEYS: (keyof FuelUsageOpeningExportLabels)[] = [
  "date",
  "farm",
  "fuelKind",
  "openingQty",
  "notes",
];

function toNumber(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(stripDecimalGrouping(String(raw)));
  return Number.isFinite(n) ? n : null;
}

function dateYmd(raw: unknown): string {
  return String(raw ?? "").trim().slice(0, 10);
}

function isOpeningAnchor(row: FleetStockLedgerRow): boolean {
  return Number(row.is_opening_anchor) === 1 || row.is_opening_anchor === true;
}

function escapeCsv(value: string | number): string {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadCsvMatrix(matrix: (string | number)[][], fileName: string): void {
  const lines = matrix.map((row) => row.map((cell) => escapeCsv(cell)).join(","));
  const csv = `\uFEFF${lines.join("\n")}`;
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), fileName);
}

export function buildFuelUsageDetailExportRows(
  rows: FuelUsageRow[],
  opts: {
    vehicleLabel: (row: FuelUsageRow) => string;
    farmLabel: (row: FuelUsageRow) => string;
    fuelKindLabel: (row: FuelUsageRow) => string;
    remainingLitres: (row: FuelUsageRow) => number | null;
  },
): FuelUsageDetailExportRow[] {
  return rows.map((row) => {
    const litres = toNumber(row.litres);
    const costPerLitre = toNumber(row.cost_per_litre);
    const cost =
      litres != null && costPerLitre != null && litres > 0 && costPerLitre > 0
        ? litres * costPerLitre
        : null;
    const purpose = String(row.purpose ?? "").trim();
    return {
      fuel_date: dateYmd(row.fuel_date),
      vehicle: opts.vehicleLabel(row),
      farm: opts.farmLabel(row),
      fuel_kind: opts.fuelKindLabel(row),
      litres,
      remaining_litres: opts.remainingLitres(row),
      cost_per_litre: costPerLitre != null && costPerLitre > 0 ? costPerLitre : null,
      cost: cost != null && cost > 0 ? cost : null,
      odometer_km: row.odometer_km != null ? Number(row.odometer_km) : null,
      operator: String(row.operator_name ?? "").trim(),
      purpose,
      notes: purpose,
    };
  });
}

/**
 * One Excel row per import line. Same-day multiple imports get Line # 1, 2, 3…
 * within farm + fuel type + date.
 */
export function buildFuelUsageImportExportRows(
  rows: FleetFuelImportRow[],
  opts: {
    farmLabel: (farmId: number) => string;
    fuelKindLabel: (fuelKind: string) => string;
  },
): FuelUsageImportExportRow[] {
  const sorted = [...rows].sort((a, b) => {
    const dateCmp = dateYmd(a.import_date).localeCompare(dateYmd(b.import_date));
    if (dateCmp !== 0) return dateCmp;
    const farmCmp = Number(a.farm_id) - Number(b.farm_id);
    if (farmCmp !== 0) return farmCmp;
    const kindCmp = String(a.fuel_kind).localeCompare(String(b.fuel_kind));
    if (kindCmp !== 0) return kindCmp;
    return Number(a.id) - Number(b.id);
  });

  const lineByGroup = new Map<string, number>();
  return sorted.map((row) => {
    const importDate = dateYmd(row.import_date);
    const groupKey = `${Number(row.farm_id)}|${String(row.fuel_kind).toLowerCase()}|${importDate}`;
    const lineNo = (lineByGroup.get(groupKey) ?? 0) + 1;
    lineByGroup.set(groupKey, lineNo);

    const qty = toNumber(row.import_qty);
    const amount = toNumber(row.import_amount);
    const unitCost =
      qty != null && qty > 0 && amount != null && Number.isFinite(amount)
        ? amount / qty
        : null;

    return {
      import_date: importDate,
      line_no: lineNo,
      farm: opts.farmLabel(Number(row.farm_id)),
      fuel_kind: opts.fuelKindLabel(String(row.fuel_kind ?? "")),
      import_qty: qty,
      import_amount: amount,
      unit_cost: unitCost,
      notes: String(row.notes ?? "").trim(),
    };
  });
}

export function buildFuelUsageOpeningExportRows(
  ledgerRows: FleetStockLedgerRow[],
  opts: {
    farmLabel: (farmId: number) => string;
    fuelKindLabel: (fuelKind: string) => string;
  },
): FuelUsageOpeningExportRow[] {
  return ledgerRows
    .filter(isOpeningAnchor)
    .map((row) => ({
      opening_date: dateYmd(row.balance_date),
      farm: opts.farmLabel(Number(row.farm_id)),
      fuel_kind: opts.fuelKindLabel(String(row.stock_key ?? "")),
      opening_qty: toNumber(row.opening_qty),
      notes: String(row.notes ?? "").trim(),
    }))
    .sort((a, b) => {
      const dateCmp = a.opening_date.localeCompare(b.opening_date);
      if (dateCmp !== 0) return dateCmp;
      const farmCmp = a.farm.localeCompare(b.farm);
      if (farmCmp !== 0) return farmCmp;
      return a.fuel_kind.localeCompare(b.fuel_kind);
    });
}

function cellText(value: string | number | null | undefined): string | number {
  if (value == null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? value : "";
  return value;
}

export function buildFuelUsageDetailMatrix(
  rows: FuelUsageDetailExportRow[],
  labels: FuelUsageDetailExportLabels,
): (string | number)[][] {
  const header = USAGE_COLUMN_KEYS.map((key) => labels[key]);
  const body = rows.map((row) => [
    formatDateDisplay(row.fuel_date),
    row.vehicle,
    row.farm,
    row.fuel_kind,
    cellText(row.litres),
    cellText(row.remaining_litres),
    cellText(row.cost_per_litre),
    cellText(row.cost),
    cellText(row.odometer_km),
    row.operator,
    row.purpose,
    row.notes,
  ]);
  return [header, ...body];
}

export function buildFuelUsageImportMatrix(
  rows: FuelUsageImportExportRow[],
  labels: FuelUsageImportExportLabels,
): (string | number)[][] {
  const header = IMPORT_COLUMN_KEYS.map((key) => labels[key]);
  const body = rows.map((row) => [
    formatDateDisplay(row.import_date),
    row.line_no,
    row.farm,
    row.fuel_kind,
    cellText(row.import_qty),
    cellText(row.import_amount),
    cellText(row.unit_cost),
    row.notes,
  ]);
  return [header, ...body];
}

export function buildFuelUsageOpeningMatrix(
  rows: FuelUsageOpeningExportRow[],
  labels: FuelUsageOpeningExportLabels,
): (string | number)[][] {
  const header = OPENING_COLUMN_KEYS.map((key) => labels[key]);
  const body = rows.map((row) => [
    formatDateDisplay(row.opening_date),
    row.farm,
    row.fuel_kind,
    cellText(row.opening_qty),
    row.notes,
  ]);
  return [header, ...body];
}

export function buildFuelUsageDetailFileName(opts?: {
  dateFrom?: string | null;
  dateTo?: string | null;
  ext?: "xlsx" | "csv";
}): string {
  const from = String(opts?.dateFrom ?? "").slice(0, 10);
  const to = String(opts?.dateTo ?? "").slice(0, 10);
  const ext = opts?.ext ?? "xlsx";
  if (from && to && from === to) {
    return `Fuel-Usage-${from}.${ext}`;
  }
  if (from && to) {
    return `Fuel-Usage-${from}_to_${to}.${ext}`;
  }
  const today = new Date().toISOString().slice(0, 10);
  return `Fuel-Usage-${today}.${ext}`;
}

function styleHeaderRow(ws: ExcelJS.Worksheet): void {
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.commit();
}

function addMatrixSheet(
  wb: ExcelJS.Workbook,
  name: string,
  matrix: (string | number)[][],
  widths: number[],
  numberCols: { index: number; numFmt: string }[],
): void {
  const ws = wb.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  for (const row of matrix) {
    ws.addRow(row);
  }
  styleHeaderRow(ws);
  widths.forEach((width, index) => {
    ws.getColumn(index + 1).width = width;
  });
  for (const col of numberCols) {
    ws.getColumn(col.index).numFmt = col.numFmt;
  }
}

export type FuelUsageWorkbookExportInput = {
  usageRows: FuelUsageDetailExportRow[];
  usageLabels: FuelUsageDetailExportLabels;
  importRows: FuelUsageImportExportRow[];
  importLabels: FuelUsageImportExportLabels;
  openingRows: FuelUsageOpeningExportRow[];
  openingLabels: FuelUsageOpeningExportLabels;
  fileName: string;
  include?: Partial<Record<FuelUsageExportKind, boolean>>;
  sheetNames?: {
    usage?: string;
    imports?: string;
    openings?: string;
  };
};

function shouldInclude(
  include: FuelUsageWorkbookExportInput["include"],
  kind: FuelUsageExportKind,
): boolean {
  if (!include) return true;
  return include[kind] !== false;
}

export async function exportFuelUsageDetailToXlsx(
  payload: FuelUsageWorkbookExportInput,
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "STS Turf Ops";

  if (shouldInclude(payload.include, "usage")) {
    addMatrixSheet(
      wb,
      payload.sheetNames?.usage ?? "Usage",
      buildFuelUsageDetailMatrix(payload.usageRows, payload.usageLabels),
      [14, 36, 16, 12, 12, 14, 14, 12, 12, 18, 22, 28],
      [
        { index: 5, numFmt: "0.###" },
        { index: 6, numFmt: "0.###" },
        { index: 7, numFmt: "0.00##" },
        { index: 8, numFmt: "0.00##" },
        { index: 9, numFmt: "0.###" },
      ],
    );
  }

  if (shouldInclude(payload.include, "imports")) {
    addMatrixSheet(
      wb,
      payload.sheetNames?.imports ?? "Imports",
      buildFuelUsageImportMatrix(payload.importRows, payload.importLabels),
      [14, 10, 16, 12, 12, 14, 14, 28],
      [
        { index: 2, numFmt: "0" },
        { index: 5, numFmt: "0.###" },
        { index: 6, numFmt: "0.00##" },
        { index: 7, numFmt: "0.00##" },
      ],
    );
  }

  if (shouldInclude(payload.include, "openings")) {
    addMatrixSheet(
      wb,
      payload.sheetNames?.openings ?? "Opening balances",
      buildFuelUsageOpeningMatrix(payload.openingRows, payload.openingLabels),
      [14, 16, 12, 14, 28],
      [{ index: 4, numFmt: "0.###" }],
    );
  }

  if (wb.worksheets.length === 0) {
    throw new Error("No export sheets selected.");
  }

  const buffer = await wb.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    payload.fileName.endsWith(".xlsx") ? payload.fileName : `${payload.fileName}.xlsx`,
  );
}

export function exportFuelUsageDetailToCsv(payload: FuelUsageWorkbookExportInput): void {
  const base = payload.fileName.replace(/\.xlsx$/i, "").replace(/\.csv$/i, "");
  const parts: Array<{ kind: FuelUsageExportKind; matrix: (string | number)[][] }> = [];

  if (shouldInclude(payload.include, "usage")) {
    parts.push({
      kind: "usage",
      matrix: buildFuelUsageDetailMatrix(payload.usageRows, payload.usageLabels),
    });
  }
  if (shouldInclude(payload.include, "imports")) {
    parts.push({
      kind: "imports",
      matrix: buildFuelUsageImportMatrix(payload.importRows, payload.importLabels),
    });
  }
  if (shouldInclude(payload.include, "openings")) {
    parts.push({
      kind: "openings",
      matrix: buildFuelUsageOpeningMatrix(payload.openingRows, payload.openingLabels),
    });
  }
  if (parts.length === 0) {
    throw new Error("No export sheets selected.");
  }

  if (parts.length === 1) {
    downloadCsvMatrix(parts[0]!.matrix, `${base}.csv`);
    return;
  }

  // Multiple kinds → one CSV with section headers so they stay in a single file.
  const combined: (string | number)[][] = [];
  for (const part of parts) {
    const title =
      part.kind === "usage"
        ? payload.sheetNames?.usage ?? "Usage"
        : part.kind === "imports"
          ? payload.sheetNames?.imports ?? "Imports"
          : payload.sheetNames?.openings ?? "Opening balances";
    if (combined.length > 0) combined.push([]);
    combined.push([title]);
    combined.push(...part.matrix);
  }
  downloadCsvMatrix(combined, `${base}.csv`);
}

export async function exportFuelUsageDetailToGoogleSheet(
  payload: FuelUsageWorkbookExportInput,
): Promise<{
  ok: boolean;
  message?: string;
  needsAuth?: boolean;
  authorizePath?: string;
  spreadsheetUrl?: string;
}> {
  const tabs: Array<{
    sheetTabName: string;
    headers: (string | number)[];
    rows: (string | number)[][];
  }> = [];

  if (shouldInclude(payload.include, "usage")) {
    const matrix = buildFuelUsageDetailMatrix(payload.usageRows, payload.usageLabels);
    const [headers, ...rows] = matrix;
    tabs.push({
      sheetTabName: payload.sheetNames?.usage ?? "Usage",
      headers: headers ?? [],
      rows,
    });
  }
  if (shouldInclude(payload.include, "imports")) {
    const matrix = buildFuelUsageImportMatrix(payload.importRows, payload.importLabels);
    const [headers, ...rows] = matrix;
    tabs.push({
      sheetTabName: payload.sheetNames?.imports ?? "Imports",
      headers: headers ?? [],
      rows,
    });
  }
  if (shouldInclude(payload.include, "openings")) {
    const matrix = buildFuelUsageOpeningMatrix(payload.openingRows, payload.openingLabels);
    const [headers, ...rows] = matrix;
    tabs.push({
      sheetTabName: payload.sheetNames?.openings ?? "Opening balances",
      headers: headers ?? [],
      rows,
    });
  }
  if (tabs.length === 0) {
    return { ok: false, message: "No export sheets selected." };
  }

  const first = tabs[0]!;
  const spreadsheetTitle = payload.fileName.replace(/\.xlsx$/i, "").replace(/\.csv$/i, "");

  const res = await fetch("/api/projects/export/google-sheet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      headers: first.headers,
      rows: first.rows,
      sheetTabName: first.sheetTabName,
      spreadsheetTitle,
      tabs,
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

export async function fetchFuelUsageExportBundle(
  filter: FuelUsageExportFilter,
  opts: {
    farmNameById: ReadonlyMap<string, string> | Record<string, string>;
    vehicleLabelByInspectionId?: ReadonlyMap<string, string> | Record<string, string>;
    fuelKindLabelByValue: Record<string, string>;
    fuelKindFallback: { diesel: string; petrol: string };
  },
): Promise<FuelUsageExportBundle> {
  const farmIdsParam =
    filter.farmIds.length > 0 ? filter.farmIds.join(",") : undefined;
  const dateFrom = dateYmd(filter.dateFrom);
  const dateTo = dateYmd(filter.dateTo);
  const includeUsage = filter.kinds.includes("usage");
  const includeImports = filter.kinds.includes("imports");
  const includeOpenings = filter.kinds.includes("openings");

  const farmNameMap =
    opts.farmNameById instanceof Map
      ? opts.farmNameById
      : new Map(Object.entries(opts.farmNameById));

  const farmName = (farmId: number | string) => {
    const key = String(farmId);
    return farmNameMap.get(key) ?? key;
  };

  const [usageSource, importSource, ledgerSource, balanceUsage] = await Promise.all([
    includeUsage
      ? fetchFuelUsage({
          farm_ids: farmIdsParam,
          fuel_from: dateFrom || undefined,
          fuel_to: dateTo || undefined,
        })
      : Promise.resolve([] as FuelUsageRow[]),
    includeImports
      ? fetchFleetFuelImports({
          farm_ids: farmIdsParam,
          import_from: dateFrom || undefined,
          import_to: dateTo || undefined,
        })
      : Promise.resolve([] as FleetFuelImportRow[]),
    includeOpenings || includeUsage
      ? fetchFleetStockLedger({
          module: "fuel",
          farm_ids: farmIdsParam,
        })
      : Promise.resolve([] as FleetStockLedgerRow[]),
    includeUsage
      ? fetchFuelUsage({ farm_ids: farmIdsParam })
      : Promise.resolve([] as FuelUsageRow[]),
  ]);

  const selectedFarmSet =
    filter.farmIds.length > 0 ? new Set(filter.farmIds.map(String)) : null;

  const usageFiltered = usageSource.filter((row) => {
    if (selectedFarmSet && !selectedFarmSet.has(String(row.farm_id))) return false;
    const d = dateYmd(row.fuel_date);
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  });

  const importsFiltered = importSource.filter((row) => {
    if (selectedFarmSet && !selectedFarmSet.has(String(row.farm_id))) return false;
    const d = dateYmd(row.import_date);
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  });

  const openingsFiltered = ledgerSource.filter((row) => {
    if (!isOpeningAnchor(row)) return false;
    if (selectedFarmSet && !selectedFarmSet.has(String(row.farm_id))) return false;
    if (dateTo) {
      const d = dateYmd(row.balance_date);
      if (d > dateTo) return false;
    }
    return true;
  });

  const balanceIndex = buildFuelUsageBalanceIndex({
    ledgerRows: ledgerSource,
    usageRows: balanceUsage,
    farmNameById: new Map(farmNameMap),
    fuelLabelByKind: opts.fuelKindLabelByValue,
  });

  return {
    usageRows: includeUsage
      ? buildFuelUsageDetailExportRows(usageFiltered, {
          vehicleLabel: (row) =>
            fuelUsageVehicleLabel(row, opts.vehicleLabelByInspectionId),
          farmLabel: (row) =>
            String(row.farm_name ?? farmName(row.farm_id) ?? row.farm_id ?? ""),
          fuelKindLabel: (row) =>
            fuelUsageFuelKindLabel(
              row.fuel_kind,
              opts.fuelKindLabelByValue,
              opts.fuelKindFallback,
            ),
          remainingLitres: (row) => fuelRowRemainingLitres(row, balanceIndex),
        })
      : [],
    importRows: includeImports
      ? buildFuelUsageImportExportRows(importsFiltered, {
          farmLabel: (id) => farmName(id),
          fuelKindLabel: (fuelKind) =>
            fuelUsageFuelKindLabel(
              normalizeFuelKind(fuelKind) ?? fuelKind,
              opts.fuelKindLabelByValue,
              opts.fuelKindFallback,
            ),
        })
      : [],
    openingRows: includeOpenings
      ? buildFuelUsageOpeningExportRows(openingsFiltered, {
          farmLabel: (id) => farmName(id),
          fuelKindLabel: (fuelKind) =>
            fuelUsageFuelKindLabel(
              normalizeFuelKind(fuelKind) ?? fuelKind,
              opts.fuelKindLabelByValue,
              opts.fuelKindFallback,
            ),
        })
      : [],
  };
}
