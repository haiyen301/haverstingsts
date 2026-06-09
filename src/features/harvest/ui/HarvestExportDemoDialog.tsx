"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, ExternalLink, FileSpreadsheet, Loader2, Sheet } from "lucide-react";

import {
  buildHarvestListExportFileName,
  buildHarvestListGoogleSheetExportPayload,
  defaultSelectedHarvestListExportColumns,
  discoverHarvestListExportColumns,
  exportHarvestListRowsToCsv,
  exportHarvestListRowsToXlsxWithImages,
  harvestListExportColumnLabel,
  isHarvestListExportImageColumn,
  type HarvestListExportResolveContext,
} from "@/features/harvest/lib/harvestListExport";
import {
  clearPendingDemoHarvestGoogleSheetExport,
  exportDemoHarvestRowsToGoogleSheet,
  readPendingDemoHarvestGoogleSheetExport,
  savePendingDemoHarvestGoogleSheetExport,
  startDemoHarvestGoogleSheetOAuth,
} from "@/features/harvest/lib/harvestExportDemoGoogleSheet";
import { useAppTranslations } from "@/shared/i18n/useAppTranslations";
import { Checkbox } from "@/shared/ui/checkbox";
import { cn } from "@/lib/utils";
import { bgSurfaceFilter } from "@/shared/lib/surfaceFilter";

type ExportFormat = "csv" | "xlsx" | "google_sheet";

type Props = {
  open: boolean;
  onClose: () => void;
  rows: Array<Record<string, unknown>>;
  resolveContext: HarvestListExportResolveContext;
  resumeGoogleSheetExport?: boolean;
  onResumeHandled?: () => void;
};

export function HarvestExportDemoDialog({
  open,
  onClose,
  rows,
  resolveContext,
  resumeGoogleSheetExport = false,
  onResumeHandled,
}: Props) {
  const t = useAppTranslations("Harvest");
  const tHarvestForm = useAppTranslations("HarvestForm");
  const tCommon = useAppTranslations("Common");

  const allColumns = useMemo(() => discoverHarvestListExportColumns(), []);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [format, setFormat] = useState<ExportFormat>("xlsx");
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
      ? readPendingDemoHarvestGoogleSheetExport()
      : null;
    if (pending?.selectedColumns?.length) {
      const next = defaultSelectedHarvestListExportColumns(allColumns);
      for (const col of allColumns) {
        next[col] = pending.selectedColumns.includes(col);
      }
      setSelected(next);
      setFormat("google_sheet");
    } else {
      setSelected(defaultSelectedHarvestListExportColumns(allColumns));
      setFormat("xlsx");
    }
    setError(null);
    setProgressMessage(null);
    setLastSpreadsheetUrl(null);
    resumeExportTriggeredRef.current = false;
  }, [open, allColumns, resumeGoogleSheetExport]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetch("/api/test/harvest-export/google-sheet", { method: "GET" })
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

  const columnLabel = useCallback(
    (key: string) => harvestListExportColumnLabel(t, tHarvestForm, key),
    [t, tHarvestForm],
  );

  const visibleColumns = useMemo(
    () =>
      format === "csv"
        ? allColumns.filter((col) => !isHarvestListExportImageColumn(col))
        : allColumns,
    [allColumns, format],
  );

  const selectedColumns = allColumns.filter((col) => selected[col]);
  const selectedVisibleColumns = visibleColumns.filter((col) => selected[col]);
  const hasExportableColumns = selectedVisibleColumns.length > 0;

  const runGoogleSheetExport = useCallback(async () => {
    if (rows.length === 0 || selectedColumns.length === 0) return false;
    setExporting(true);
    setError(null);
    setProgressMessage(t("exportGoogleSheetUploading"));
    try {
      const payload = buildHarvestListGoogleSheetExportPayload({
        rows,
        selectedColumns,
        columnLabel,
        resolveContext,
        sheetTabName: "harvests-demo",
      });
      const result = await exportDemoHarvestRowsToGoogleSheet(payload);
      if (result.needsAuth) {
        savePendingDemoHarvestGoogleSheetExport({ selectedColumns });
        startDemoHarvestGoogleSheetOAuth();
        return false;
      }
      if (!result.ok) {
        setError(result.message ?? t("exportGoogleSheetFailed"));
        return false;
      }
      clearPendingDemoHarvestGoogleSheetExport();
      if (result.spreadsheetUrl) {
        setLastSpreadsheetUrl(result.spreadsheetUrl);
        window.open(result.spreadsheetUrl, "_blank", "noopener,noreferrer");
      }
      onResumeHandled?.();
      onClose();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("exportFailed"));
      return false;
    } finally {
      setExporting(false);
      setProgressMessage(null);
    }
  }, [columnLabel, onClose, onResumeHandled, resolveContext, rows, selectedColumns, t]);

  useEffect(() => {
    if (
      !open ||
      !resumeGoogleSheetExport ||
      !googleSheetConnected ||
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
      for (const col of visibleColumns) {
        next[col] = value;
      }
      return next;
    });
  };

  const onExport = async () => {
    if (rows.length === 0 || !hasExportableColumns) return;
    if (format === "csv") {
      setExporting(true);
      try {
        exportHarvestListRowsToCsv({
          rows,
          selectedColumns,
          fileName: buildHarvestListExportFileName("csv").replace(
            "harvests-export",
            "harvests-demo-export",
          ),
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
      setProgressMessage(t("exportExcelPreparing"));
      try {
        await exportHarvestListRowsToXlsxWithImages({
          rows,
          selectedColumns,
          fileName: buildHarvestListExportFileName("xlsx").replace(
            "harvests-export",
            "harvests-demo-export",
          ),
          columnLabel,
          resolveContext,
          onProgress: setProgressMessage,
        });
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : t("exportFailed"));
      } finally {
        setExporting(false);
        setProgressMessage(null);
      }
      return;
    }

    if (!googleSheetConnected) {
      savePendingDemoHarvestGoogleSheetExport({ selectedColumns });
      startDemoHarvestGoogleSheetOAuth();
      return;
    }

    await runGoogleSheetExport();
  };

  const actionBtnClass =
    "inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md border border-border px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

  const formatBtnClass = (active: boolean) =>
    cn(
      actionBtnClass,
      "gap-1.5",
      active ? "border-primary bg-primary/10 text-primary" : bgSurfaceFilter(false),
    );

  const googleSheetHint = !googleSheetConfigured
    ? t("exportGoogleSheetNotConfigured")
    : googleSheetConnected
      ? t("exportGoogleSheetConnected")
      : t("exportGoogleSheetConnectHint");

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
        aria-labelledby="harvest-export-demo-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-1.5 border-b border-border p-6 pb-4">
          <h2
            id="harvest-export-demo-title"
            className="text-base font-semibold leading-none tracking-tight text-foreground"
          >
            {t("exportTitle")} (Demo)
          </h2>
          <p className="text-sm text-muted-foreground">{t("exportHint")}</p>
          <p className="text-sm font-medium text-foreground">
            {t("exportRowCount", { count: rows.length })}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6 pt-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("exportFormat")}
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
              {t("exportSelectAll")}
            </button>
            <button
              type="button"
              className={cn(actionBtnClass, bgSurfaceFilter(false))}
              onClick={() => setAll(false)}
            >
              {t("exportDeselectAll")}
            </button>
          </div>

          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("exportSelectColumns")}
          </p>
          <ul className="grid max-h-[36vh] gap-2 overflow-y-auto sm:grid-cols-2">
            {visibleColumns.map((col) => {
              const checked = Boolean(selected[col]);
              return (
                <li key={col}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2.5 text-sm transition-colors hover:bg-muted/50",
                      bgSurfaceFilter(checked),
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onChange={() => toggleColumn(col)}
                    />
                    <span className="min-w-0 flex-1 leading-snug">
                      {columnLabel(col)}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          {error ? (
            <p className="mt-4 text-sm text-destructive">{error}</p>
          ) : null}
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
              {t("exportGoogleSheetOpen")}
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
            className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"
            disabled={
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
              ? t("exportGoogleSheetConnect")
              : t("exportDownload")}
          </button>
        </div>
      </div>
    </div>
  );
}
