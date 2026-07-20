"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Loader2, Upload, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";

import type { FertilizerProductRow } from "@/features/admin/api/adminApi";
import {
  importFertilizerUsageBulk,
  type FertilizerUsageImportEntryPayload,
} from "@/features/fertilizer/api/fertilizerUsageApi";
import {
  buildFertilizerUsageImportPreview,
  downloadFertilizerUsageImportTemplate,
  parseFertilizerUsageImportWorkbook,
  type FertilizerUsageImportOption,
  type FertilizerUsageImportPreview,
  type FertilizerUsageImportPreviewRow,
} from "@/features/fertilizer/lib/fertilizerUsageImport";
import { cn } from "@/lib/utils";
import { formatDateDisplay } from "@/shared/lib/format/date";
import { formatNumber } from "@/shared/lib/format/number";
import type { FarmZoneReferenceRow } from "@/shared/lib/harvestReferenceData";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";

const PREVIEW_PAGE_SIZE = 25;

const btnPrimary =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
const btnOutline =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Props = {
  open: boolean;
  onClose: () => void;
  onImported?: () => void;
  farms: FertilizerUsageImportOption[];
  grasses: FertilizerUsageImportOption[];
  products: FertilizerProductRow[];
  staffs: FertilizerUsageImportOption[];
  farmZones: FarmZoneReferenceRow[];
};

function cellText(value: string | null | undefined): string {
  const text = String(value ?? "").trim();
  return text || "—";
}

export function FertilizerUsageImportDialog({
  open,
  onClose,
  onImported,
  farms,
  grasses,
  products,
  staffs,
  farmZones,
}: Props) {
  const t = useTranslations("FertilizerUsage.import");

  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [fileLabel, setFileLabel] = useState("");
  const [preview, setPreview] = useState<FertilizerUsageImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [previewVisibleCount, setPreviewVisibleCount] = useState(PREVIEW_PAGE_SIZE);
  const [statusFilter, setStatusFilter] = useState<"all" | "ready" | "invalid">("all");

  const messages = useMemo(
    () => ({
      dateInvalid: t("reasons.dateInvalid"),
      farmNotFound: t("reasons.farmNotFound"),
      grassNotFound: t("reasons.grassNotFound"),
      zoneNotFound: t("reasons.zoneNotFound"),
      productNotFound: t("reasons.productNotFound"),
      amountInvalid: t("reasons.amountInvalid"),
      transferFarmInvalid: t("reasons.transferFarmInvalid"),
    }),
    [t],
  );

  const rebuildPreview = (rows: ReturnType<typeof parseFertilizerUsageImportWorkbook>) => {
    const result = buildFertilizerUsageImportPreview(
      rows,
      { farms, grasses, products, staffs, farmZones },
      messages,
    );
    setPreview(result);
  };

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setError(null);
    setFileLabel("");
    setStatusFilter("all");
    setPreviewVisibleCount(PREVIEW_PAGE_SIZE);
    setFileInputKey((key) => key + 1);
  }, [open]);

  const handleExcelFile = async (file: File) => {
    setParsing(true);
    setError(null);
    setPreview(null);
    setFileLabel(file.name);
    setPreviewVisibleCount(PREVIEW_PAGE_SIZE);
    setStatusFilter("all");

    try {
      const buffer = await file.arrayBuffer();
      const rows = parseFertilizerUsageImportWorkbook(buffer);
      rebuildPreview(rows);
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      const message =
        code === "emptySheet" || code === "noRows" || code === "missingColumns"
          ? t(`errors.${code}`)
          : t("errors.parse");
      setError(message);
      toast.error(message, { containerId: TOAST_CONTAINER_TOP_RIGHT });
    } finally {
      setParsing(false);
    }
  };

  const filteredRows = useMemo(() => {
    if (!preview) return [];
    if (statusFilter === "all") return preview.rows;
    return preview.rows.filter((row) => row.status === statusFilter);
  }, [preview, statusFilter]);

  const visibleRows = useMemo(
    () => filteredRows.slice(0, previewVisibleCount),
    [filteredRows, previewVisibleCount],
  );

  const readyRows = useMemo(() => {
    if (!preview) return [];
    return preview.rows.filter(
      (row): row is FertilizerUsageImportPreviewRow & { entry: FertilizerUsageImportEntryPayload } =>
        row.status === "ready" && row.entry != null,
    );
  }, [preview]);

  const runImport = async () => {
    if (!readyRows.length) return;
    setImporting(true);
    setError(null);
    try {
      const entries = readyRows.map((row) => row.entry);
      const result = await importFertilizerUsageBulk({ entries });
      const summary = result?.summary;
      toast.success(
        summary
          ? t("success", {
              created: summary.created,
              skipped: summary.skipped,
            })
          : t("successGeneric"),
        { containerId: TOAST_CONTAINER_TOP_RIGHT, autoClose: 8000 },
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

  const summary = preview?.summary;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[min(92vh,56rem)] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
        <div className="flex shrink-0 items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{t("title")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-muted-foreground transition hover:bg-muted/40 hover:text-foreground"
            aria-label={t("close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <div className="flex flex-wrap items-center gap-3">
            <label className={cn(btnOutline, "cursor-pointer")}>
              {parsing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {t("uploadFile")}
              <input
                key={fileInputKey}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="sr-only"
                disabled={parsing || importing}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleExcelFile(file);
                }}
              />
            </label>
            <button
              type="button"
              className={btnOutline}
              disabled={parsing || importing}
              onClick={() => downloadFertilizerUsageImportTemplate()}
            >
              <Download className="h-4 w-4" />
              {t("downloadTemplate")}
            </button>
            {fileLabel ? (
              <span className="text-sm text-muted-foreground">
                {t("fileLabel")}: {fileLabel}
              </span>
            ) : null}
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {summary ? (
            <div className="flex flex-wrap gap-2 text-sm">
              {(
                [
                  ["all", summary.total],
                  ["ready", summary.ready],
                  ["invalid", summary.invalid],
                ] as const
              ).map(([key, count]) => (
                <button
                  key={key}
                  type="button"
                  className={cn(
                    "rounded-full border px-3 py-1 transition-colors",
                    statusFilter === key
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:bg-muted/50",
                  )}
                  onClick={() => {
                    setStatusFilter(key);
                    setPreviewVisibleCount(PREVIEW_PAGE_SIZE);
                  }}
                >
                  {t(`filters.${key}`)} ({count})
                </button>
              ))}
            </div>
          ) : null}

          {preview ? (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[1040px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-xs">
                    <th className="px-3 py-2 text-left font-medium">{t("table.row")}</th>
                    <th className="px-3 py-2 text-left font-medium">{t("table.status")}</th>
                    <th className="px-3 py-2 text-left font-medium">{t("table.date")}</th>
                    <th className="px-3 py-2 text-left font-medium">{t("table.farm")}</th>
                    <th className="px-3 py-2 text-left font-medium">{t("table.grass")}</th>
                    <th className="px-3 py-2 text-left font-medium">{t("table.zone")}</th>
                    <th className="px-3 py-2 text-left font-medium">{t("table.product")}</th>
                    <th className="px-3 py-2 text-left font-medium">{t("table.uom")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("table.amount")}</th>
                    <th className="px-3 py-2 text-left font-medium">{t("table.transfer")}</th>
                    <th className="px-3 py-2 text-left font-medium">{t("table.sender")}</th>
                    <th className="px-3 py-2 text-left font-medium">{t("table.receiver")}</th>
                    <th className="px-3 py-2 text-left font-medium">{t("table.reason")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => (
                    <tr key={row.row_index} className="border-b border-border last:border-b-0">
                      <td className="px-3 py-2 text-muted-foreground">{row.row_index}</td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                            row.status === "ready"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-red-100 text-red-800",
                          )}
                        >
                          {row.status === "ready" ? t("status.ready") : t("status.invalid")}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {row.applied_date ? formatDateDisplay(row.applied_date) : "—"}
                      </td>
                      <td className="px-3 py-2">{cellText(row.farm_label)}</td>
                      <td className="px-3 py-2">{cellText(row.grass_label)}</td>
                      <td className="px-3 py-2">{cellText(row.zone_label)}</td>
                      <td className="px-3 py-2 font-medium">
                        {cellText(row.product_label)}
                        {row.product_score > 0 && row.product_score < 1 ? (
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            ({t("matchedScore", { score: Math.round(row.product_score * 100) })})
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {cellText(row.product_uom)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.amount > 0
                          ? formatNumber(row.amount, { maximumFractionDigits: 3 })
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {cellText(row.transfer_farm_label)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {cellText(row.issued_by_label)}
                        {row.people_missing.length > 0 && !row.issued_by_label ? (
                          <span className="text-amber-700"> —</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {cellText(row.received_by_label)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{cellText(row.reason)}</td>
                    </tr>
                  ))}
                  {!visibleRows.length ? (
                    <tr>
                      <td colSpan={13} className="px-3 py-6 text-center text-muted-foreground">
                        {t("table.empty")}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
              {previewVisibleCount < filteredRows.length ? (
                <div className="border-t border-border p-2">
                  <button
                    type="button"
                    className={btnOutline}
                    onClick={() =>
                      setPreviewVisibleCount((count) => count + PREVIEW_PAGE_SIZE)
                    }
                  >
                    {t("loadMore")}
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("emptyHint")}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-4">
          <button type="button" className={btnOutline} onClick={onClose} disabled={importing}>
            {t("close")}
          </button>
          <button
            type="button"
            className={btnPrimary}
            disabled={!readyRows.length || parsing || importing}
            onClick={() => void runImport()}
          >
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {importing ? t("importing") : t("confirmImport", { count: readyRows.length })}
          </button>
        </div>
      </div>
    </div>
  );
}
