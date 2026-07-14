import ExcelJS from "exceljs";

import type { FuelUsageRow } from "@/features/fleet/api/fuelUsageApi";
import { formatDateDisplay } from "@/shared/lib/format/date";
import { stripDecimalGrouping } from "@/shared/lib/format/number";

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
};

const COLUMN_KEYS: (keyof FuelUsageDetailExportLabels)[] = [
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
];

function toNumber(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(stripDecimalGrouping(String(raw)));
  return Number.isFinite(n) ? n : null;
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
    return {
      fuel_date: String(row.fuel_date ?? "").slice(0, 10),
      vehicle: opts.vehicleLabel(row),
      farm: opts.farmLabel(row),
      fuel_kind: opts.fuelKindLabel(row),
      litres,
      remaining_litres: opts.remainingLitres(row),
      cost_per_litre: costPerLitre != null && costPerLitre > 0 ? costPerLitre : null,
      cost: cost != null && cost > 0 ? cost : null,
      odometer_km: row.odometer_km != null ? Number(row.odometer_km) : null,
      operator: String(row.operator_name ?? "").trim(),
      purpose: String(row.purpose ?? "").trim(),
    };
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
  const header = COLUMN_KEYS.map((key) => labels[key]);
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
  ]);
  return [header, ...body];
}

export function buildFuelUsageDetailFileName(opts?: {
  dateFrom?: string | null;
  dateTo?: string | null;
}): string {
  const from = String(opts?.dateFrom ?? "").slice(0, 10);
  const to = String(opts?.dateTo ?? "").slice(0, 10);
  if (from && to && from === to) {
    return `Fuel-Usage-Detail-${from}.xlsx`;
  }
  if (from && to) {
    return `Fuel-Usage-Detail-${from}_to_${to}.xlsx`;
  }
  const today = new Date().toISOString().slice(0, 10);
  return `Fuel-Usage-Detail-${today}.xlsx`;
}

export async function exportFuelUsageDetailToXlsx(
  rows: FuelUsageDetailExportRow[],
  labels: FuelUsageDetailExportLabels,
  fileName: string,
): Promise<void> {
  const matrix = buildFuelUsageDetailMatrix(rows, labels);
  const wb = new ExcelJS.Workbook();
  wb.creator = "STS Turf Ops";
  const ws = wb.addWorksheet("Fuel Usage Detail", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  for (const row of matrix) {
    ws.addRow(row);
  }

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.commit();

  const widths = [14, 36, 16, 12, 12, 14, 14, 12, 12, 18, 28];
  widths.forEach((width, index) => {
    ws.getColumn(index + 1).width = width;
  });

  for (const col of [5, 6, 7, 8, 9]) {
    ws.getColumn(col).numFmt = col === 7 || col === 8 ? "0.00##" : "0.###";
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
