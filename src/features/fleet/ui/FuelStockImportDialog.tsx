"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Loader2, Upload, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";

import {
  importFleetFuelImportsBulk,
  type FleetFuelImportBulkEntry,
} from "@/features/fleet/api/fleetFuelImportsApi";
import {
  downloadFuelStockImportTemplate,
  isFuelStockImportWorkbook,
  matchFuelStockImportRows,
  parseFuelStockImportWorkbook,
  type FuelStockImportFarmOption,
  type FuelStockImportPreviewRow,
} from "@/features/fleet/lib/fuelStockImport";
import { FLEET_OPTION_CATALOG_KEYS } from "@/features/fleet/api/fleetOptionCatalogApi";
import { useFleetOptionCatalog } from "@/features/fleet/hooks/useFleetOptionCatalog";
import { cn } from "@/lib/utils";
import { formatDateDisplay } from "@/shared/lib/format/date";
import { formatNumber } from "@/shared/lib/format/number";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";

const PREVIEW_PAGE_SIZE = 30;

const btnPrimary =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50";
const btnOutline =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/80 disabled:pointer-events-none disabled:opacity-50";

type Props = {
  open: boolean;
  onClose: () => void;
  farmOptions: FuelStockImportFarmOption[];
  onImported?: () => void;
};

export function FuelStockImportDialog({
  open,
  onClose,
  farmOptions,
  onImported,
}: Props) {
  const t = useTranslations("FuelUsage.stockImport");
  const { options: fuelTypeOptions } = useFleetOptionCatalog(
    FLEET_OPTION_CATALOG_KEYS.fuelTypes,
  );
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [fileLabel, setFileLabel] = useState("");
  const [previewRows, setPreviewRows] = useState<FuelStockImportPreviewRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PREVIEW_PAGE_SIZE);

  useEffect(() => {
    if (!open) return;
    setParsing(false);
    setImporting(false);
    setFileLabel("");
    setPreviewRows([]);
    setError(null);
    setConfirmOpen(false);
    setVisibleCount(PREVIEW_PAGE_SIZE);
    setFileInputKey((key) => key + 1);
  }, [open]);

  const readyRows = useMemo(
    () => previewRows.filter((row) => row.status === "ready"),
    [previewRows],
  );
  const errorRows = useMemo(
    () => previewRows.filter((row) => row.status === "error"),
    [previewRows],
  );
  const visibleRows = useMemo(
    () => previewRows.slice(0, visibleCount),
    [previewRows, visibleCount],
  );

  const errorMessage = (code: string | null): string => {
    if (!code) return "";
    switch (code) {
      case "farmNotFound":
        return t("errors.farmNotFound");
      case "fuelInvalid":
        return t("errors.fuelInvalid");
      case "dateInvalid":
        return t("errors.dateInvalid");
      case "qtyInvalid":
        return t("errors.qtyInvalid");
      case "amountInvalid":
        return t("errors.amountInvalid");
      default:
        return code;
    }
  };

  const handleFile = async (file: File) => {
    if (!isFuelStockImportWorkbook(file.name)) {
      setError(t("errors.invalidFile"));
      return;
    }

    setParsing(true);
    setError(null);
    setPreviewRows([]);
    setFileLabel(file.name);
    setConfirmOpen(false);
    setVisibleCount(PREVIEW_PAGE_SIZE);

    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseFuelStockImportWorkbook(buffer);
      setPreviewRows(matchFuelStockImportRows(parsed, farmOptions, fuelTypeOptions));
    } catch (e) {
      const code = e instanceof Error ? e.message : "parse";
      const message =
        code === "missingColumns"
          ? t("errors.missingColumns")
          : code === "emptySheet" || code === "noRows"
            ? t("errors.noRows")
            : code === "invalidSheet"
              ? t("errors.invalidFile")
              : t("errors.parse");
      setError(message);
      toast.error(message, { containerId: TOAST_CONTAINER_TOP_RIGHT });
    } finally {
      setParsing(false);
    }
  };

  const runImport = async () => {
    if (readyRows.length === 0) return;
    setImporting(true);
    setError(null);
    setConfirmOpen(false);

    const entries: FleetFuelImportBulkEntry[] = readyRows.map((row) => ({
      farm_id: Number(row.farm_id),
      fuel_kind: row.fuel_kind_normalized as string,
      import_date: row.import_date,
      import_qty: Number(row.import_qty),
      import_amount: row.import_amount,
      notes: row.notes.trim() || undefined,
    }));

    try {
      const result = await importFleetFuelImportsBulk({ entries });
      const summary = result?.summary;
      toast.success(
        summary
          ? t("importSuccess", {
              created: summary.created,
              skipped: summary.skipped,
              total: summary.total,
            })
          : t("importSuccessGeneric"),
        { containerId: TOAST_CONTAINER_TOP_RIGHT },
      );
      onImported?.();
      onClose();
    } catch (e) {
      const message = e instanceof Error ? e.message : t("errors.import");
      setError(message);
      toast.error(message, { containerId: TOAST_CONTAINER_TOP_RIGHT });
    } finally {
      setImporting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg border border-border bg-background p-6 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{t("title")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted"
            onClick={onClose}
            aria-label={t("close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          {error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={btnOutline}
              disabled={parsing || importing}
              onClick={() => downloadFuelStockImportTemplate(fuelTypeOptions)}
            >
              <Download className="h-4 w-4" />
              {t("downloadSample")}
            </button>
            <label
              className={cn(
                "inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-input bg-background px-4 text-sm font-medium shadow-sm hover:bg-muted/50",
                (parsing || importing) && "pointer-events-none opacity-50",
              )}
            >
              {parsing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {fileLabel || t("uploadHint")}
              <input
                key={fileInputKey}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="sr-only"
                disabled={parsing || importing}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                }}
              />
            </label>
          </div>

          {previewRows.length > 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {t("previewSummary", {
                  total: previewRows.length,
                  ready: readyRows.length,
                  errors: errorRows.length,
                })}
              </p>
              <div className="overflow-hidden rounded-lg border border-border">
                <div className="max-h-72 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/80 text-muted-foreground backdrop-blur">
                      <tr className="border-b border-border">
                        <th className="px-3 py-2 text-left">{t("colLine")}</th>
                        <th className="px-3 py-2 text-left">{t("colFarm")}</th>
                        <th className="px-3 py-2 text-left">{t("colFuel")}</th>
                        <th className="px-3 py-2 text-left">{t("colDate")}</th>
                        <th className="px-3 py-2 text-right">{t("colQty")}</th>
                        <th className="px-3 py-2 text-right">{t("colAmount")}</th>
                        <th className="px-3 py-2 text-left">{t("colNotes")}</th>
                        <th className="px-3 py-2 text-left">{t("colStatus")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((row) => (
                        <tr key={row.line} className="border-b border-border/60">
                          <td className="px-3 py-2">{row.line}</td>
                          <td className="px-3 py-2">
                            {row.farm_label ?? row.farm}
                          </td>
                          <td className="px-3 py-2">
                            {row.fuel_kind_normalized
                              ? fuelTypeOptions.find(
                                  (option) =>
                                    option.value.toLowerCase() ===
                                    row.fuel_kind_normalized,
                                )?.label ?? row.fuel_kind_normalized
                              : row.fuel_kind}
                          </td>
                          <td className="px-3 py-2">
                            {/^\d{4}-\d{2}-\d{2}$/.test(row.import_date)
                              ? formatDateDisplay(row.import_date)
                              : row.import_date}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {row.import_qty != null
                              ? `${formatNumber(row.import_qty, { maximumFractionDigits: 3 })} L`
                              : "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {row.import_amount != null
                              ? `${formatNumber(row.import_amount, { maximumFractionDigits: 2 })} USD`
                              : "—"}
                          </td>
                          <td className="max-w-[10rem] truncate px-3 py-2" title={row.notes || undefined}>
                            {row.notes || "—"}
                          </td>
                          <td className="px-3 py-2">
                            {row.status === "ready" ? (
                              <span className="text-emerald-700 dark:text-emerald-400">
                                {t("statusReady")}
                              </span>
                            ) : (
                              <span className="text-destructive">
                                {errorMessage(row.error)}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {previewRows.length > visibleCount ? (
                <button
                  type="button"
                  className={btnOutline}
                  onClick={() => setVisibleCount((n) => n + PREVIEW_PAGE_SIZE)}
                >
                  {t("loadMore")}
                </button>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("emptyHint")}</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={btnPrimary}
              disabled={readyRows.length === 0 || importing || parsing}
              onClick={() => setConfirmOpen(true)}
            >
              {importing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {importing ? t("importing") : t("applyImport")}
            </button>
            <button type="button" className={btnOutline} onClick={onClose}>
              {t("close")}
            </button>
          </div>
        </div>
      </div>

      {confirmOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-lg">
            <h3 className="text-base font-semibold">{t("confirmTitle")}</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("confirmBody", { count: readyRows.length })}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className={btnPrimary}
                disabled={importing}
                onClick={() => void runImport()}
              >
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t("confirmApply")}
              </button>
              <button
                type="button"
                className={btnOutline}
                disabled={importing}
                onClick={() => setConfirmOpen(false)}
              >
                {t("close")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
