import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import { stsProxyGetWithParams } from "@/shared/api/stsProxyClient";
import type { ProjectListGoogleSheetExportPayload } from "@/features/project/lib/projectListExport";
import { exportFuelDiaryStyledXlsx } from "@/features/fleet/lib/fuelDiaryExcelExport";

export type FuelDiaryRowMeta =
  | "title"
  | "date_header"
  | "units"
  | "section_diesel"
  | "section_petrol"
  | "vehicle"
  | "section_total"
  | "import_diesel"
  | "import_petrol"
  | "remaining"
  | "blank"
  | "data";

export type FuelDiaryReportSheet = {
  matrix: unknown[][];
  row_meta?: FuelDiaryRowMeta[];
  farm_name: string;
  period_label: string;
  date_from: string;
  date_to: string;
  days_per_block?: number;
  total_col_index?: number;
};

export type FuelDiaryReportData = {
  matrix: unknown[][];
  row_meta?: FuelDiaryRowMeta[];
  sheets?: FuelDiaryReportSheet[];
  farm_name: string;
  farm_names?: string[];
  period_label: string;
  date_from: string;
  date_to: string;
  days_per_block?: number;
  total_col_index?: number;
};

export type FuelDiaryReportParams = {
  farm_id?: number;
  farm_ids?: string;
  fuel_from?: string;
  fuel_to?: string;
  locale?: string;
};

export async function fetchFuelDiaryReport(
  params: FuelDiaryReportParams,
): Promise<FuelDiaryReportData> {
  return stsProxyGetWithParams<FuelDiaryReportData>(STS_API_PATHS.fuelUsageDiaryReport, params);
}

export function buildFuelDiaryExportFileName(
  farmName: string,
  periodLabel: string,
  format: "csv" | "xlsx",
): string {
  const safeFarm = farmName.replace(/[^\w\-]+/g, "-").replace(/-+/g, "-") || "farm";
  const safePeriod = periodLabel.replace(/[^\w\-]+/g, "-") || "period";
  return `PETROL-DIESEL-REPORT-${safeFarm}-${safePeriod}.${format}`;
}

function matrixToRows(matrix: unknown[][]): { headers: unknown[]; rows: unknown[][] } {
  if (matrix.length === 0) {
    return { headers: [], rows: [] };
  }
  return { headers: matrix[0] ?? [], rows: matrix.slice(1) };
}

export function exportFuelDiaryToCsv(matrix: unknown[][], fileName: string): void {
  if (matrix.length === 0) return;

  const escapeCsv = (v: unknown) => {
    const s = v == null ? "" : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const lines = matrix.map((row) => row.map((cell) => escapeCsv(cell)).join(","));
  const csv = `\uFEFF${lines.join("\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportFuelDiaryToXlsx(
  data: FuelDiaryReportData,
  fileName: string,
  sheetName: string,
): Promise<void> {
  const sheets =
    data.sheets && data.sheets.length > 0
      ? data.sheets
      : data.matrix.length > 0
        ? [
            {
              matrix: data.matrix,
              row_meta: data.row_meta,
              farm_name: data.farm_name || sheetName,
              period_label: data.period_label,
            },
          ]
        : [];

  await exportFuelDiaryStyledXlsx({ sheets, fileName, sheetName });
}

export async function exportFuelDiaryToGoogleSheet(opts: {
  matrix: unknown[][];
  sheetTabName?: string;
}): Promise<{
  ok: boolean;
  message?: string;
  needsAuth?: boolean;
  authorizePath?: string;
  spreadsheetUrl?: string;
}> {
  const { matrix } = opts;
  if (matrix.length === 0) {
    return { ok: false, message: "No data to export." };
  }

  const { headers, rows } = matrixToRows(matrix);
  const payload: ProjectListGoogleSheetExportPayload = {
    headers: headers.map((h) => (h == null ? "" : String(h))),
    rows: rows.map((row) => row.map((cell) => (cell == null ? "" : String(cell)))),
    sheetTabName: opts.sheetTabName ?? "Fuel Diary",
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
      message: data.message ?? `Google Sheet export failed (${res.status}).`,
    };
  }
  return {
    ok: true,
    message: data.message,
    spreadsheetUrl: data.spreadsheetUrl,
  };
}
