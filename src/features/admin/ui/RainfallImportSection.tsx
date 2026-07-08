"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CloudRain, Loader2, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";

import { fetchFarms, type FarmRow } from "@/features/admin/api/adminApi";
import {
  isRainfallChartWorkbook,
  parseRainfallImportWorkbook,
  type RainfallImportParseResult,
} from "@/features/admin/lib/rainfallImport";
import { importRainfallManualBulk } from "@/features/dashboard/api/rainfallApi";
import { compareRainfallRecentDates } from "@/features/dashboard/lib/sortRainfallRecentEntries";
import { cn } from "@/lib/utils";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";

const PREVIEW_PAGE_SIZE = 20;

const inputClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";

function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function RainfallImportSection() {
  const t = useTranslations("AdminUpdating.rainfallImport");

  const [farmOptions, setFarmOptions] = useState<FarmRow[]>([]);
  const [farmId, setFarmId] = useState("");
  const [loadingFarms, setLoadingFarms] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [fileLabel, setFileLabel] = useState("");
  const [parsed, setParsed] = useState<RainfallImportParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [previewVisibleCount, setPreviewVisibleCount] = useState(PREVIEW_PAGE_SIZE);

  const today = useMemo(() => todayIso(), []);

  const sortedPreviewEntries = useMemo(() => {
    if (!parsed) return [];
    return [...parsed.entries].sort((a, b) =>
      compareRainfallRecentDates(a.record_date, b.record_date, today),
    );
  }, [parsed, today]);

  const visiblePreviewEntries = useMemo(
    () => sortedPreviewEntries.slice(0, previewVisibleCount),
    [previewVisibleCount, sortedPreviewEntries],
  );

  const loadFarms = useCallback(async () => {
    setLoadingFarms(true);
    try {
      const farms = await fetchFarms();
      setFarmOptions(farms);
      if (!farmId && farms.length > 0) {
        setFarmId(String(farms[0]!.id));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.loadFarms"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    } finally {
      setLoadingFarms(false);
    }
  }, [farmId, t]);

  useEffect(() => {
    void loadFarms();
  }, [loadFarms]);

  const selectedFarm = useMemo(
    () => farmOptions.find((farm) => String(farm.id) === farmId) ?? null,
    [farmId, farmOptions],
  );

  const handleFile = async (file: File) => {
    if (!isRainfallChartWorkbook(file.name)) {
      setError(t("errors.invalidFile"));
      return;
    }

    setParsing(true);
    setError(null);
    setParsed(null);
    setFileLabel(file.name);
    setConfirmOpen(false);
    setPreviewVisibleCount(PREVIEW_PAGE_SIZE);

    try {
      const buffer = await file.arrayBuffer();
      const result = await parseRainfallImportWorkbook(buffer);
      if (result.entries.length === 0) {
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

  const runImport = async () => {
    if (!parsed || parsed.entries.length === 0 || !farmId) return;

    setImporting(true);
    setError(null);
    setConfirmOpen(false);

    try {
      const result = await importRainfallManualBulk({
        farm_id: Number(farmId),
        entries: parsed.entries,
      });
      const summary = result?.summary;
      toast.success(
        summary
          ? t("importSuccess", {
              created: summary.created,
              updated: summary.updated,
              total: summary.total,
            })
          : t("importSuccessGeneric"),
        { containerId: TOAST_CONTAINER_TOP_RIGHT },
      );
      setParsed(null);
      setFileLabel("");
      setFileInputKey((key) => key + 1);
    } catch (e) {
      const message = e instanceof Error ? e.message : t("errors.import");
      setError(message);
      toast.error(message, { containerId: TOAST_CONTAINER_TOP_RIGHT });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <CloudRain className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-base font-semibold">{t("title")}</h2>
            <p className="text-xs text-muted-foreground">{t("description")}</p>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">{t("farm")}</label>
            <select
              value={farmId}
              onChange={(e) => setFarmId(e.target.value)}
              disabled={loadingFarms || importing || parsing}
              className={inputClass}
            >
              <option value="">{t("farmPlaceholder")}</option>
              {farmOptions.map((farm) => (
                <option key={farm.id} value={String(farm.id)}>
                  {farm.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">{t("file")}</label>
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
                from: parsed.date_from ?? "—",
                to: parsed.date_to ?? "—",
                farm: selectedFarm?.name ?? farmId,
              })}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {parsed.sheets.map((sheet) => (
                <span
                  key={`${sheet.sheet_name}-${sheet.year}`}
                  className="inline-flex rounded-full border border-border bg-background px-2.5 py-0.5 text-xs"
                >
                  {sheet.year}: {sheet.entry_count}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("emptyHint")}</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!parsed || !farmId || importing || parsing}
            onClick={() => {
              setPreviewVisibleCount(PREVIEW_PAGE_SIZE);
              setConfirmOpen(true);
            }}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50"
          >
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {importing ? t("importing") : t("import")}
          </button>
        </div>

        {confirmOpen && parsed ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-4 text-sm">
            <p className="font-medium text-foreground">{t("confirmTitle")}</p>
            <p className="mt-1 text-muted-foreground">
              {t("confirmBody", {
                entries: parsed.entries.length,
                farm: selectedFarm?.name ?? farmId,
              })}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">{t("previewListHint")}</p>

            <div className="mt-3 overflow-hidden rounded-lg border border-border bg-background">
              <div className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
                {t("listShowing", {
                  shown: visiblePreviewEntries.length,
                  total: sortedPreviewEntries.length,
                })}
              </div>
              <div className="max-h-80 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/80 text-xs text-muted-foreground backdrop-blur">
                    <tr className="border-b border-border">
                      <th className="px-3 py-2 text-left">{t("colDate")}</th>
                      <th className="px-3 py-2 text-right">{t("colRainfall")}</th>
                      <th className="px-3 py-2 text-right">{t("colYear")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePreviewEntries.map((entry) => {
                      const isToday = entry.record_date === today;
                      return (
                        <tr
                          key={entry.record_date}
                          className={cn(
                            "border-b border-border/60",
                            isToday && "bg-primary/5 font-medium",
                          )}
                        >
                          <td className="px-3 py-2 whitespace-nowrap">
                            {entry.record_date}
                            {isToday ? (
                              <span className="ml-2 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                {t("today")}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{entry.rainfall_mm} mm</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                            {entry.record_date.slice(0, 4)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {previewVisibleCount < sortedPreviewEntries.length ? (
                <div className="border-t border-border p-2">
                  <button
                    type="button"
                    onClick={() =>
                      setPreviewVisibleCount((count) =>
                        Math.min(count + PREVIEW_PAGE_SIZE, sortedPreviewEntries.length),
                      )
                    }
                    className="flex h-8 w-full items-center justify-center rounded-md border border-input bg-background text-xs font-medium hover:bg-muted/50"
                  >
                    {t("loadMore")}
                  </button>
                </div>
              ) : null}
            </div>

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={importing}
                onClick={() => void runImport()}
                className="inline-flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t("confirmYes")}
              </button>
              <button
                type="button"
                disabled={importing}
                onClick={() => setConfirmOpen(false)}
                className="inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
              >
                {t("confirmNo")}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
