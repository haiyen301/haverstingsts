"use client";

import { useCallback, useMemo, useState } from "react";
import { Download, FlaskConical, Upload, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";

import {
  commitStockSummaryImport,
  previewStockSummaryImport,
  type StockSummaryRow,
} from "@/features/warehouse/api/stockSummaryApi";
import {
  DEFAULT_COUNTRY_ID,
  inventoryImportMissingColumnsMessage,
  type InventoryImportFileCountry,
} from "@/features/inventory/lib/inventoryOnhandImport";
import {
  buildStockSummaryTestImportRows,
  downloadStockSummaryImportTemplate,
  parseStockSummaryImportWorkbook,
  parseStockSummaryRawWorkbook,
  type StockSummaryImportInputRow,
  type StockSummaryImportPreview,
  type StockSummaryImportPreviewRow,
} from "@/features/warehouse/lib/stockSummaryImport";
import { cn } from "@/lib/utils";
import { bgSurfaceFilter } from "@/shared/lib/surfaceFilter";
import { canAccessModule } from "@/shared/auth/permissions";
import { formatNumber } from "@/shared/lib/format/number";
import { useAuthUserStore } from "@/shared/store/authUserStore";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";

const btnPrimary =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50";
const btnOutline =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/80 disabled:pointer-events-none disabled:opacity-50";

const FILE_COUNTRY_OPTIONS: Array<{
  value: InventoryImportFileCountry;
  labelKey: "fileCountryVn" | "fileCountryTh";
}> = [
  { value: "vn", labelKey: "fileCountryVn" },
  { value: "th", labelKey: "fileCountryTh" },
];

type StockSummaryImportDialogProps = {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
  stockRows: StockSummaryRow[];
  countries: Array<{ id: number; label: string; code: string }>;
};

function actionBadgeClass(action: StockSummaryImportPreviewRow["action"]): string {
  switch (action) {
    case "insert":
      return "bg-emerald-100 text-emerald-800";
    case "update":
      return "bg-sky-100 text-sky-800";
    case "inactive":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-red-100 text-red-800";
  }
}

export function StockSummaryImportDialog({
  open,
  onClose,
  onImported,
  stockRows,
  countries,
}: StockSummaryImportDialogProps) {
  const t = useTranslations("StockSummary.import");
  const user = useAuthUserStore((s) => s.user);
  const canImport =
    canAccessModule(user, "inventory", "import") ||
    canAccessModule(user, "inventory", "create");

  const [sourceRows, setSourceRows] = useState<StockSummaryImportInputRow[]>([]);
  const [sourceLabel, setSourceLabel] = useState("");
  const [preview, setPreview] = useState<StockSummaryImportPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [fileCountry, setFileCountry] = useState<InventoryImportFileCountry | "">("");
  const [countryId, setCountryId] = useState("");

  const resetState = useCallback(() => {
    setSourceRows([]);
    setSourceLabel("");
    setPreview(null);
    setError(null);
    setFileCountry("");
    setCountryId("");
    setFileInputKey((key) => key + 1);
  }, []);

  const closeDialog = useCallback(() => {
    resetState();
    onClose();
  }, [onClose, resetState]);

  const runPreview = useCallback(
    async (rows: StockSummaryImportInputRow[], label: string) => {
      setLoadingPreview(true);
      setError(null);
      setPreview(null);
      setSourceRows(rows);
      setSourceLabel(label);
      try {
        const result = await previewStockSummaryImport({ rows });
        setPreview(result);
      } catch (e) {
        const message = e instanceof Error ? e.message : t("errors.preview");
        setError(message);
        toast.error(message, { containerId: TOAST_CONTAINER_TOP_RIGHT });
      } finally {
        setLoadingPreview(false);
      }
    },
    [t],
  );

  const resolveParseErrorMessage = useCallback(
    (code: string, selectedFileCountry: InventoryImportFileCountry | "") => {
      if (code === "invalidSheet" || code === "emptySheet" || code === "noRows") {
        return t(`errors.${code}`);
      }
      if (code === "missingColumns" && selectedFileCountry) {
        const labels = inventoryImportMissingColumnsMessage(selectedFileCountry);
        return t("errors.missingColumns", {
          skuColumn: labels.skuLabel,
          quantityColumn: labels.quantityLabel,
        });
      }
      return t("errors.parse");
    },
    [t],
  );

  const handleFile = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const rows =
        fileCountry === "vn" || fileCountry === "th"
          ? parseStockSummaryRawWorkbook(
              buffer,
              fileCountry,
              countryId || DEFAULT_COUNTRY_ID[fileCountry],
            )
          : parseStockSummaryImportWorkbook(buffer);
      await runPreview(rows, file.name);
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      const message = resolveParseErrorMessage(code, fileCountry);
      setError(message);
      toast.error(message, { containerId: TOAST_CONTAINER_TOP_RIGHT });
    }
  };

  const handleLoadTestData = async () => {
    const rows = buildStockSummaryTestImportRows({ stockRows, countries });
    await runPreview(rows, t("testDataLabel"));
  };

  const handleConfirmImport = async () => {
    if (!sourceRows.length || !preview) return;
    setImporting(true);
    setError(null);
    try {
      const result = await commitStockSummaryImport({
        rows: sourceRows,
        country_id: preview.country_id,
      });
      setPreview(result);
      toast.success(
        t("success", {
          imported: result.summary.imported ?? 0,
          inactive: result.summary.inactive ?? 0,
          failed: result.summary.failed ?? 0,
        }),
        { containerId: TOAST_CONTAINER_TOP_RIGHT, autoClose: 8000 },
      );
      onImported();
      closeDialog();
    } catch (e) {
      const message = e instanceof Error ? e.message : t("errors.commit");
      setError(message);
      toast.error(message, { containerId: TOAST_CONTAINER_TOP_RIGHT });
    } finally {
      setImporting(false);
    }
  };

  const summary = preview?.summary;
  const canConfirm =
    !!preview &&
    (preview.summary.valid ?? 0) > 0 &&
    !loadingPreview &&
    !importing;

  const countryLabel = useMemo(() => {
    if (!preview?.country_id) return "—";
    const match = countries.find((country) => country.id === preview.country_id);
    if (!match) return String(preview.country_id);
    return `${match.label} (${match.code || preview.country_id})`;
  }, [countries, preview?.country_id]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[min(92vh,56rem)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{t("title")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={closeDialog}
            className="rounded-md p-2 text-muted-foreground transition hover:bg-muted/40 hover:text-foreground"
            aria-label={t("close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {!canImport ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {t("noPermission")}
            </p>
          ) : null}

          <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="block text-sm text-foreground" htmlFor="import-file-country">
                  {t("fileCountryLabel")}
                </label>
                <select
                  id="import-file-country"
                  value={fileCountry}
                  onChange={(e) => {
                    const nextCountry = e.target.value as InventoryImportFileCountry | "";
                    setFileCountry(nextCountry);
                    setCountryId(nextCountry ? DEFAULT_COUNTRY_ID[nextCountry] : "");
                    setError(null);
                  }}
                  disabled={!canImport || loadingPreview || importing}
                  className={cn(
                    "w-full rounded-lg border border-input px-3 py-2 text-sm",
                    bgSurfaceFilter(!!fileCountry),
                  )}
                >
                  <option value="">{t("fileCountryFormatted")}</option>
                  {FILE_COUNTRY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {t(option.labelKey)}
                    </option>
                  ))}
                </select>
                {fileCountry === "vn" ? (
                  <p className="text-xs text-muted-foreground">{t("fileCountryHintVn")}</p>
                ) : null}
                {fileCountry === "th" ? (
                  <p className="text-xs text-muted-foreground">{t("fileCountryHintTh")}</p>
                ) : null}
              </div>
              {fileCountry ? (
                <div className="space-y-2">
                  <label className="block text-sm text-foreground" htmlFor="import-country-id">
                    {t("countryLabel")}
                  </label>
                  <input
                    id="import-country-id"
                    type="text"
                    inputMode="numeric"
                    value={countryId}
                    onChange={(e) => setCountryId(e.target.value)}
                    placeholder={t("countryPlaceholder")}
                    disabled={!canImport || loadingPreview || importing}
                    className={cn(
                      "w-full rounded-lg border border-input px-3 py-2 text-sm",
                      bgSurfaceFilter(!!countryId.trim()),
                    )}
                  />
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label
              className={cn(
                btnPrimary,
                !canImport && "cursor-not-allowed opacity-50",
              )}
            >
              <Upload className="h-4 w-4" />
              {fileCountry ? t("uploadRaw") : t("uploadFile")}
              <input
                key={fileInputKey}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                disabled={!canImport || loadingPreview || importing}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                }}
              />
            </label>
            <button
              type="button"
              className={btnOutline}
              disabled={!canImport || loadingPreview || importing}
              onClick={() => void handleLoadTestData()}
            >
              <FlaskConical className="h-4 w-4" />
              {t("loadTestData")}
            </button>
            <button
              type="button"
              className={btnOutline}
              onClick={downloadStockSummaryImportTemplate}
            >
              <Download className="h-4 w-4" />
              {t("downloadTemplate")}
            </button>
          </div>

          <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">{t("formatTitle")}</p>
            <p className="mt-1">{fileCountry ? t("formatHintRaw") : t("formatHint")}</p>
          </div>

          {sourceLabel ? (
            <p className="text-sm text-muted-foreground">
              {t("source")}: <span className="font-medium text-foreground">{sourceLabel}</span>
            </p>
          ) : null}

          {loadingPreview ? (
            <p className="text-sm text-muted-foreground">{t("previewLoading")}</p>
          ) : null}

          {summary ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <div className="rounded-lg border border-border bg-background p-3">
                <p className="text-xs text-muted-foreground">{t("summary.total")}</p>
                <p className="text-xl font-semibold">{summary.total}</p>
              </div>
              <div className="rounded-lg border border-border bg-background p-3">
                <p className="text-xs text-muted-foreground">{t("summary.valid")}</p>
                <p className="text-xl font-semibold text-emerald-700">{summary.valid}</p>
              </div>
              <div className="rounded-lg border border-border bg-background p-3">
                <p className="text-xs text-muted-foreground">{t("summary.inserts")}</p>
                <p className="text-xl font-semibold">{summary.inserts}</p>
              </div>
              <div className="rounded-lg border border-border bg-background p-3">
                <p className="text-xs text-muted-foreground">{t("summary.updates")}</p>
                <p className="text-xl font-semibold">{summary.updates}</p>
              </div>
              <div className="rounded-lg border border-border bg-background p-3">
                <p className="text-xs text-muted-foreground">{t("summary.inactive")}</p>
                <p className="text-xl font-semibold text-amber-700">{summary.inactive}</p>
              </div>
              <div className="rounded-lg border border-border bg-background p-3">
                <p className="text-xs text-muted-foreground">{t("summary.errors")}</p>
                <p className="text-xl font-semibold text-red-700">{summary.errors}</p>
              </div>
            </div>
          ) : null}

          {preview ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{t("previewTitle")}</h3>
                  <p className="text-xs text-muted-foreground">
                    {t("previewCountry", { country: countryLabel })}
                  </p>
                  <p className="mt-1 text-xs text-amber-800">{t("previewWarning")}</p>
                </div>
              </div>
              <div className="overflow-auto rounded-md border border-border max-h-[min(420px,50vh)]">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 z-1 bg-muted/80">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">#</th>
                      <th className="px-3 py-2 text-left font-medium">{t("table.skuSts")}</th>
                      <th className="px-3 py-2 text-left font-medium">{t("table.name")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("table.current")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("table.new")}</th>
                      <th className="px-3 py-2 text-center font-medium">{t("table.country")}</th>
                      <th className="px-3 py-2 text-left font-medium">{t("table.action")}</th>
                      <th className="px-3 py-2 text-left font-medium">{t("table.note")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => (
                      <tr key={`${row.line}-${row.sku_sts}`} className="border-t border-border/60">
                        <td className="px-3 py-2 text-muted-foreground tabular-nums">{row.line}</td>
                        <td className="px-3 py-2 font-medium">{row.sku_sts || "—"}</td>
                        <td className="px-3 py-2">{row.commodity_name || "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {row.current_on_hand != null
                            ? formatNumber(row.current_on_hand)
                            : "—"}
                        </td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">
                          {row.on_hand != null ? formatNumber(row.on_hand) : "—"}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {row.country_code || row.country_id || "—"}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
                              actionBadgeClass(row.action),
                            )}
                          >
                            {t(`actions.${row.action}`)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {row.error || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-border px-5 py-4">
          <button type="button" className={btnOutline} onClick={closeDialog} disabled={importing}>
            {t("cancel")}
          </button>
          <button
            type="button"
            className={btnPrimary}
            disabled={!canConfirm || !canImport}
            onClick={() => void handleConfirmImport()}
          >
            {importing ? t("importing") : t("confirmImport")}
          </button>
        </div>
      </div>
    </div>
  );
}
