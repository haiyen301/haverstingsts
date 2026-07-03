"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlignLeft, ArrowDown, Download, ExternalLink, FileSpreadsheet, Loader2, Search, Sheet } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  buildStockSummaryExportFileName,
  buildStockSummaryExportRows,
  defaultSelectedStockSummaryExportColumns,
  discoverStockSummaryExportColumns,
  exportStockSummaryRowsToCsv,
  exportStockSummaryRowsToGoogleSheet,
  exportStockSummaryRowsToXlsx,
  stockSummaryExportColumnLabel,
  type StockSummaryExportFilter,
  type StockSummaryExportResolveContext,
} from "@/features/warehouse/lib/stockSummaryExport";
import {
  clearPendingStockSummaryGoogleSheetExport,
  readPendingStockSummaryGoogleSheetExport,
  savePendingStockSummaryGoogleSheetExport,
  startStockSummaryGoogleSheetOAuth,
} from "@/features/warehouse/lib/stockSummaryGoogleSheetPending";
import type { StockSummaryRow } from "@/features/warehouse/api/stockSummaryApi";
import { cn } from "@/lib/utils";
import { bgSurfaceFilter } from "@/shared/lib/surfaceFilter";
import { canAccessModule } from "@/shared/auth/permissions";
import { useAuthUserStore } from "@/shared/store/authUserStore";
import { Checkbox } from "@/shared/ui/checkbox";
import { MultiSelect } from "@/shared/ui/multi-select";

type ExportFormat = "csv" | "xlsx" | "google_sheet";

const multiSelectBaseClass =
  "min-w-[140px] max-w-[220px] rounded-md border border-input text-sm hover:bg-btnhover/40";

const filterTriggerIcon = (
  <>
    <AlignLeft className="h-3.5 w-3.5 shrink-0" />
    <ArrowDown className="h-3.5 w-3.5 shrink-0" />
  </>
);

const actionBtnClass =
  "inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md border border-border px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

type StockSummaryExportDialogProps = {
  open: boolean;
  onClose: () => void;
  initialFilter: StockSummaryExportFilter;
  resolveContext: StockSummaryExportResolveContext;
  countryOptions: Array<{ value: string; label: string }>;
  brandOptions: Array<{ value: string; label: string }>;
  categoryOptions: Array<{ value: string; label: string }>;
  resumeGoogleSheetExport?: boolean;
  onResumeHandled?: () => void;
};

export function StockSummaryExportDialog({
  open,
  onClose,
  initialFilter,
  resolveContext,
  countryOptions,
  brandOptions,
  categoryOptions,
  resumeGoogleSheetExport = false,
  onResumeHandled,
}: StockSummaryExportDialogProps) {
  const t = useTranslations("StockSummary.export");
  const tCommon = useTranslations("Common");
  const user = useAuthUserStore((s) => s.user);
  const canExport = canAccessModule(user, "inventory", "export");

  const allColumns = useMemo(() => discoverStockSummaryExportColumns(), []);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [filter, setFilter] = useState<StockSummaryExportFilter>(initialFilter);
  const [rows, setRows] = useState<StockSummaryRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [googleSheetConfigured, setGoogleSheetConfigured] = useState(false);
  const [googleSheetConnected, setGoogleSheetConnected] = useState(false);
  const [lastSpreadsheetUrl, setLastSpreadsheetUrl] = useState<string | null>(null);
  const resumeExportTriggeredRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const pending = resumeGoogleSheetExport
      ? readPendingStockSummaryGoogleSheetExport()
      : null;
    if (pending?.selectedColumns?.length) {
      const next = defaultSelectedStockSummaryExportColumns(allColumns);
      for (const col of allColumns) {
        next[col] = pending.selectedColumns.includes(col);
      }
      setSelected(next);
      setFilter(pending.filter);
      setFormat("google_sheet");
    } else {
      setSelected(defaultSelectedStockSummaryExportColumns(allColumns));
      setFilter(initialFilter);
      setFormat("xlsx");
    }
    setError(null);
    setProgressMessage(null);
    setLastSpreadsheetUrl(null);
    resumeExportTriggeredRef.current = false;
  }, [open, allColumns, initialFilter, resumeGoogleSheetExport]);

  useEffect(() => {
    if (!open || !canExport) return;
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
  }, [open, canExport]);

  useEffect(() => {
    if (!open || !canExport) return;
    let cancelled = false;
    setLoadingRows(true);
    setError(null);
    void buildStockSummaryExportRows(filter, resolveContext)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((e) => {
        if (!cancelled) {
          setRows([]);
          setError(e instanceof Error ? e.message : t("loadError"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingRows(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, canExport, filter, resolveContext, t]);

  const columnLabel = useCallback(
    (key: string) => stockSummaryExportColumnLabel((colKey) => t(colKey), key),
    [t],
  );

  const selectedColumns = allColumns.filter((col) => selected[col]);
  const hasExportableColumns = selectedColumns.length > 0;

  const runGoogleSheetExport = useCallback(async () => {
    if (!canExport || rows.length === 0 || selectedColumns.length === 0) return false;
    setExporting(true);
    setError(null);
    setProgressMessage(t("googleSheetUploading"));
    try {
      const result = await exportStockSummaryRowsToGoogleSheet({
        rows,
        selectedColumns,
        columnLabel,
        resolveContext,
      });
      if (result.needsAuth) {
        savePendingStockSummaryGoogleSheetExport({
          selectedColumns,
          filter,
        });
        startStockSummaryGoogleSheetOAuth();
        return false;
      }
      if (!result.ok) {
        setError(result.message ?? t("googleSheetFailed"));
        return false;
      }
      clearPendingStockSummaryGoogleSheetExport();
      if (result.spreadsheetUrl) {
        setLastSpreadsheetUrl(result.spreadsheetUrl);
        window.open(result.spreadsheetUrl, "_blank", "noopener,noreferrer");
      }
      onResumeHandled?.();
      onClose();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("failed"));
      return false;
    } finally {
      setExporting(false);
      setProgressMessage(null);
    }
  }, [
    canExport,
    columnLabel,
    filter,
    onClose,
    onResumeHandled,
    resolveContext,
    rows,
    selectedColumns,
    t,
  ]);

  useEffect(() => {
    if (
      !open ||
      !resumeGoogleSheetExport ||
      !googleSheetConnected ||
      loadingRows ||
      rows.length === 0 ||
      selectedColumns.length === 0 ||
      resumeExportTriggeredRef.current
    ) {
      return;
    }
    resumeExportTriggeredRef.current = true;
    void runGoogleSheetExport();
  }, [
    open,
    resumeGoogleSheetExport,
    googleSheetConnected,
    loadingRows,
    rows.length,
    selectedColumns.length,
    runGoogleSheetExport,
  ]);

  if (!open) return null;

  const toggleColumn = (key: string) => {
    setSelected((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const setAll = (value: boolean) => {
    setSelected((prev) => {
      const next = { ...prev };
      for (const col of allColumns) {
        next[col] = value;
      }
      return next;
    });
  };

  const onExport = async () => {
    if (!canExport || rows.length === 0 || !hasExportableColumns) return;
    if (format === "csv") {
      setExporting(true);
      try {
        exportStockSummaryRowsToCsv({
          rows,
          selectedColumns,
          fileName: buildStockSummaryExportFileName("csv"),
          columnLabel,
          resolveContext,
        });
        onClose();
      } finally {
        setExporting(false);
      }
      return;
    }
    if (format === "xlsx") {
      setExporting(true);
      setProgressMessage(t("excelPreparing"));
      try {
        exportStockSummaryRowsToXlsx({
          rows,
          selectedColumns,
          fileName: buildStockSummaryExportFileName("xlsx"),
          columnLabel,
          resolveContext,
        });
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : t("failed"));
      } finally {
        setExporting(false);
        setProgressMessage(null);
      }
      return;
    }

    if (!googleSheetConnected) {
      savePendingStockSummaryGoogleSheetExport({ selectedColumns, filter });
      startStockSummaryGoogleSheetOAuth();
      return;
    }

    await runGoogleSheetExport();
  };

  const formatBtnClass = (active: boolean) =>
    cn(
      actionBtnClass,
      "gap-1.5",
      active ? "border-primary bg-primary/10 text-primary" : bgSurfaceFilter(false),
    );

  const googleSheetHint = !googleSheetConfigured
    ? t("googleSheetNotConfigured")
    : googleSheetConnected
      ? t("googleSheetConnected")
      : t("googleSheetConnectHint");

  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-card text-card-foreground shadow-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stock-summary-export-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-1.5 border-b border-border p-6 pb-4">
          <h2
            id="stock-summary-export-title"
            className="text-base font-semibold leading-none tracking-tight text-foreground"
          >
            {t("title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("hint")}</p>
          <p className="text-sm font-medium text-foreground">
            {loadingRows ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {t("loadingRows")}
              </span>
            ) : (
              t("rowCount", { count: rows.length })
            )}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6 pt-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("filtersTitle")}
          </p>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <MultiSelect
              options={countryOptions}
              values={filter.countryIds}
              onChange={(countryIds) => setFilter((prev) => ({ ...prev, countryIds }))}
              placeholder={t("allCountries")}
              showAllOption
              className={cn(
                multiSelectBaseClass,
                bgSurfaceFilter(filter.countryIds.length > 0),
              )}
              rightIcon={filterTriggerIcon}
            />
            <MultiSelect
              options={brandOptions}
              values={filter.brandIds}
              onChange={(brandIds) => setFilter((prev) => ({ ...prev, brandIds }))}
              placeholder={t("allBrands")}
              showAllOption
              className={cn(
                multiSelectBaseClass,
                bgSurfaceFilter(filter.brandIds.length > 0),
              )}
              rightIcon={filterTriggerIcon}
            />
            <MultiSelect
              options={categoryOptions}
              values={filter.categoryIds}
              onChange={(categoryIds) => setFilter((prev) => ({ ...prev, categoryIds }))}
              placeholder={t("allCategories")}
              showAllOption
              selectionSummary="compact"
              className={cn(
                multiSelectBaseClass,
                "max-w-[260px]",
                bgSurfaceFilter(filter.categoryIds.length > 0),
              )}
              rightIcon={filterTriggerIcon}
            />
            <div className="relative min-w-[180px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={filter.search}
                onChange={(e) =>
                  setFilter((prev) => ({ ...prev, search: e.target.value }))
                }
                placeholder={t("searchPlaceholder")}
                className="h-9 w-full rounded-md border border-input bg-background py-1 pl-9 pr-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35"
              />
            </div>
          </div>

          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("format")}
          </p>
          <div className="mb-4 flex flex-wrap gap-2">
            <button
              type="button"
              className={formatBtnClass(format === "csv")}
              onClick={() => setFormat("csv")}
            >
              <FileSpreadsheet className="h-4 w-4" aria-hidden />
              CSV
            </button>
            <button
              type="button"
              className={formatBtnClass(format === "xlsx")}
              onClick={() => setFormat("xlsx")}
            >
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

          <div className="mb-4 flex flex-wrap gap-2">
            <button
              type="button"
              className={cn(actionBtnClass, bgSurfaceFilter(false))}
              onClick={() => setAll(true)}
            >
              {t("selectAll")}
            </button>
            <button
              type="button"
              className={cn(actionBtnClass, bgSurfaceFilter(false))}
              onClick={() => setAll(false)}
            >
              {t("deselectAll")}
            </button>
          </div>

          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("selectColumns")}
          </p>
          <ul className="grid max-h-[32vh] gap-2 overflow-y-auto sm:grid-cols-2">
            {allColumns.map((col) => {
              const checked = Boolean(selected[col]);
              return (
                <li key={col}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2.5 text-sm transition-colors hover:bg-muted/50",
                      bgSurfaceFilter(checked),
                    )}
                  >
                    <Checkbox checked={checked} onChange={() => toggleColumn(col)} />
                    <span className="min-w-0 flex-1 leading-snug">{columnLabel(col)}</span>
                  </label>
                </li>
              );
            })}
          </ul>

          {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
          {progressMessage ? (
            <p className="mt-2 text-sm text-muted-foreground">{progressMessage}</p>
          ) : null}
          {lastSpreadsheetUrl ? (
            <a
              href={lastSpreadsheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              {t("googleSheetOpen")}
            </a>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-border p-6">
          <button
            type="button"
            className={cn(actionBtnClass, "bg-background")}
            onClick={onClose}
            disabled={exporting}
          >
            {tCommon("cancel")}
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
            disabled={
              !canExport ||
              loadingRows ||
              exporting ||
              rows.length === 0 ||
              !hasExportableColumns ||
              (format === "google_sheet" && !googleSheetConfigured)
            }
            onClick={() => void onExport()}
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Download className="h-4 w-4" aria-hidden />
            )}
            {format === "google_sheet" && !googleSheetConnected
              ? t("googleSheetConnect")
              : t("download")}
          </button>
        </div>
      </div>
    </div>
  );
}
