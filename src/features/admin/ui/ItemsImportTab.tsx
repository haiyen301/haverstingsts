"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckSquare, Square, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";

import {
  commitItemsImport,
  previewItemsImport,
} from "@/features/admin/api/itemsApi";
import {
  parseItemsImportWorkbook,
  type ItemImportInputRow,
  type ItemImportPreview,
  type ItemImportPreviewRow,
  type ItemImportPreviewStatus,
} from "@/features/admin/lib/itemsImport";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useModuleAccess } from "@/shared/auth/useModuleAccess";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";

const btnPrimary =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50";
const btnOutline =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/80 disabled:pointer-events-none disabled:opacity-50";

function statusBadgeClass(status: ItemImportPreviewStatus): string {
  switch (status) {
    case "ready":
      return "bg-emerald-100 text-emerald-800";
    case "skip_duplicate":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-red-100 text-red-800";
  }
}

function statusLabel(
  status: ItemImportPreviewStatus,
  t: ReturnType<typeof useTranslations<"AdminItems.import">>,
): string {
  switch (status) {
    case "ready":
      return t("status.ready");
    case "skip_duplicate":
      return t("status.skipDuplicate");
    default:
      return t("status.skipInvalid");
  }
}

function cellText(value: string | null | undefined): string {
  const text = String(value ?? "").trim();
  return text || "—";
}

export function ItemsImportTab() {
  const t = useTranslations("AdminItems.import");
  const tItems = useTranslations("AdminItems");
  const router = useRouter();
  const { canCreate } = useModuleAccess("admin_items");
  const canImport = canCreate;

  const [sourceRows, setSourceRows] = useState<ItemImportInputRow[]>([]);
  const [sourceLabel, setSourceLabel] = useState("");
  const [preview, setPreview] = useState<ItemImportPreview | null>(null);
  const [selectedRowIndexes, setSelectedRowIndexes] = useState<Set<number>>(new Set());
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [statusFilter, setStatusFilter] = useState<"all" | ItemImportPreviewStatus>("all");

  const applyPreviewSelection = useCallback((result: ItemImportPreview) => {
    const readyIndexes = result.rows
      .filter((row) => row.status === "ready")
      .map((row) => row.row_index);
    setSelectedRowIndexes(new Set(readyIndexes));
  }, []);

  const runPreview = useCallback(
    async (rows: ItemImportInputRow[], label: string) => {
      setLoadingPreview(true);
      setError(null);
      setPreview(null);
      setSourceRows(rows);
      setSourceLabel(label);
      setSelectedRowIndexes(new Set());
      try {
        const result = await previewItemsImport(rows);
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
    [applyPreviewSelection, t],
  );

  const handleFile = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const rows = parseItemsImportWorkbook(buffer);
      await runPreview(rows, file.name);
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

  const toggleRow = (row: ItemImportPreviewRow) => {
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

  const handleConfirmImport = async () => {
    if (!preview || !sourceRows.length || selectedRowIndexes.size === 0) return;

    const selectedRows = sourceRows.filter((row) => selectedRowIndexes.has(row.row_index));
    if (!selectedRows.length) return;

    setImporting(true);
    setError(null);
    try {
      const result = await commitItemsImport(selectedRows);
      toast.success(
        t("success", {
          imported: result.summary.imported ?? 0,
          failed: result.summary.failed ?? 0,
          skipped: result.summary.skipped ?? 0,
        }),
        { containerId: TOAST_CONTAINER_TOP_RIGHT, autoClose: 8000 },
      );
      router.push("/admin/settings/items");
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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 p-4 lg:p-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <Link
            href="/admin/settings/items"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("backToItems")}
          </Link>
          <div>
            <h1 className="text-2xl font-semibold">{t("title")}</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={btnOutline}
            onClick={() => router.push("/admin/settings/items")}
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
            {importing ? t("importing") : t("confirmImport", { count: selectedRowIndexes.size })}
          </button>
        </div>
      </div>

      {!canImport ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t("noPermission")}
        </p>
      ) : null}

      <Card>
        <CardContent className="space-y-4 p-4 lg:p-6">
          <div className="flex flex-wrap items-center gap-3">
            <label className={cn(btnPrimary, !canImport && "cursor-not-allowed opacity-50")}>
              <Upload className="h-4 w-4" />
              {t("uploadFile")}
              <input
                key={fileInputKey}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                disabled={!canImport || loadingPreview || importing}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                  setFileInputKey((key) => key + 1);
                }}
              />
            </label>
            {sourceLabel ? (
              <span className="text-sm text-muted-foreground">
                {t("fileLabel")}: <span className="font-medium text-foreground">{sourceLabel}</span>
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">{tItems("importExcel")}</span>
            )}
          </div>

          {loadingPreview ? (
            <p className="text-sm text-muted-foreground">{t("processingFile")}</p>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {summary ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
                <div className="text-sm text-muted-foreground">{t("summary.total")}</div>
                <div className="text-2xl font-semibold">{summary.total}</div>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                <div className="text-sm text-emerald-800">{t("summary.ready")}</div>
                <div className="text-2xl font-semibold text-emerald-900">{summary.ready}</div>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="text-sm text-amber-800">{t("summary.duplicate")}</div>
                <div className="text-2xl font-semibold text-amber-900">{summary.skip_duplicate}</div>
              </div>
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                <div className="text-sm text-red-800">{t("summary.invalid")}</div>
                <div className="text-2xl font-semibold text-red-900">{summary.skip_invalid}</div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {preview ? (
        <Card className="min-h-0 flex-1">
          <CardContent className="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={btnOutline} onClick={() => setStatusFilter("all")}>
                  {t("filters.all")}
                </button>
                <button type="button" className={btnOutline} onClick={() => setStatusFilter("ready")}>
                  {t("filters.ready")}
                </button>
                <button
                  type="button"
                  className={btnOutline}
                  onClick={() => setStatusFilter("skip_duplicate")}
                >
                  {t("filters.duplicate")}
                </button>
                <button
                  type="button"
                  className={btnOutline}
                  onClick={() => setStatusFilter("skip_invalid")}
                >
                  {t("filters.invalid")}
                </button>
              </div>
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
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border">
              <table className="w-full min-w-[1400px] text-sm">
                <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                  <tr className="border-b border-border">
                    <th className="px-3 py-3 text-left">
                      <button
                        type="button"
                        className="inline-flex items-center text-muted-foreground hover:text-foreground"
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
                    <th className="px-3 py-3 text-left font-medium">{t("table.row")}</th>
                    <th className="px-3 py-3 text-left font-medium">{t("table.status")}</th>
                    <th className="px-3 py-3 text-left font-medium">{t("table.skuSts")}</th>
                    <th className="px-3 py-3 text-left font-medium">{t("table.oldSku")}</th>
                    <th className="px-3 py-3 text-left font-medium">{t("table.code")}</th>
                    <th className="px-3 py-3 text-left font-medium">{t("table.name")}</th>
                    <th className="px-3 py-3 text-left font-medium">{t("table.brand")}</th>
                    <th className="px-3 py-3 text-left font-medium">{t("table.category")}</th>
                    <th className="px-3 py-3 text-left font-medium">{t("table.unit")}</th>
                    <th className="px-3 py-3 text-left font-medium">{t("table.reason")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPreviewRows.map((row) => {
                    const isReady = row.status === "ready";
                    const isSelected = selectedRowIndexes.has(row.row_index);
                    return (
                      <tr
                        key={row.row_index}
                        className={cn(
                          "border-b border-border last:border-b-0",
                          isSelected && "bg-primary/5",
                        )}
                      >
                        <td className="px-3 py-2.5">
                          <button
                            type="button"
                            className={cn(
                              "inline-flex items-center",
                              isReady
                                ? "text-foreground hover:text-primary"
                                : "cursor-not-allowed text-muted-foreground/50",
                            )}
                            disabled={!isReady}
                            onClick={() => toggleRow(row)}
                            aria-label={t("toggleRow")}
                          >
                            {isSelected ? (
                              <CheckSquare className="h-4 w-4" />
                            ) : (
                              <Square className="h-4 w-4" />
                            )}
                          </button>
                        </td>
                        <td className="px-3 py-2.5">{row.row_index}</td>
                        <td className="px-3 py-2.5">
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                              statusBadgeClass(row.status),
                            )}
                          >
                            {statusLabel(row.status, t)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-medium">{cellText(row.sku_sts)}</td>
                        <td className="px-3 py-2.5">{cellText(row.old_sku)}</td>
                        <td className="px-3 py-2.5">{cellText(row.commodity_code)}</td>
                        <td className="px-3 py-2.5">{cellText(row.commodity_name)}</td>
                        <td className="px-3 py-2.5 text-muted-foreground">{cellText(row.brand)}</td>
                        <td className="px-3 py-2.5 text-muted-foreground">{cellText(row.category_path)}</td>
                        <td className="px-3 py-2.5 text-muted-foreground">{cellText(row.unit)}</td>
                        <td className="px-3 py-2.5 text-muted-foreground">{cellText(row.reason)}</td>
                      </tr>
                    );
                  })}
                  {filteredPreviewRows.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-3 py-12 text-center text-muted-foreground">
                        {t("table.empty")}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            {visibleSelectedCount > 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("visibleSelectedCount", { count: visibleSelectedCount })}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
