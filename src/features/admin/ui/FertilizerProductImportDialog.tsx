"use client";

import { useCallback, useMemo, useState } from "react";
import { CheckSquare, Download, Square, Upload, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";

import {
  saveFertilizerProduct,
  type FertilizerProductRow,
} from "@/features/admin/api/adminApi";
import type { CountryRow } from "@/features/admin/api/countriesApi";
import {
  buildFertilizerProductImportPreview,
  downloadFertilizerProductImportTemplate,
  parseFertilizerProductImportWorkbook,
  type FertilizerProductImportInputRow,
  type FertilizerProductImportPreview,
  type FertilizerProductImportPreviewRow,
  type FertilizerProductImportPreviewStatus,
} from "@/features/admin/lib/fertilizerProductImport";
import { cn } from "@/lib/utils";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";

const btnPrimary =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50";
const btnOutline =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/80 disabled:pointer-events-none disabled:opacity-50";

type FertilizerProductImportDialogProps = {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
  existingRows: FertilizerProductRow[];
  countries: CountryRow[];
  canImport: boolean;
};

function statusBadgeClass(status: FertilizerProductImportPreviewStatus): string {
  switch (status) {
    case "ready":
      return "bg-emerald-100 text-emerald-800";
    case "skip_duplicate":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-red-100 text-red-800";
  }
}

function cellText(value: string | null | undefined): string {
  const text = String(value ?? "").trim();
  return text || "—";
}

export function FertilizerProductImportDialog({
  open,
  onClose,
  onImported,
  existingRows,
  countries,
  canImport,
}: FertilizerProductImportDialogProps) {
  const t = useTranslations("AdminFertilizerProduct.import");

  const [sourceRows, setSourceRows] = useState<FertilizerProductImportInputRow[]>([]);
  const [sourceLabel, setSourceLabel] = useState("");
  const [preview, setPreview] = useState<FertilizerProductImportPreview | null>(null);
  const [selectedRowIndexes, setSelectedRowIndexes] = useState<Set<number>>(new Set());
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [statusFilter, setStatusFilter] = useState<"all" | FertilizerProductImportPreviewStatus>(
    "all",
  );

  const resetState = useCallback(() => {
    setSourceRows([]);
    setSourceLabel("");
    setPreview(null);
    setSelectedRowIndexes(new Set());
    setError(null);
    setStatusFilter("all");
    setFileInputKey((key) => key + 1);
  }, []);

  const closeDialog = useCallback(() => {
    resetState();
    onClose();
  }, [onClose, resetState]);

  const previewMessages = useMemo(
    () => ({
      nameRequired: t("reasons.nameRequired"),
      duplicateExisting: t("reasons.duplicateExisting"),
      duplicateInFile: t("reasons.duplicateInFile"),
      countryNotFound: t("reasons.countryNotFound"),
      globalLabel: t("globalLabel"),
    }),
    [t],
  );

  const applyPreviewSelection = useCallback((result: FertilizerProductImportPreview) => {
    const readyIndexes = result.rows
      .filter((row) => row.status === "ready")
      .map((row) => row.row_index);
    setSelectedRowIndexes(new Set(readyIndexes));
  }, []);

  const runPreview = useCallback(
    (rows: FertilizerProductImportInputRow[], label: string) => {
      setLoadingPreview(true);
      setError(null);
      setPreview(null);
      setSourceRows(rows);
      setSourceLabel(label);
      setSelectedRowIndexes(new Set());
      try {
        const result = buildFertilizerProductImportPreview(
          rows,
          existingRows,
          countries,
          previewMessages,
        );
        setPreview(result);
        applyPreviewSelection(result);
      } catch (e) {
        const message = e instanceof Error ? e.message : t("errors.preview");
        setError(message);
        toast.error(message, { containerId: TOAST_CONTAINER_TOP_RIGHT });
      } finally {
        setLoadingPreview(false);
      }
    },
    [applyPreviewSelection, countries, existingRows, previewMessages, t],
  );

  const handleFile = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const rows = parseFertilizerProductImportWorkbook(buffer);
      runPreview(rows, file.name);
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      const message =
        code === "emptySheet" || code === "noRows" || code === "missingColumns"
          ? t(`errors.${code}`)
          : t("errors.parse");
      setError(message);
      toast.error(message, { containerId: TOAST_CONTAINER_TOP_RIGHT });
    }
  };

  const filteredPreviewRows = useMemo(() => {
    if (!preview) return [];
    if (statusFilter === "all") return preview.rows;
    return preview.rows.filter((row) => row.status === statusFilter);
  }, [preview, statusFilter]);

  const readyRowIndexes = useMemo(() => {
    if (!preview) return new Set<number>();
    return new Set(
      preview.rows.filter((row) => row.status === "ready").map((row) => row.row_index),
    );
  }, [preview]);

  const visibleSelectedCount = useMemo(() => {
    return filteredPreviewRows.filter((row) => selectedRowIndexes.has(row.row_index)).length;
  }, [filteredPreviewRows, selectedRowIndexes]);

  const allVisibleSelected =
    filteredPreviewRows.length > 0 &&
    filteredPreviewRows.every((row) => selectedRowIndexes.has(row.row_index));

  const toggleRow = (row: FertilizerProductImportPreviewRow) => {
    if (row.status !== "ready") return;
    setSelectedRowIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(row.row_index)) {
        next.delete(row.row_index);
      } else {
        next.add(row.row_index);
      }
      return next;
    });
  };

  const toggleVisibleRows = () => {
    const visibleReadyRows = filteredPreviewRows.filter((row) => row.status === "ready");
    if (!visibleReadyRows.length) return;

    setSelectedRowIndexes((prev) => {
      const next = new Set(prev);
      const shouldSelectAll = !visibleReadyRows.every((row) => next.has(row.row_index));
      for (const row of visibleReadyRows) {
        if (shouldSelectAll) {
          next.add(row.row_index);
        } else {
          next.delete(row.row_index);
        }
      }
      return next;
    });
  };

  const selectAllReady = () => {
    setSelectedRowIndexes(new Set(readyRowIndexes));
  };

  const clearSelection = () => {
    setSelectedRowIndexes(new Set());
  };

  const statusLabel = (status: FertilizerProductImportPreviewStatus): string => {
    switch (status) {
      case "ready":
        return t("status.ready");
      case "skip_duplicate":
        return t("status.skipDuplicate");
      default:
        return t("status.skipInvalid");
    }
  };

  const handleConfirmImport = async () => {
    if (!preview || !sourceRows.length || selectedRowIndexes.size === 0) return;

    const selectedRows = sourceRows.filter((row) => selectedRowIndexes.has(row.row_index));
    if (!selectedRows.length) return;

    setImporting(true);
    setError(null);

    let imported = 0;
    let failed = 0;

    try {
      for (const row of selectedRows) {
        const previewRow = preview.rows.find((item) => item.row_index === row.row_index);
        if (!previewRow || previewRow.status !== "ready") continue;

        try {
          await saveFertilizerProduct({
            name: previewRow.name,
            uom: previewRow.uom.trim(),
            country_id: previewRow.country_id,
          });
          imported++;
        } catch {
          failed++;
        }
      }

      toast.success(
        t("success", { imported, failed }),
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
    selectedRowIndexes.size > 0 &&
    !loadingPreview &&
    !importing &&
    canImport;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[min(92vh,56rem)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
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

          <div className="flex flex-wrap items-center gap-3">
            <label className={cn(btnOutline, "cursor-pointer")}>
              <Upload className="h-4 w-4" />
              {t("uploadFile")}
              <input
                key={fileInputKey}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="sr-only"
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
              onClick={() => downloadFertilizerProductImportTemplate()}
            >
              <Download className="h-4 w-4" />
              {t("downloadTemplate")}
            </button>
            {sourceLabel ? (
              <span className="text-sm text-muted-foreground">
                {t("fileLabel")}: {sourceLabel}
              </span>
            ) : null}
          </div>

          {loadingPreview ? (
            <p className="text-sm text-muted-foreground">{t("processingFile")}</p>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {summary ? (
            <div className="flex flex-wrap gap-2 text-sm">
              {(
                [
                  ["all", summary.total],
                  ["ready", summary.ready],
                  ["skip_duplicate", summary.skip_duplicate],
                  ["skip_invalid", summary.skip_invalid],
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
                  onClick={() => setStatusFilter(key)}
                >
                  {t(`filters.${key === "skip_duplicate" ? "duplicate" : key === "skip_invalid" ? "invalid" : key}`)}{" "}
                  ({count})
                </button>
              ))}
            </div>
          ) : null}

          {preview ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={btnOutline} onClick={selectAllReady}>
                  {t("selectAllReady")}
                </button>
                <button type="button" className={btnOutline} onClick={clearSelection}>
                  {t("clearSelection")}
                </button>
                <span className="text-sm text-muted-foreground">
                  {t("selectedCount", { count: selectedRowIndexes.size })}
                </span>
                <span className="text-sm text-muted-foreground">
                  {t("visibleSelectedCount", { count: visibleSelectedCount })}
                </span>
              </div>

              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-3 py-2 text-left">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-left"
                          onClick={toggleVisibleRows}
                          aria-label={t("toggleVisible")}
                        >
                          {allVisibleSelected ? (
                            <CheckSquare className="h-4 w-4" />
                          ) : (
                            <Square className="h-4 w-4" />
                          )}
                        </button>
                      </th>
                      <th className="px-3 py-2 text-left font-medium">{t("table.row")}</th>
                      <th className="px-3 py-2 text-left font-medium">{t("table.status")}</th>
                      <th className="px-3 py-2 text-left font-medium">{t("table.name")}</th>
                      <th className="px-3 py-2 text-left font-medium">{t("table.uom")}</th>
                      <th className="px-3 py-2 text-left font-medium">{t("table.country")}</th>
                      <th className="px-3 py-2 text-left font-medium">{t("table.reason")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPreviewRows.map((row) => {
                      const selected = selectedRowIndexes.has(row.row_index);
                      const selectable = row.status === "ready";
                      return (
                        <tr
                          key={row.row_index}
                          className="border-b border-border last:border-b-0"
                        >
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              disabled={!selectable}
                              onClick={() => toggleRow(row)}
                              className={cn(
                                "inline-flex items-center",
                                !selectable && "cursor-not-allowed opacity-40",
                              )}
                              aria-label={t("toggleRow")}
                            >
                              {selected ? (
                                <CheckSquare className="h-4 w-4 text-primary" />
                              ) : (
                                <Square className="h-4 w-4" />
                              )}
                            </button>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{row.row_index}</td>
                          <td className="px-3 py-2">
                            <span
                              className={cn(
                                "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                                statusBadgeClass(row.status),
                              )}
                            >
                              {statusLabel(row.status)}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-medium">{cellText(row.name)}</td>
                          <td className="px-3 py-2 text-muted-foreground">{cellText(row.uom)}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {cellText(row.country_label)}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {cellText(row.reason)}
                          </td>
                        </tr>
                      );
                    })}
                    {!filteredPreviewRows.length ? (
                      <tr>
                        <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                          {t("table.empty")}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-4">
          <button
            type="button"
            className={btnOutline}
            onClick={closeDialog}
            disabled={importing}
          >
            {t("close")}
          </button>
          <button
            type="button"
            className={btnPrimary}
            disabled={!canConfirm}
            onClick={() => void handleConfirmImport()}
          >
            {importing
              ? t("importing")
              : t("confirmImport", { count: selectedRowIndexes.size })}
          </button>
        </div>
      </div>
    </div>
  );
}
