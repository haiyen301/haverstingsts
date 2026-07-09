"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, ExternalLink, FileSpreadsheet, Loader2, Sheet } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  exportFertilizerBalanceModelsToCsv,
  exportFertilizerBalanceModelsToGoogleSheet,
  exportFertilizerBalanceModelsToXlsx,
  resolveFertilizerBalanceExportFileName,
  type FertilizerBalanceExportFilter,
} from "@/features/fertilizer/lib/fertilizerBalanceExport";
import {
  exportFertilizerUsageDetailToCsv,
  exportFertilizerUsageDetailToGoogleSheet,
  exportFertilizerUsageDetailToXlsx,
  fetchFertilizerUsageDetailRows,
  resolveFertilizerUsageDetailExportFileName,
  type FertilizerUsageDetailLabels,
  type FertilizerUsageExportKind,
} from "@/features/fertilizer/lib/fertilizerUsageDetailExport";
import {
  clearPendingFertilizerGoogleSheetExport,
  readPendingFertilizerGoogleSheetExport,
  savePendingFertilizerGoogleSheetExport,
  startFertilizerGoogleSheetOAuth,
} from "@/features/fertilizer/lib/fertilizerBalanceGoogleSheetPending";
import {
  fetchFertilizerBalanceSheetModel,
  type FertilizerBalanceSheetModel,
} from "@/features/fertilizer/lib/fertilizerBalanceSheetData";
import {
  enumerateFertilizerBalanceMonths,
  FERTILIZER_BALANCE_MAX_EXPORT_MONTHS,
  FERTILIZER_BALANCE_MONTH_NAMES,
  fertilizerBalancePeriodRangeLabel,
} from "@/features/fertilizer/lib/fertilizerBalanceWeeks";
import { canAccessModule } from "@/shared/auth/permissions";
import { useAuthUserStore } from "@/shared/store/authUserStore";
import { MultiSelect } from "@/shared/ui/multi-select";
import { cn } from "@/lib/utils";
import { bgSurfaceFilter } from "@/shared/lib/surfaceFilter";

type ExportFormat = "csv" | "xlsx" | "google_sheet";

type Props = {
  open: boolean;
  onClose: () => void;
  farmOptions: Array<{ id: string; label: string }>;
  initialFarmIds: string[];
  initialYear: number;
  initialMonth: number;
  resumeGoogleSheetExport?: boolean;
  onResumeHandled?: () => void;
};

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground shadow-sm";

function buildYearOptions(anchorYear: number): number[] {
  const years: number[] = [];
  for (let y = anchorYear - 3; y <= anchorYear + 1; y += 1) years.push(y);
  return years;
}

function MonthYearFields({
  label,
  month,
  year,
  yearOptions,
  onMonthChange,
  onYearChange,
}: {
  label: string;
  month: number;
  year: number;
  yearOptions: number[];
  onMonthChange: (month: number) => void;
  onYearChange: (year: number) => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex gap-1.5">
        <select
          className={cn(selectClass, "min-w-0 flex-1")}
          value={month}
          onChange={(e) => onMonthChange(Number(e.target.value))}
        >
          {FERTILIZER_BALANCE_MONTH_NAMES.map((name, idx) => (
            <option key={name} value={idx + 1}>
              {name}
            </option>
          ))}
        </select>
        <select
          className={cn(selectClass, "w-[88px] shrink-0")}
          value={year}
          onChange={(e) => onYearChange(Number(e.target.value))}
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function FertilizerBalanceExportDialog({
  open,
  onClose,
  farmOptions,
  initialFarmIds,
  initialYear,
  initialMonth,
  resumeGoogleSheetExport = false,
  onResumeHandled,
}: Props) {
  const t = useTranslations("FertilizerUsage");
  const tHarvest = useTranslations("Harvest");
  const tCommon = useTranslations("Common");
  const user = useAuthUserStore((s) => s.user);
  const canExport = canAccessModule(user, "fertilizer_usage", "export");

  const [selectedFarmIds, setSelectedFarmIds] = useState<string[]>(initialFarmIds);
  const [fromYear, setFromYear] = useState(initialYear);
  const [fromMonth, setFromMonth] = useState(initialMonth);
  const [toYear, setToYear] = useState(initialYear);
  const [toMonth, setToMonth] = useState(initialMonth);
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [exportKind, setExportKind] = useState<FertilizerUsageExportKind>("summary");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [googleSheetConfigured, setGoogleSheetConfigured] = useState(false);
  const [googleSheetConnected, setGoogleSheetConnected] = useState(false);
  const [lastSpreadsheetUrl, setLastSpreadsheetUrl] = useState<string | null>(null);
  const resumeExportTriggeredRef = useRef(false);

  const yearOptions = useMemo(
    () => buildYearOptions(Math.max(fromYear, toYear, initialYear)),
    [fromYear, toYear, initialYear],
  );

  const farmNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of farmOptions) map.set(f.id, f.label);
    return map;
  }, [farmOptions]);

  const filter = useMemo<FertilizerBalanceExportFilter>(
    () => ({
      farms: selectedFarmIds.map((id) => ({
        farmId: Number(id),
        farmName: farmNameById.get(id) ?? id,
      })),
      fromYear,
      fromMonth,
      toYear,
      toMonth,
    }),
    [selectedFarmIds, farmNameById, fromYear, fromMonth, toYear, toMonth],
  );

  const selectedFarmNames = useMemo(
    () => selectedFarmIds.map((id) => farmNameById.get(id) ?? id),
    [selectedFarmIds, farmNameById],
  );

  const periodLabel = useMemo(
    () =>
      fertilizerBalancePeriodRangeLabel(
        { year: fromYear, month: fromMonth },
        { year: toYear, month: toMonth },
      ),
    [fromYear, fromMonth, toYear, toMonth],
  );

  const monthCount = useMemo(
    () =>
      enumerateFertilizerBalanceMonths(
        { year: fromYear, month: fromMonth },
        { year: toYear, month: toMonth },
      ).length,
    [fromYear, fromMonth, toYear, toMonth],
  );

  const detailLabels = useMemo<FertilizerUsageDetailLabels>(
    () => ({
      date: t("table.date"),
      farm: t("table.farm"),
      grass: t("table.grass"),
      zone: t("table.zone"),
      product: t("table.product"),
      type: t("table.type"),
      amount: t("table.amount"),
      remaining: t("table.remaining"),
      rate: t("table.rate"),
      operator: t("table.operator"),
      notes: t("dialog.notes"),
      consumption: t("table.consumption"),
      transferTo: t("table.transferTo", { farm: "{farm}" }),
    }),
    [t],
  );

  const fileName = useMemo(() => {
    const ext = format === "csv" ? "csv" : "xlsx";
    const from = { year: fromYear, month: fromMonth };
    const to = { year: toYear, month: toMonth };
    if (exportKind === "detail") {
      return resolveFertilizerUsageDetailExportFileName(selectedFarmNames, from, to, ext);
    }
    return resolveFertilizerBalanceExportFileName(selectedFarmNames, from, to, ext);
  }, [selectedFarmNames, fromYear, fromMonth, toYear, toMonth, format, exportKind]);

  useEffect(() => {
    if (!open) return;
    const pending = resumeGoogleSheetExport ? readPendingFertilizerGoogleSheetExport() : null;
    if (pending?.filter?.farms?.length) {
      const f = pending.filter;
      setSelectedFarmIds(f.farms.map((farm) => String(farm.farmId)));
      setFromYear(f.fromYear);
      setFromMonth(f.fromMonth);
      setToYear(f.toYear);
      setToMonth(f.toMonth);
      setFormat("google_sheet");
      setExportKind(pending.exportKind ?? "summary");
    } else {
      setSelectedFarmIds(
        initialFarmIds.length > 0 ? initialFarmIds : farmOptions[0] ? [farmOptions[0].id] : [],
      );
      setFromYear(initialYear);
      setFromMonth(initialMonth);
      setToYear(initialYear);
      setToMonth(initialMonth);
      setFormat("xlsx");
      setExportKind("summary");
    }
    setError(null);
    setProgressMessage(null);
    setLastSpreadsheetUrl(null);
    resumeExportTriggeredRef.current = false;
  }, [open, resumeGoogleSheetExport, initialFarmIds, initialYear, initialMonth, farmOptions]);

  useEffect(() => {
    if (!open || !canExport) return;
    let cancelled = false;
    void fetch("/api/projects/export/google-sheet", { method: "GET" })
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
  }, [open, canExport]);

  const loadModels = useCallback(async (): Promise<FertilizerBalanceSheetModel[]> => {
    if (filter.farms.length === 0) {
      throw new Error(t("balance.selectFarmHint"));
    }
    const periods = enumerateFertilizerBalanceMonths(
      { year: filter.fromYear, month: filter.fromMonth },
      { year: filter.toYear, month: filter.toMonth },
    );
    if (periods.length > FERTILIZER_BALANCE_MAX_EXPORT_MONTHS) {
      throw new Error(t("balance.maxMonthsError", { max: FERTILIZER_BALANCE_MAX_EXPORT_MONTHS }));
    }
    const tasks: Array<Promise<FertilizerBalanceSheetModel>> = [];
    for (const farm of filter.farms) {
      for (const period of periods) {
        tasks.push(
          fetchFertilizerBalanceSheetModel({
            farmId: farm.farmId,
            farmName: farm.farmName,
            year: period.year,
            month: period.month,
          }),
        );
      }
    }
    return Promise.all(tasks);
  }, [filter, t]);

  const loadDetailRows = useCallback(async () => {
    if (filter.farms.length === 0) {
      throw new Error(t("balance.selectFarmHint"));
    }
    const rows = await fetchFertilizerUsageDetailRows(filter);
    if (rows.length === 0) {
      throw new Error(t("balance.noDetailRows"));
    }
    return rows;
  }, [filter, t]);

  const runGoogleSheetExport = useCallback(async () => {
    if (!canExport) return false;
    setExporting(true);
    setError(null);
    setProgressMessage(tHarvest("exportGoogleSheetUploading"));
    try {
      if (exportKind === "detail") {
        const rows = await loadDetailRows();
        const spreadsheetTitle = fileName.replace(/\.xlsx$/, "");
        const result = await exportFertilizerUsageDetailToGoogleSheet(
          rows,
          detailLabels,
          spreadsheetTitle,
        );
        if (result.needsAuth) {
          savePendingFertilizerGoogleSheetExport({ filter, exportKind });
          startFertilizerGoogleSheetOAuth();
          return false;
        }
        if (!result.ok) {
          setError(result.message ?? tHarvest("exportGoogleSheetFailed"));
          return false;
        }
        clearPendingFertilizerGoogleSheetExport();
        if (result.spreadsheetUrl) {
          setLastSpreadsheetUrl(result.spreadsheetUrl);
          window.open(result.spreadsheetUrl, "_blank", "noopener,noreferrer");
        }
        onResumeHandled?.();
        onClose();
        return true;
      }

      const models = await loadModels();
      const result = await exportFertilizerBalanceModelsToGoogleSheet(models);
      if (result.needsAuth) {
        savePendingFertilizerGoogleSheetExport({ filter, exportKind });
        startFertilizerGoogleSheetOAuth();
        return false;
      }
      if (!result.ok) {
        setError(result.message ?? tHarvest("exportGoogleSheetFailed"));
        return false;
      }
      clearPendingFertilizerGoogleSheetExport();
      if (result.spreadsheetUrl) {
        setLastSpreadsheetUrl(result.spreadsheetUrl);
        window.open(result.spreadsheetUrl, "_blank", "noopener,noreferrer");
      }
      onResumeHandled?.();
      onClose();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : tHarvest("exportFailed"));
      return false;
    } finally {
      setExporting(false);
      setProgressMessage(null);
    }
  }, [
    canExport,
    exportKind,
    filter,
    loadModels,
    loadDetailRows,
    detailLabels,
    fileName,
    onClose,
    onResumeHandled,
    tHarvest,
  ]);

  useEffect(() => {
    if (
      !open ||
      !resumeGoogleSheetExport ||
      !googleSheetConnected ||
      resumeExportTriggeredRef.current
    ) {
      return;
    }
    resumeExportTriggeredRef.current = true;
    void runGoogleSheetExport();
  }, [open, resumeGoogleSheetExport, googleSheetConnected, runGoogleSheetExport]);

  if (!open) return null;

  const actionBtnClass =
    "inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md border border-border px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

  const formatBtnClass = (active: boolean) =>
    cn(
      actionBtnClass,
      "gap-1.5",
      active ? "border-primary bg-primary/10 text-primary" : bgSurfaceFilter(false),
    );

  const googleSheetHint = !googleSheetConfigured
    ? tHarvest("exportGoogleSheetNotConfigured")
    : googleSheetConnected
      ? tHarvest("exportGoogleSheetConnected")
      : tHarvest("exportGoogleSheetConnectHint");

  const sheetCount = exportKind === "summary" ? selectedFarmIds.length * monthCount : 1;

  const onExport = async () => {
    if (!canExport || selectedFarmIds.length === 0) return;
    setExporting(true);
    setError(null);
    try {
      if (exportKind === "detail") {
        const rows = await loadDetailRows();
        if (format === "csv") {
          exportFertilizerUsageDetailToCsv(rows, detailLabels, fileName);
          onClose();
          return;
        }
        if (format === "xlsx") {
          setProgressMessage(tHarvest("exportExcelPreparing"));
          await exportFertilizerUsageDetailToXlsx(rows, detailLabels, fileName);
          onClose();
          return;
        }
        if (!googleSheetConnected) {
          savePendingFertilizerGoogleSheetExport({ filter, exportKind });
          startFertilizerGoogleSheetOAuth();
          return;
        }
        const spreadsheetTitle = fileName.replace(/\.xlsx$/, "");
        const result = await exportFertilizerUsageDetailToGoogleSheet(
          rows,
          detailLabels,
          spreadsheetTitle,
        );
        if (result.needsAuth) {
          savePendingFertilizerGoogleSheetExport({ filter, exportKind });
          startFertilizerGoogleSheetOAuth();
          return;
        }
        if (!result.ok) {
          setError(result.message ?? tHarvest("exportGoogleSheetFailed"));
          return;
        }
        clearPendingFertilizerGoogleSheetExport();
        if (result.spreadsheetUrl) {
          window.open(result.spreadsheetUrl, "_blank", "noopener,noreferrer");
        }
        onResumeHandled?.();
        onClose();
        return;
      }

      const models = await loadModels();
      if (format === "csv") {
        exportFertilizerBalanceModelsToCsv(models, models.length === 1 ? fileName : undefined);
        onClose();
        return;
      }
      if (format === "xlsx") {
        setProgressMessage(tHarvest("exportExcelPreparing"));
        await exportFertilizerBalanceModelsToXlsx(models, fileName);
        onClose();
        return;
      }
      if (!googleSheetConnected) {
        savePendingFertilizerGoogleSheetExport({ filter, exportKind });
        startFertilizerGoogleSheetOAuth();
        return;
      }
      const result = await exportFertilizerBalanceModelsToGoogleSheet(models);
      if (result.needsAuth) {
        savePendingFertilizerGoogleSheetExport({ filter, exportKind });
        startFertilizerGoogleSheetOAuth();
        return;
      }
      if (!result.ok) {
        setError(result.message ?? tHarvest("exportGoogleSheetFailed"));
        return;
      }
      clearPendingFertilizerGoogleSheetExport();
      if (result.spreadsheetUrl) {
        window.open(result.spreadsheetUrl, "_blank", "noopener,noreferrer");
      }
      onResumeHandled?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : tHarvest("exportFailed"));
    } finally {
      setExporting(false);
      setProgressMessage(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg border border-border bg-card text-card-foreground shadow-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fertilizer-balance-export-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-1.5 border-b border-border p-6 pb-4">
          <h2 id="fertilizer-balance-export-title" className="text-base font-semibold">
            {t("balance.exportTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("balance.exportHint")}</p>
          <p className="text-sm font-medium text-foreground">{fileName}</p>
          <p className="text-xs text-muted-foreground">
            {t("balance.periodSummary", { period: periodLabel, count: monthCount })}
          </p>
          {sheetCount > 1 && exportKind === "summary" ? (
            <p className="text-xs text-muted-foreground">
              {t("balance.multiSheetHint", { count: sheetCount })}
            </p>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6 pt-4">
          <div className="mb-4 space-y-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("balance.exportType")}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                className={cn(
                  "rounded-md border px-3 py-2 text-left transition-colors",
                  exportKind === "summary"
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-background hover:bg-muted/50",
                )}
                onClick={() => setExportKind("summary")}
              >
                <span className="block text-sm font-medium">{t("balance.exportTypeSummary")}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {t("balance.exportTypeSummaryHint")}
                </span>
              </button>
              <button
                type="button"
                className={cn(
                  "rounded-md border px-3 py-2 text-left transition-colors",
                  exportKind === "detail"
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-background hover:bg-muted/50",
                )}
                onClick={() => setExportKind("detail")}
              >
                <span className="block text-sm font-medium">{t("balance.exportTypeDetail")}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {t("balance.exportTypeDetailHint")}
                </span>
              </button>
            </div>
            <MultiSelect
              options={farmOptions.map((f) => ({ value: f.id, label: f.label }))}
              values={selectedFarmIds}
              onChange={setSelectedFarmIds}
              placeholder={t("balance.selectFarm")}
              showAllOption
              className={cn(
                "w-full rounded-md border border-input text-sm",
                bgSurfaceFilter(selectedFarmIds.length > 0),
              )}
            />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <MonthYearFields
                label={t("balance.periodFrom")}
                month={fromMonth}
                year={fromYear}
                yearOptions={yearOptions}
                onMonthChange={setFromMonth}
                onYearChange={setFromYear}
              />
              <MonthYearFields
                label={t("balance.periodTo")}
                month={toMonth}
                year={toYear}
                yearOptions={yearOptions}
                onMonthChange={setToMonth}
                onYearChange={setToYear}
              />
            </div>
          </div>

          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {tHarvest("exportFormat")}
          </p>
          <div className="mb-4 flex flex-wrap gap-2">
            <button type="button" className={formatBtnClass(format === "csv")} onClick={() => setFormat("csv")}>
              <FileSpreadsheet className="h-4 w-4" aria-hidden />
              CSV
            </button>
            <button type="button" className={formatBtnClass(format === "xlsx")} onClick={() => setFormat("xlsx")}>
              <FileSpreadsheet className="h-4 w-4" aria-hidden />
              Excel
            </button>
            <button
              type="button"
              className={formatBtnClass(format === "google_sheet")}
              onClick={() => setFormat("google_sheet")}
              disabled={!googleSheetConfigured}
              title={googleSheetHint}
            >
              <Sheet className="h-4 w-4" aria-hidden />
              Google Sheet
            </button>
          </div>

          {format === "google_sheet" && googleSheetConfigured ? (
            <p className="mb-4 text-sm text-muted-foreground">{googleSheetHint}</p>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {progressMessage ? <p className="text-sm text-muted-foreground">{progressMessage}</p> : null}
          {lastSpreadsheetUrl ? (
            <a
              href={lastSpreadsheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              {tHarvest("exportGoogleSheetOpen")}
            </a>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-border p-6">
          <button type="button" className={cn(actionBtnClass, "bg-background")} onClick={onClose} disabled={exporting}>
            {tCommon("cancel")}
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
            disabled={
              !canExport ||
              selectedFarmIds.length === 0 ||
              exporting ||
              (format === "google_sheet" && !googleSheetConfigured)
            }
            onClick={() => void onExport()}
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
            {format === "google_sheet" && !googleSheetConnected
              ? tHarvest("exportGoogleSheetConnect")
              : tHarvest("exportDownload")}
          </button>
        </div>
      </div>
    </div>
  );
}
