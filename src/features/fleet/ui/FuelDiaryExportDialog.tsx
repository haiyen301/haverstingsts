"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Download, ExternalLink, FileSpreadsheet, Loader2, Sheet } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";

import {
  buildFuelDiaryExportFileName,
  exportFuelDiaryToCsv,
  exportFuelDiaryToGoogleSheet,
  exportFuelDiaryToXlsx,
  fetchFuelDiaryReport,
  type FuelDiaryReportData,
} from "@/features/fleet/lib/fuelDiaryExport";
import { cn } from "@/lib/utils";
import { MultiSelect } from "@/shared/ui/multi-select";

type ExportFormat = "csv" | "xlsx" | "google_sheet";

export type FuelDiaryFarmOption = {
  id: string;
  label: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  farmOptions: FuelDiaryFarmOption[];
  initialFarmIds?: string[];
  initialDateFrom?: string;
  initialDateTo?: string;
};

const inputClass =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";
const selectClass = "h-9 w-full rounded-md border border-input bg-background text-sm shadow-sm";
const actionBtnClass =
  "inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md border border-border px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
const selectChevron = <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />;

function localDateYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function FuelDiaryExportDialog({
  open,
  onClose,
  farmOptions,
  initialFarmIds = [],
  initialDateFrom,
  initialDateTo,
}: Props) {
  const t = useTranslations("FuelUsage");
  const locale = useLocale();
  const [farmIds, setFarmIds] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState(() => localDateYmd(new Date()));
  const [dateTo, setDateTo] = useState(() => localDateYmd(new Date()));
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [report, setReport] = useState<FuelDiaryReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [googleSheetConfigured, setGoogleSheetConfigured] = useState(false);
  const [googleSheetConnected, setGoogleSheetConnected] = useState(false);
  const [lastSpreadsheetUrl, setLastSpreadsheetUrl] = useState<string | null>(null);

  const farmSelectOptions = useMemo(
    () => farmOptions.map((farm) => ({ value: farm.id, label: farm.label })),
    [farmOptions],
  );

  useEffect(() => {
    if (!open) return;
    const today = new Date();
    const firstDay = localDateYmd(new Date(today.getFullYear(), today.getMonth(), 1));
    const lastDay = localDateYmd(new Date(today.getFullYear(), today.getMonth() + 1, 0));
    setDateFrom(initialDateFrom || firstDay);
    setDateTo(initialDateTo || lastDay);

    const validInitial = initialFarmIds.filter((id) => farmOptions.some((f) => f.id === id));
    setFarmIds(
      validInitial.length > 0 ? validInitial : farmOptions.map((farm) => farm.id),
    );
    setFormat("xlsx");
    setReport(null);
    setError(null);
    setProgressMessage(null);
    setLastSpreadsheetUrl(null);
  }, [open, initialFarmIds, initialDateFrom, initialDateTo, farmOptions]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetch("/api/projects/export/google-sheet", { method: "GET", credentials: "include" })
      .then((res) => (res.ok ? res.json() : { configured: false, connected: false }))
      .then((data: { configured?: boolean; connected?: boolean }) => {
        if (!cancelled) {
          setGoogleSheetConfigured(Boolean(data.configured));
          setGoogleSheetConnected(Boolean(data.connected));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGoogleSheetConfigured(false);
          setGoogleSheetConnected(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const loadReport = useCallback(async () => {
    const ids = farmIds
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (ids.length === 0 || !dateFrom || !dateTo) {
      setError(t("export.errors.farmRequired"));
      return null;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchFuelDiaryReport({
        farm_ids: ids.join(","),
        fuel_from: dateFrom,
        fuel_to: dateTo,
        locale,
      });
      setReport(data);
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("export.errors.load"));
      return null;
    } finally {
      setLoading(false);
    }
  }, [farmIds, dateFrom, dateTo, locale, t]);

  useEffect(() => {
    if (!open) return;
    void loadReport();
  }, [open, loadReport]);

  const runGoogleExport = useCallback(async (matrix: unknown[][]) => {
    setProgressMessage(t("export.exportGoogleSheetUploading"));
    const result = await exportFuelDiaryToGoogleSheet({
      matrix,
      sheetTabName: report?.period_label?.slice(0, 31) ?? "Fuel Diary",
    });
    if (result.needsAuth && result.authorizePath) {
      window.location.href = result.authorizePath;
      return;
    }
    if (!result.ok) {
      throw new Error(result.message ?? t("export.exportGoogleSheetFailed"));
    }
    setLastSpreadsheetUrl(result.spreadsheetUrl ?? null);
  }, [report?.period_label, t]);

  const onExport = async () => {
    setExporting(true);
    setError(null);
    setProgressMessage(null);
    try {
      const data = report ?? (await loadReport());
      const sheetCount = data?.sheets?.length ?? 0;
      const rowCount =
        sheetCount > 0
          ? (data?.sheets ?? []).reduce((total, sheet) => total + (sheet.matrix?.length ?? 0), 0)
          : (data?.matrix?.length ?? 0);
      if (!data || rowCount === 0) {
        setError(t("export.errors.empty"));
        return;
      }

      const fileName = buildFuelDiaryExportFileName(
        data.farm_name,
        data.period_label,
        format === "csv" ? "csv" : "xlsx",
      );

      if (format === "xlsx") {
        setProgressMessage(t("export.exportExcelPreparing"));
        await exportFuelDiaryToXlsx(
          data,
          fileName,
          data.period_label || "Fuel Diary",
        );
        onClose();
        return;
      }

      const exportMatrix =
        data.sheets && data.sheets.length === 1
          ? data.sheets[0].matrix
          : data.matrix;

      if (format === "csv") {
        exportFuelDiaryToCsv(exportMatrix, fileName);
        onClose();
        return;
      }

      if (!googleSheetConnected) {
        window.location.href = "/api/projects/export/google-sheet/oauth/authorize";
        return;
      }

      await runGoogleExport(exportMatrix);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("export.errors.export"));
    } finally {
      setExporting(false);
      setProgressMessage(null);
    }
  };

  if (!open) return null;

  const formatBtnClass = (active: boolean) =>
    cn(
      actionBtnClass,
      active && "border-primary bg-primary/10 text-primary",
    );

  const previewRowCount =
    (report?.sheets?.length ?? 0) > 0
      ? (report?.sheets ?? []).reduce((total, sheet) => total + (sheet.matrix?.length ?? 0), 0)
      : (report?.matrix?.length ?? 0);

  const previewFarmLabel =
    (report?.farm_names?.length ?? 0) > 1
      ? t("export.previewFarms", { count: report?.farm_names?.length ?? farmIds.length })
      : (report?.farm_name ?? "");

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-background p-6 shadow-lg">
        <h2 className="text-lg font-semibold">{t("export.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("export.subtitle")}</p>

        <div className="mt-4 grid gap-4">
          <label className="space-y-1">
            <span className="text-xs font-medium">{t("stock.farm")}</span>
            <MultiSelect
              options={farmSelectOptions}
              values={farmIds}
              onChange={setFarmIds}
              placeholder={t("export.selectFarms")}
              className={selectClass}
              rightIcon={selectChevron}
              selectionSummary="compact"
              showSelectedChipsInPopover
              formatSelectedCount={(count) => t("export.farmsSelected", { count })}
            />
          </label>
          <div className="grid w-full grid-cols-2 gap-3">
            <label className="flex min-w-0 flex-col gap-1">
              <span className="text-xs font-medium">{t("export.dateFrom")}</span>
              <input
                type="date"
                className={cn(inputClass, "block max-w-none [&::-webkit-date-and-time-value]:text-left")}
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1">
              <span className="text-xs font-medium">{t("export.dateTo")}</span>
              <input
                type="date"
                className={cn(inputClass, "block max-w-none [&::-webkit-date-and-time-value]:text-left")}
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={formatBtnClass(format === "csv")} onClick={() => setFormat("csv")}>
            <Download className="mr-1.5 h-4 w-4" />
            CSV
          </button>
          <button type="button" className={formatBtnClass(format === "xlsx")} onClick={() => setFormat("xlsx")}>
            <FileSpreadsheet className="mr-1.5 h-4 w-4" />
            Excel
          </button>
          <button
            type="button"
            className={formatBtnClass(format === "google_sheet")}
            onClick={() => setFormat("google_sheet")}
            disabled={!googleSheetConfigured}
            title={!googleSheetConfigured ? t("export.exportGoogleSheetNotConfigured") : undefined}
          >
            <Sheet className="mr-1.5 h-4 w-4" />
            Google Sheet
          </button>
        </div>

        {loading ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("export.loadingPreview")}
          </p>
        ) : report ? (
          <p className="mt-4 text-sm text-muted-foreground">
            {t("export.previewReady", {
              farm: previewFarmLabel,
              from: report.date_from,
              to: report.date_to,
              rows: previewRowCount,
            })}
          </p>
        ) : null}

        {progressMessage ? (
          <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {progressMessage}
          </p>
        ) : null}

        {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}

        {lastSpreadsheetUrl ? (
          <a
            href={lastSpreadsheetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            <ExternalLink className="h-4 w-4" />
            {t("export.exportGoogleSheetOpen")}
          </a>
        ) : null}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className={actionBtnClass} onClick={onClose} disabled={exporting}>
            {t("dialog.cancel")}
          </button>
          <button
            type="button"
            className={cn(actionBtnClass, "border-primary bg-primary text-primary-foreground hover:bg-primary/90")}
            onClick={() => void onExport()}
            disabled={exporting || loading || farmIds.length === 0}
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            <span className="ml-1.5">{t("export.download")}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
