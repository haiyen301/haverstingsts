"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, ExternalLink, FileSpreadsheet, Loader2, Sheet } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  buildFuelUsageDetailFileName,
  exportFuelUsageDetailToCsv,
  exportFuelUsageDetailToGoogleSheet,
  exportFuelUsageDetailToXlsx,
  fetchFuelUsageExportBundle,
  type FuelUsageExportFilter,
  type FuelUsageExportKind,
} from "@/features/fleet/lib/fuelUsageDetailExport";
import {
  clearPendingFuelUsageGoogleSheetExport,
  readPendingFuelUsageGoogleSheetExport,
  savePendingFuelUsageGoogleSheetExport,
  startFuelUsageGoogleSheetOAuth,
} from "@/features/fleet/lib/fuelUsageGoogleSheetPending";
import { canAccessModule } from "@/shared/auth/permissions";
import { useAuthUserStore } from "@/shared/store/authUserStore";
import { Checkbox } from "@/shared/ui/checkbox";
import { MultiSelect } from "@/shared/ui/multi-select";
import { cn } from "@/lib/utils";
import { bgSurfaceFilter } from "@/shared/lib/surfaceFilter";

type ExportFormat = "csv" | "xlsx" | "google_sheet";

type Props = {
  open: boolean;
  onClose: () => void;
  farmOptions: Array<{ id: string; label: string }>;
  initialFarmIds: string[];
  initialDateFrom: string;
  initialDateTo: string;
  fuelKindLabelByValue: Record<string, string>;
  fuelKindFallback: { diesel: string; petrol: string };
  vehicleLabelByInspectionId?: ReadonlyMap<string, string>;
  resumeGoogleSheetExport?: boolean;
  onResumeHandled?: () => void;
};

const DEFAULT_KINDS: FuelUsageExportKind[] = ["usage", "imports", "openings"];

const inputClass =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthStartYmd(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
}

export function FuelUsageExportDialog({
  open,
  onClose,
  farmOptions,
  initialFarmIds,
  initialDateFrom,
  initialDateTo,
  fuelKindLabelByValue,
  fuelKindFallback,
  vehicleLabelByInspectionId,
  resumeGoogleSheetExport = false,
  onResumeHandled,
}: Props) {
  const t = useTranslations("FuelUsage");
  const tHarvest = useTranslations("Harvest");
  const tCommon = useTranslations("Common");
  const user = useAuthUserStore((s) => s.user);
  const canExport = canAccessModule(user, "fuel_usage", "export");

  const [selectedFarmIds, setSelectedFarmIds] = useState<string[]>(initialFarmIds);
  const [dateFrom, setDateFrom] = useState(initialDateFrom || monthStartYmd());
  const [dateTo, setDateTo] = useState(initialDateTo || todayYmd());
  const [kinds, setKinds] = useState<FuelUsageExportKind[]>(DEFAULT_KINDS);
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [googleSheetConfigured, setGoogleSheetConfigured] = useState(false);
  const [googleSheetConnected, setGoogleSheetConnected] = useState(false);
  const [lastSpreadsheetUrl, setLastSpreadsheetUrl] = useState<string | null>(null);
  const resumeExportTriggeredRef = useRef(false);

  const farmNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of farmOptions) map.set(f.id, f.label);
    return map;
  }, [farmOptions]);

  const filter = useMemo<FuelUsageExportFilter>(
    () => ({
      farmIds: selectedFarmIds,
      dateFrom,
      dateTo,
      kinds,
    }),
    [selectedFarmIds, dateFrom, dateTo, kinds],
  );

  const fileName = useMemo(
    () =>
      buildFuelUsageDetailFileName({
        dateFrom,
        dateTo,
        ext: format === "csv" ? "csv" : "xlsx",
      }),
    [dateFrom, dateTo, format],
  );

  const sheetLabels = useMemo(
    () => ({
      usage: {
        date: t("table.date"),
        vehicle: t("table.vehicle"),
        farm: t("table.farm"),
        fuelKind: t("table.fuelKind"),
        litres: t("table.litres"),
        remaining: t("table.remaining"),
        costPerLitre: t("table.costPerLitre"),
        cost: t("table.cost"),
        odometer: t("table.odometer"),
        operator: t("table.operator"),
        purpose: t("table.purpose"),
        notes: t("export.notes"),
      },
      imports: {
        date: t("export.importCols.date"),
        line: t("export.importCols.line"),
        farm: t("export.importCols.farm"),
        fuelKind: t("export.importCols.fuelKind"),
        importQty: t("export.importCols.importQty"),
        importAmount: t("export.importCols.importAmount"),
        unitCost: t("export.importCols.unitCost"),
        notes: t("export.notes"),
      },
      openings: {
        date: t("export.openingCols.date"),
        farm: t("export.openingCols.farm"),
        fuelKind: t("export.openingCols.fuelKind"),
        openingQty: t("export.openingCols.openingQty"),
        notes: t("export.notes"),
      },
      sheetNames: {
        usage: t("export.sheets.usage"),
        imports: t("export.sheets.imports"),
        openings: t("export.sheets.openings"),
      },
    }),
    [t],
  );

  const toggleKind = (kind: FuelUsageExportKind) => {
    setKinds((prev) => {
      if (prev.includes(kind)) {
        if (prev.length === 1) return prev;
        return prev.filter((k) => k !== kind);
      }
      return [...prev, kind];
    });
  };

  useEffect(() => {
    if (!open) return;
    const pending = resumeGoogleSheetExport
      ? readPendingFuelUsageGoogleSheetExport()
      : null;
    if (pending?.filter) {
      setSelectedFarmIds(
        pending.filter.farmIds.length > 0
          ? pending.filter.farmIds
          : initialFarmIds.length > 0
            ? initialFarmIds
            : farmOptions[0]
              ? [farmOptions[0].id]
              : [],
      );
      setDateFrom(pending.filter.dateFrom || monthStartYmd());
      setDateTo(pending.filter.dateTo || todayYmd());
      setKinds(
        pending.filter.kinds.length > 0 ? pending.filter.kinds : DEFAULT_KINDS,
      );
      setFormat("google_sheet");
    } else {
      setSelectedFarmIds(
        initialFarmIds.length > 0
          ? initialFarmIds
          : farmOptions[0]
            ? [farmOptions[0].id]
            : [],
      );
      setDateFrom(initialDateFrom || monthStartYmd());
      setDateTo(initialDateTo || todayYmd());
      setKinds(DEFAULT_KINDS);
      setFormat("xlsx");
    }
    setError(null);
    setProgressMessage(null);
    setLastSpreadsheetUrl(null);
    resumeExportTriggeredRef.current = false;
  }, [
    open,
    resumeGoogleSheetExport,
    initialFarmIds,
    initialDateFrom,
    initialDateTo,
    farmOptions,
  ]);

  useEffect(() => {
    if (!open || !canExport) return;
    let cancelled = false;
    void fetch("/api/projects/export/google-sheet", {
      method: "GET",
      credentials: "include",
    })
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

  const buildPayload = useCallback(async () => {
    if (selectedFarmIds.length === 0) {
      throw new Error(t("export.errors.selectFarm"));
    }
    if (!dateFrom || !dateTo || dateFrom > dateTo) {
      throw new Error(t("export.errors.invalidDates"));
    }
    if (kinds.length === 0) {
      throw new Error(t("export.errors.selectKind"));
    }

    const bundle = await fetchFuelUsageExportBundle(filter, {
      farmNameById,
      vehicleLabelByInspectionId,
      fuelKindLabelByValue,
      fuelKindFallback,
    });

    const hasRows =
      (kinds.includes("usage") && bundle.usageRows.length > 0) ||
      (kinds.includes("imports") && bundle.importRows.length > 0) ||
      (kinds.includes("openings") && bundle.openingRows.length > 0);
    if (!hasRows) {
      throw new Error(t("export.errors.empty"));
    }

    return {
      usageRows: bundle.usageRows,
      usageLabels: sheetLabels.usage,
      importRows: bundle.importRows,
      importLabels: sheetLabels.imports,
      openingRows: bundle.openingRows,
      openingLabels: sheetLabels.openings,
      fileName,
      include: {
        usage: kinds.includes("usage"),
        imports: kinds.includes("imports"),
        openings: kinds.includes("openings"),
      },
      sheetNames: sheetLabels.sheetNames,
    };
  }, [
    selectedFarmIds.length,
    dateFrom,
    dateTo,
    kinds,
    filter,
    farmNameById,
    vehicleLabelByInspectionId,
    fuelKindLabelByValue,
    fuelKindFallback,
    sheetLabels,
    fileName,
    t,
  ]);

  const runGoogleSheetExport = useCallback(async () => {
    if (!canExport) return false;
    setExporting(true);
    setError(null);
    setProgressMessage(tHarvest("exportGoogleSheetUploading"));
    try {
      const payload = await buildPayload();
      const result = await exportFuelUsageDetailToGoogleSheet(payload);
      if (result.needsAuth) {
        savePendingFuelUsageGoogleSheetExport({ filter });
        startFuelUsageGoogleSheetOAuth();
        return false;
      }
      if (!result.ok) {
        setError(result.message ?? tHarvest("exportGoogleSheetFailed"));
        return false;
      }
      clearPendingFuelUsageGoogleSheetExport();
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
    buildPayload,
    filter,
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

  const onExport = async () => {
    if (!canExport || selectedFarmIds.length === 0 || kinds.length === 0) return;
    setExporting(true);
    setError(null);
    try {
      if (format === "google_sheet") {
        if (!googleSheetConnected) {
          savePendingFuelUsageGoogleSheetExport({ filter });
          startFuelUsageGoogleSheetOAuth();
          return;
        }
        await runGoogleSheetExport();
        return;
      }

      const payload = await buildPayload();
      if (format === "csv") {
        exportFuelUsageDetailToCsv(payload);
        onClose();
        return;
      }
      setProgressMessage(t("export.exportExcelPreparing"));
      await exportFuelUsageDetailToXlsx(payload);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : tHarvest("exportFailed"));
    } finally {
      setExporting(false);
      setProgressMessage(null);
    }
  };

  const kindOptions: Array<{ kind: FuelUsageExportKind; label: string; hint: string }> = [
    {
      kind: "usage",
      label: t("export.kinds.usage"),
      hint: t("export.kinds.usageHint"),
    },
    {
      kind: "imports",
      label: t("export.kinds.imports"),
      hint: t("export.kinds.importsHint"),
    },
    {
      kind: "openings",
      label: t("export.kinds.openings"),
      hint: t("export.kinds.openingsHint"),
    },
  ];

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
        aria-labelledby="fuel-usage-export-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-1.5 border-b border-border p-6 pb-4">
          <h2 id="fuel-usage-export-title" className="text-base font-semibold">
            {t("export.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("export.subtitle")}</p>
          <p className="text-sm font-medium text-foreground">{fileName}</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6 pt-4">
          <div className="mb-4 space-y-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("export.kindsTitle")}
            </p>
            <div className="grid gap-2">
              {kindOptions.map((opt) => {
                const checked = kinds.includes(opt.kind);
                return (
                  <label
                    key={opt.kind}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 transition-colors",
                      checked
                        ? "border-primary bg-primary/10"
                        : "border-border bg-background hover:bg-muted/50",
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onChange={() => toggleKind(opt.kind)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block text-sm font-medium">{opt.label}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {opt.hint}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                {t("export.selectFarm")}
              </span>
              <MultiSelect
                options={farmOptions.map((f) => ({ value: f.id, label: f.label }))}
                values={selectedFarmIds}
                onChange={setSelectedFarmIds}
                placeholder={t("export.selectFarm")}
                showAllOption
                className={cn(
                  "w-full rounded-md border border-input text-sm",
                  bgSurfaceFilter(selectedFarmIds.length > 0),
                )}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("export.dateFrom")}
                </span>
                <input
                  type="date"
                  className={inputClass}
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("export.dateTo")}
                </span>
                <input
                  type="date"
                  className={inputClass}
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </label>
            </div>
          </div>

          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {tHarvest("exportFormat")}
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

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {progressMessage ? (
            <p className="text-sm text-muted-foreground">{progressMessage}</p>
          ) : null}
          {lastSpreadsheetUrl ? (
            <a
              href={lastSpreadsheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {tHarvest("exportGoogleSheetOpen")}
            </a>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-border p-4">
          <button type="button" className={actionBtnClass} onClick={onClose} disabled={exporting}>
            {tCommon("cancel")}
          </button>
          <button
            type="button"
            className={cn(actionBtnClass, "border-primary bg-primary text-primary-foreground hover:bg-primary/90")}
            disabled={
              exporting ||
              !canExport ||
              selectedFarmIds.length === 0 ||
              kinds.length === 0 ||
              (format === "google_sheet" && !googleSheetConfigured)
            }
            onClick={() => void onExport()}
          >
            {exporting ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-1.5 h-4 w-4" />
            )}
            {format === "google_sheet" && !googleSheetConnected
              ? tHarvest("exportGoogleSheetConnect")
              : t("export.button")}
          </button>
        </div>
      </div>
    </div>
  );
}
