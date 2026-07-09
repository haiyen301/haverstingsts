"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Upload, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";

import {
  importFuelUsageBulk,
  type FuelUsageImportEntryPayload,
} from "@/features/fleet/api/fuelUsageApi";
import type { VehicleInspectionRow } from "@/features/fleet/api/vehicleInspectionsApi";
import {
  isFuelDiaryWorkbook,
  matchFuelUsageImportEntries,
  parseFuelUsageImportWorkbook,
  type FuelUsageImportMatchResult,
  type FuelUsageImportParseResult,
} from "@/features/fleet/lib/fuelUsageImport";
import { cn } from "@/lib/utils";
import { formatDateDisplay } from "@/shared/lib/format/date";
import { formatNumber } from "@/shared/lib/format/number";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";

const PREVIEW_PAGE_SIZE = 25;

const inputClass =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";
const btnPrimary =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
const btnOutline =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export type FuelUsageImportFarmOption = {
  id: string;
  label: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  farmOptions: FuelUsageImportFarmOption[];
  vehicles: VehicleInspectionRow[];
  initialFarmId?: string;
  onImported?: () => void;
};

export function FuelUsageImportDialog({
  open,
  onClose,
  farmOptions,
  vehicles,
  initialFarmId,
  onImported,
}: Props) {
  const t = useTranslations("FuelUsage.import");
  const [farmId, setFarmId] = useState("");
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [fileLabel, setFileLabel] = useState("");
  const [parsed, setParsed] = useState<FuelUsageImportParseResult | null>(null);
  const [matched, setMatched] = useState<FuelUsageImportMatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [previewVisibleCount, setPreviewVisibleCount] = useState(PREVIEW_PAGE_SIZE);

  useEffect(() => {
    if (!open) return;
    setFarmId(initialFarmId || farmOptions[0]?.id || "");
    setParsed(null);
    setMatched(null);
    setError(null);
    setFileLabel("");
    setConfirmOpen(false);
    setPreviewVisibleCount(PREVIEW_PAGE_SIZE);
    setFileInputKey((key) => key + 1);
  }, [open, initialFarmId, farmOptions]);

  useEffect(() => {
    if (!parsed || !farmId) {
      setMatched(null);
      return;
    }
    setMatched(matchFuelUsageImportEntries(parsed.entries, vehicles, Number(farmId)));
  }, [parsed, farmId, vehicles]);

  const selectedFarm = useMemo(
    () => farmOptions.find((farm) => farm.id === farmId) ?? null,
    [farmId, farmOptions],
  );

  const readyRows = useMemo(
    () => matched?.rows.filter((row) => row.status === "ready") ?? [],
    [matched],
  );

  const visiblePreviewRows = useMemo(
    () => readyRows.slice(0, previewVisibleCount),
    [previewVisibleCount, readyRows],
  );

  const handleFile = async (file: File) => {
    if (!isFuelDiaryWorkbook(file.name)) {
      setError(t("errors.invalidFile"));
      return;
    }

    setParsing(true);
    setError(null);
    setParsed(null);
    setMatched(null);
    setFileLabel(file.name);
    setConfirmOpen(false);
    setPreviewVisibleCount(PREVIEW_PAGE_SIZE);

    try {
      const buffer = await file.arrayBuffer();
      const result = await parseFuelUsageImportWorkbook(buffer);
      if (result.entries.length === 0 && result.stock_imports.length === 0) {
        setError(t("errors.noEntries"));
        return;
      }
      setParsed(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : t("errors.parse");
      setError(message);
      toast.error(message, { containerId: TOAST_CONTAINER_TOP_RIGHT });
    } finally {
      setParsing(false);
    }
  };

  const stockImportRows = useMemo(() => parsed?.stock_imports ?? [], [parsed]);

  const canImport = useMemo(() => {
    if (!farmId || !parsed) return false;
    return readyRows.length > 0 || stockImportRows.length > 0;
  }, [farmId, parsed, readyRows.length, stockImportRows.length]);

  const runImport = async () => {
    if (!parsed || !farmId || !canImport) return;

    setImporting(true);
    setError(null);
    setConfirmOpen(false);

    const entries: FuelUsageImportEntryPayload[] = readyRows.map((row) => ({
      fuel_date: row.fuel_date,
      vehicle_inspection_id: Number(row.vehicle_inspection_id),
      vehicle_type: row.vehicle_type,
      fuel_kind: row.fuel_kind,
      litres: row.litres,
    }));

    const stockImports = stockImportRows.map((row) => ({
      balance_date: row.balance_date,
      fuel_kind: row.fuel_kind,
      import_qty: row.import_qty,
    }));

    try {
      const result = await importFuelUsageBulk({
        farm_id: Number(farmId),
        entries: entries.length > 0 ? entries : undefined,
        stock_imports: stockImports.length > 0 ? stockImports : undefined,
      });
      const summary = result?.summary;
      toast.success(
        summary
          ? t("importSuccess", {
              usageCreated: summary.usage.created,
              usageUpdated: summary.usage.updated,
              usageTotal: summary.usage.total,
              stockCreated: summary.stock.created,
              stockUpdated: summary.stock.updated,
              stockTotal: summary.stock.total,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-border bg-background p-6 shadow-lg">
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

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium">{t("farm")} *</span>
              <select
                className={inputClass}
                value={farmId}
                disabled={parsing || importing}
                onChange={(e) => setFarmId(e.target.value)}
              >
                <option value="">{t("selectFarm")}</option>
                {farmOptions.map((farm) => (
                  <option key={farm.id} value={farm.id}>
                    {farm.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="space-y-1">
              <span className="text-xs font-medium">{t("file")}</span>
              <label
                className={cn(
                  "inline-flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-input bg-background px-3 text-sm font-medium shadow-sm hover:bg-muted/50",
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
                  accept=".xlsx,.xls"
                  className="sr-only"
                  disabled={parsing || importing}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFile(file);
                  }}
                />
              </label>
            </div>
          </div>

          {parsed ? (
            <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm">
              <p className="font-medium text-foreground">{t("previewTitle")}</p>
              <p className="mt-1 text-muted-foreground">
                {t("previewSummary", {
                  sheets: parsed.sheets.length,
                  entries: parsed.entries.length,
                  ready: matched?.readyCount ?? 0,
                  unmatched: matched?.unmatchedCount ?? 0,
                  stockImports: parsed.stock_imports.length,
                  from: parsed.date_from ?? "—",
                  to: parsed.date_to ?? "—",
                  farm: selectedFarm?.label ?? farmId,
                })}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">{t("openingHint")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {parsed.sheets.map((sheet) => (
                  <span
                    key={sheet.sheet_name}
                    className="inline-flex rounded-full border border-border bg-background px-2.5 py-0.5 text-xs"
                  >
                    {sheet.sheet_name}: {sheet.entry_count} usage
                    {sheet.stock_import_count > 0
                      ? `, ${sheet.stock_import_count} import`
                      : ""}
                  </span>
                ))}
              </div>
              {stockImportRows.length > 0 ? (
                <div className="mt-3 overflow-hidden rounded-lg border border-border bg-background">
                  <div className="border-b border-border px-3 py-2 text-xs font-medium text-foreground">
                    {t("stockPreviewTitle", { count: stockImportRows.length })}
                  </div>
                  <div className="max-h-40 overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-muted/80 text-muted-foreground backdrop-blur">
                        <tr className="border-b border-border">
                          <th className="px-3 py-2 text-left">{t("colDate")}</th>
                          <th className="px-3 py-2 text-left">{t("colFuel")}</th>
                          <th className="px-3 py-2 text-right">{t("colImportQty")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stockImportRows.map((row) => (
                          <tr key={`${row.balance_date}-${row.fuel_kind}`} className="border-b border-border/60">
                            <td className="px-3 py-2">{formatDateDisplay(row.balance_date)}</td>
                            <td className="px-3 py-2 capitalize">{row.fuel_kind}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatNumber(row.import_qty, { maximumFractionDigits: 3 })} L
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
              {matched && matched.unmatchedLabels.length > 0 ? (
                <div className="mt-3 rounded-md border border-amber-600/40 bg-amber-50 px-3 py-2.5 text-sm text-amber-950 dark:border-amber-500/50 dark:bg-amber-950/40 dark:text-amber-50">
                  <p className="font-semibold">{t("unmatchedTitle")}</p>
                  <p className="mt-1 leading-relaxed text-amber-900 dark:text-amber-100">
                    {matched.unmatchedLabels.join(", ")}
                  </p>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("emptyHint")}</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={btnPrimary}
              disabled={!canImport || importing || parsing}
              onClick={() => {
                setPreviewVisibleCount(PREVIEW_PAGE_SIZE);
                setConfirmOpen(true);
              }}
            >
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {importing ? t("importing") : t("import")}
            </button>
            <button type="button" className={btnOutline} onClick={onClose} disabled={importing}>
              {t("close")}
            </button>
          </div>

          {confirmOpen && parsed ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-4 text-sm">
              <p className="font-medium text-foreground">{t("confirmTitle")}</p>
              <p className="mt-1 text-muted-foreground">
                {t("confirmBody", {
                  entries: readyRows.length,
                  stockImports: stockImportRows.length,
                  farm: selectedFarm?.label ?? farmId,
                })}
              </p>

              {readyRows.length > 0 ? (
                <div className="mt-3 overflow-hidden rounded-lg border border-border bg-background">
                  <div className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
                    {t("listShowing", {
                      shown: visiblePreviewRows.length,
                      total: readyRows.length,
                    })}
                  </div>
                  <div className="max-h-80 overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-muted/80 text-xs text-muted-foreground backdrop-blur">
                        <tr className="border-b border-border">
                          <th className="px-3 py-2 text-left">{t("colDate")}</th>
                          <th className="px-3 py-2 text-left">{t("colVehicle")}</th>
                          <th className="px-3 py-2 text-left">{t("colFuel")}</th>
                          <th className="px-3 py-2 text-right">{t("colLitres")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visiblePreviewRows.map((row, index) => (
                          <tr
                            key={`${row.fuel_date}-${row.vehicle_inspection_id}-${index}`}
                            className="border-b border-border/60"
                          >
                            <td className="whitespace-nowrap px-3 py-2">
                              {formatDateDisplay(row.fuel_date)}
                            </td>
                            <td className="px-3 py-2">{row.matched_vehicle_label}</td>
                            <td className="px-3 py-2 capitalize">{row.fuel_kind}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatNumber(row.litres, { maximumFractionDigits: 3 })} L
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {previewVisibleCount < readyRows.length ? (
                    <div className="border-t border-border p-2">
                      <button
                        type="button"
                        className={btnOutline}
                        onClick={() =>
                          setPreviewVisibleCount((count) =>
                            Math.min(count + PREVIEW_PAGE_SIZE, readyRows.length),
                          )
                        }
                      >
                        {t("loadMore")}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={importing}
                  onClick={() => void runImport()}
                >
                  {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {t("confirmYes")}
                </button>
                <button
                  type="button"
                  className={btnOutline}
                  disabled={importing}
                  onClick={() => setConfirmOpen(false)}
                >
                  {t("confirmNo")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
