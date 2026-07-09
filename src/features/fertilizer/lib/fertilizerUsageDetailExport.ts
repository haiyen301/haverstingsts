import ExcelJS from "exceljs";

import {
  fetchFertilizerUsage,
  type FertilizerUsageRow,
} from "@/features/fertilizer/api/fertilizerUsageApi";
import type { FertilizerBalanceExportFilter } from "@/features/fertilizer/lib/fertilizerBalanceExport";
import {
  fertilizerBalancePeriodRangeLabel,
  type FertilizerBalanceYearMonth,
} from "@/features/fertilizer/lib/fertilizerBalanceWeeks";
import { farmAliasDisplayLabel } from "@/shared/lib/farmAliasDisplay";
import { formatDateDisplay } from "@/shared/lib/format/date";
import { formatNumber, stripDecimalGrouping } from "@/shared/lib/format/number";

export type FertilizerUsageExportKind = "summary" | "detail";

export type FertilizerUsageDetailColumnKey =
  | "date"
  | "farm"
  | "grass"
  | "zone"
  | "product"
  | "type"
  | "amount"
  | "remaining"
  | "rate"
  | "operator"
  | "notes";

export type FertilizerUsageDetailLabels = Record<FertilizerUsageDetailColumnKey, string> & {
  transferTo: string;
  consumption: string;
};

const COLUMN_KEYS: FertilizerUsageDetailColumnKey[] = [
  "date",
  "farm",
  "grass",
  "zone",
  "product",
  "type",
  "amount",
  "remaining",
  "rate",
  "operator",
  "notes",
];

function monthEndYmd(year: number, month: number): string {
  const endDay = new Date(year, month, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(endDay)}`;
}

function periodDateRange(filter: FertilizerBalanceExportFilter): { from: string; to: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    from: `${filter.fromYear}-${pad(filter.fromMonth)}-01`,
    to: monthEndYmd(filter.toYear, filter.toMonth),
  };
}

function isTransferUsageRow(row: Pick<FertilizerUsageRow, "is_transfer">): boolean {
  const v = row.is_transfer;
  return v === 1 || v === true || String(v) === "1";
}

function formatUsageRateDisplay(row: FertilizerUsageRow): string {
  const n = Number(stripDecimalGrouping(String(row.rate ?? "")));
  const uom = String(row.rate_uom ?? "").trim();
  if (!Number.isFinite(n) || n === 0) {
    return uom;
  }
  const rateText = formatNumber(n, { maximumFractionDigits: 3 });
  return uom ? `${rateText} ${uom}` : rateText;
}

function formatRemainingValue(row: FertilizerUsageRow): string {
  const raw = row.remaining_qty;
  if (raw == null || raw === "") return "";
  const n = Number(stripDecimalGrouping(String(raw)));
  if (!Number.isFinite(n)) return "";
  return formatNumber(n, { maximumFractionDigits: 3 });
}

function productLabel(row: FertilizerUsageRow): string {
  const productName = String(row.product_name ?? row.item_id ?? "");
  return farmAliasDisplayLabel(row.alias_name, productName, String(row.item_id));
}

function usageTypeLabel(row: FertilizerUsageRow, labels: FertilizerUsageDetailLabels): string {
  if (!isTransferUsageRow(row)) return labels.consumption;
  const farm = String(row.transfer_to_farm_name ?? row.transfer_to_farm_id ?? "").trim();
  return labels.transferTo.replace("{farm}", farm);
}

export function buildFertilizerUsageDetailMatrix(
  rows: FertilizerUsageRow[],
  labels: FertilizerUsageDetailLabels,
): string[][] {
  const header = COLUMN_KEYS.map((key) => labels[key]);
  const body = rows.map((row) => [
    formatDateDisplay(row.applied_date),
    String(row.farm_name ?? row.farm_id ?? ""),
    String(row.grass_name ?? row.grass_id ?? ""),
    String(row.zone_name ?? row.zone_id ?? ""),
    productLabel(row),
    usageTypeLabel(row, labels),
    formatNumber(Number(row.amount), { maximumFractionDigits: 3 }),
    formatRemainingValue(row),
    formatUsageRateDisplay(row),
    String(row.operator_name ?? row.operator_id ?? ""),
    String(row.notes ?? ""),
  ]);
  return [header, ...body];
}

export async function fetchFertilizerUsageDetailRows(
  filter: FertilizerBalanceExportFilter,
): Promise<FertilizerUsageRow[]> {
  if (filter.farms.length === 0) return [];
  const { from, to } = periodDateRange(filter);
  const rows = await fetchFertilizerUsage({
    farm_ids: filter.farms.map((farm) => String(farm.farmId)).join(","),
    applied_from: from,
    applied_to: to,
  });
  return [...rows].sort((a, b) => {
    const dateCmp = String(a.applied_date).localeCompare(String(b.applied_date));
    if (dateCmp !== 0) return dateCmp;
    return Number(a.id) - Number(b.id);
  });
}

export function resolveFertilizerUsageDetailExportFileName(
  farmNames: string[],
  from: FertilizerBalanceYearMonth,
  to: FertilizerBalanceYearMonth,
  format: "csv" | "xlsx",
): string {
  const rangeLabel = fertilizerBalancePeriodRangeLabel(from, to).replace(/[\\/:*?"<>|]+/g, "-");
  if (farmNames.length === 1) {
    const safeFarm = farmNames[0]!.trim().replace(/[\\/:*?"<>|]+/g, "-") || "Farm";
    return `${safeFarm} Fertilizer Usage Detail ${rangeLabel}.${format}`;
  }
  return `Fertilizer Usage Detail ${rangeLabel}.${format}`;
}

function downloadCsvBlob(csv: string, fileName: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportFertilizerUsageDetailToCsv(
  rows: FertilizerUsageRow[],
  labels: FertilizerUsageDetailLabels,
  fileName: string,
): void {
  const matrix = buildFertilizerUsageDetailMatrix(rows, labels);
  const escapeCsv = (v: string) => {
    if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  };
  const lines = matrix.map((row) => row.map(escapeCsv).join(","));
  downloadCsvBlob(`\uFEFF${lines.join("\n")}`, fileName);
}

export async function exportFertilizerUsageDetailToXlsx(
  rows: FertilizerUsageRow[],
  labels: FertilizerUsageDetailLabels,
  fileName: string,
): Promise<void> {
  const matrix = buildFertilizerUsageDetailMatrix(rows, labels);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Usage Detail");
  for (const row of matrix) {
    ws.addRow(row);
  }
  ws.getRow(1).font = { bold: true };
  COLUMN_KEYS.forEach((key, index) => {
    const col = ws.getColumn(index + 1);
    if (key === "product" || key === "notes") col.width = 28;
    else if (key === "farm" || key === "operator") col.width = 18;
    else col.width = 12;
  });

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportFertilizerUsageDetailToGoogleSheet(
  rows: FertilizerUsageRow[],
  labels: FertilizerUsageDetailLabels,
  spreadsheetTitle: string,
): Promise<{
  ok: boolean;
  message?: string;
  needsAuth?: boolean;
  authorizePath?: string;
  spreadsheetUrl?: string;
}> {
  const matrix = buildFertilizerUsageDetailMatrix(rows, labels);
  const [headers, ...dataRows] = matrix;

  const res = await fetch("/api/projects/export/google-sheet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      headers,
      rows: dataRows,
      sheetTabName: "Usage Detail",
      spreadsheetTitle,
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
