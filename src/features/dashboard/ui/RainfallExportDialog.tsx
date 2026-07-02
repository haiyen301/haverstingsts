"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, FileSpreadsheet, Loader2, Sheet } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  fetchRainfallDashboard,
  type RainfallRecentEntry,
} from "@/features/dashboard/api/rainfallApi";
import {
  buildRainfallChartMatrix,
  buildRainfallExportFileName,
  exportRainfallWorkbookToCsv,
  exportRainfallWorkbookToGoogleSheet,
  exportRainfallWorkbookToXlsx,
  type RainfallExportSheet,
} from "@/features/dashboard/lib/rainfallExport";
import { rainfallChartLabelsFromTranslator } from "@/features/dashboard/lib/rainfallChartLabels";
import { MultiSelect } from "@/shared/ui/multi-select";
import { cn } from "@/lib/utils";

type ExportFormat = "csv" | "xlsx" | "google_sheet";

export type RainfallExportFarmOption = {
  id: string;
  label: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  farmOptions: RainfallExportFarmOption[];
  initialFarmIds?: string[];
  initialYear?: number;
  /** Match dashboard manual-only rainfall display. */
  manualOnly?: boolean;
};

const inputClass =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";
const actionBtnClass =
  "inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md border border-border px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export function RainfallExportDialog({
  open,
  onClose,
  farmOptions,
  initialFarmIds,
  initialYear,
  manualOnly = false,
}: Props) {
  const t = useTranslations("Dashboard.rainfall.export");
  const tChart = useTranslations("Dashboard.rainfall.export.chart");
  const tCommon = useTranslations("Common");
  const currentYear = new Date().getFullYear();

  const chartLabels = useMemo(
    () => rainfallChartLabelsFromTranslator(tChart),
    [tChart],
  );

  const [selectedFarmIds, setSelectedFarmIds] = useState<string[]>([]);
  const [year, setYear] = useState(currentYear);
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [entries, setEntries] = useState<RainfallRecentEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [googleSheetConfigured, setGoogleSheetConfigured] = useState(false);
  const [googleSheetConnected, setGoogleSheetConnected] = useState(false);
  const [lastSpreadsheetUrl, setLastSpreadsheetUrl] = useState<string | null>(null);

  const selectedFarms = useMemo(
    () => farmOptions.filter((farm) => selectedFarmIds.includes(farm.id)),
    [farmOptions, selectedFarmIds],
  );

  useEffect(() => {
    if (!open) return;
    setYear(initialYear ?? currentYear);
    const initial =
      initialFarmIds?.filter((id) => farmOptions.some((farm) => farm.id === id)) ?? [];
    setSelectedFarmIds(
      initial.length > 0 ? initial : farmOptions.map((farm) => farm.id),
    );
    setFormat("xlsx");
    setEntries([]);
    setError(null);
    setProgressMessage(null);
    setLastSpreadsheetUrl(null);
  }, [open, initialFarmIds, initialYear, farmOptions, currentYear]);

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

  const loadEntries = useCallback(async () => {
    if (selectedFarmIds.length === 0) {
      setError(t("errors.farmRequired"));
      return null;
    }
    if (!Number.isFinite(year) || year < 2000 || year > 2100) {
      setError(t("errors.yearInvalid"));
      return null;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await fetchRainfallDashboard({
        year,
        farmIds: selectedFarmIds,
      });
      const recent = manualOnly
        ? data.recent.filter((entry) => entry.source === "manual")
        : data.recent;
      setEntries(recent);
      return recent;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.load"));
      return null;
    } finally {
      setLoading(false);
    }
  }, [manualOnly, selectedFarmIds, t, year]);

  useEffect(() => {
    if (!open || selectedFarmIds.length === 0) return;
    void loadEntries();
  }, [open, selectedFarmIds, year, loadEntries]);

  const exportSheets = useMemo((): RainfallExportSheet[] => {
    return selectedFarms.map((farm) => ({
      farmId: farm.id,
      farmName: farm.label,
      matrix: buildRainfallChartMatrix({
        year,
        farmId: farm.id,
        farmName: farm.label,
        entries,
        labels: chartLabels,
        manualOnly,
      }),
    }));
  }, [chartLabels, entries, manualOnly, selectedFarms, year]);

  const onExport = async () => {
    setExporting(true);
    setError(null);
    setProgressMessage(null);
    try {
      if (selectedFarms.length === 0) {
        setError(t("errors.farmRequired"));
        return;
      }

      const loaded = entries.length > 0 ? entries : await loadEntries();
      const sheets =
        exportSheets.length > 0 && loaded
          ? exportSheets
          : selectedFarms.map((farm) => ({
              farmId: farm.id,
              farmName: farm.label,
              matrix: buildRainfallChartMatrix({
                year,
                farmId: farm.id,
                farmName: farm.label,
                entries: loaded ?? [],
                labels: chartLabels,
                manualOnly,
              }),
            }));

      if (sheets.length === 0 || sheets.every((sheet) => sheet.matrix.length === 0)) {
        setError(t("errors.empty"));
        return;
      }

      const singleFarm = sheets.length === 1 ? sheets[0]?.farmName : undefined;
      const fileName = buildRainfallExportFileName(
        year,
        format === "csv" ? "csv" : "xlsx",
        singleFarm,
      );

      if (format === "csv") {
        exportRainfallWorkbookToCsv(sheets, fileName);
        onClose();
        return;
      }
      if (format === "xlsx") {
        setProgressMessage(t("exportExcelPreparing"));
        await exportRainfallWorkbookToXlsx(sheets, fileName);
        onClose();
        return;
      }

      if (!googleSheetConnected) {
        window.location.href = "/api/projects/export/google-sheet/oauth/authorize";
        return;
      }

      setProgressMessage(t("exportGoogleSheetUploading"));
      const result = await exportRainfallWorkbookToGoogleSheet({
        sheets,
        year,
        spreadsheetTitle: t("spreadsheetTitle", { year }),
      });
      if (result.needsAuth && result.authorizePath) {
        window.location.href = result.authorizePath;
        return;
      }
      if (!result.ok) {
        throw new Error(result.message ?? t("exportGoogleSheetFailed"));
      }
      setLastSpreadsheetUrl(result.spreadsheetUrl ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.export"));
    } finally {
      setExporting(false);
      setProgressMessage(null);
    }
  };

  if (!open) return null;

  const formatBtnClass = (active: boolean) =>
    cn(actionBtnClass, active && "border-primary bg-primary/10 text-primary");

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
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rainfall-export-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="rainfall-export-title" className="text-lg font-semibold text-foreground">
          {t("title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>

        <div className="mt-4 grid gap-4">
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">{t("farms")}</span>
              <span className="flex gap-2">
                <button
                  type="button"
                  className="text-xs font-medium text-primary hover:underline disabled:opacity-40"
                  disabled={farmOptions.length === 0}
                  onClick={() => setSelectedFarmIds(farmOptions.map((farm) => farm.id))}
                >
                  {t("selectAllFarms")}
                </button>
                <button
                  type="button"
                  className="text-xs font-medium text-muted-foreground hover:underline disabled:opacity-40"
                  disabled={selectedFarmIds.length === 0}
                  onClick={() => setSelectedFarmIds([])}
                >
                  {t("clearAllFarms")}
                </button>
              </span>
            </div>
            <MultiSelect
              options={farmOptions.map((farm) => ({ value: farm.id, label: farm.label }))}
              values={selectedFarmIds}
              onChange={setSelectedFarmIds}
              placeholder={t("selectFarms")}
              selectionSummary="count"
              formatSelectedCount={(count) => t("farmsSelected", { count })}
              className="w-full"
            />
          </div>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">{t("year")}</span>
            <input
              type="number"
              min={2000}
              max={2100}
              className={inputClass}
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={formatBtnClass(format === "csv")} onClick={() => setFormat("csv")}>
            <FileSpreadsheet className="mr-1.5 h-4 w-4" />
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
            title={googleSheetHint}
          >
            <Sheet className="mr-1.5 h-4 w-4" />
            Google Sheet
          </button>
        </div>

        {format === "google_sheet" && googleSheetConfigured ? (
          <p className="mt-2 text-sm text-muted-foreground">{googleSheetHint}</p>
        ) : null}

        {loading ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("loadingPreview")}
          </p>
        ) : selectedFarms.length > 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            {selectedFarms.length === 1
              ? t("previewReady", {
                  farm: selectedFarms[0].label,
                  year,
                  readings: entries.filter(
                    (entry) => String(entry.farm_id) === selectedFarms[0].id,
                  ).length,
                })
              : t("previewReadyMulti", {
                  count: selectedFarms.length,
                  year,
                  readings: entries.length,
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
            {t("exportGoogleSheetOpen")}
          </a>
        ) : null}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className={actionBtnClass} onClick={onClose} disabled={exporting}>
            {tCommon("cancel")}
          </button>
          <button
            type="button"
            className={cn(
              actionBtnClass,
              "gap-1.5 border-primary bg-primary text-primary-foreground hover:bg-primary/90",
            )}
            onClick={() => void onExport()}
            disabled={exporting || loading || selectedFarmIds.length === 0}
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {format === "google_sheet" && !googleSheetConnected
              ? t("exportGoogleSheetConnect")
              : t("download")}
          </button>
        </div>
      </div>
    </div>
  );
}
