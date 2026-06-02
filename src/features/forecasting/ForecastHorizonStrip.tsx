"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";

import { fetchMondayProjectRowsFromServer, type MondayProjectServerRow } from "@/entities/projects";
import { sortMondayProjectRows } from "@/features/project";
import { stsProxyGetHarvestingIndex } from "@/shared/api/stsProxyClient";
import { parseJsonMaybe, parseSubitems } from "@/shared/lib/parseJsonMaybe";
import {
  dateToLocalYmd,
  normalizeDateFieldToYmd,
  todayYmd,
} from "@/shared/lib/dashboardKpiProjectFilters";
import { useAppTranslations } from "@/shared/i18n/useAppTranslations";
import {
  parseCsvList,
  useSyncedFarmMultiSelect,
} from "@/shared/hooks/useSyncedFarmMultiSelect";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";

export type ForecastHorizonMonths = 1 | 3 | 6 | 12;

function startOfLocalToday(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

function addCalendarMonths(anchor: Date, months: number): Date {
  return new Date(anchor.getFullYear(), anchor.getMonth() + months, anchor.getDate());
}

function formatMonthYearLong(d: Date, locale: string): string {
  return d.toLocaleDateString(locale, { month: "long", year: "numeric" });
}

function getForecastTargetYmd(rec: Record<string, unknown>): string | null {
  return (
    normalizeDateFieldToYmd(rec.delivery_harvest_date) ??
    normalizeDateFieldToYmd(rec.estimated_harvest_date)
  );
}

function rowHasGrassProduct(row: MondayProjectServerRow, productId: string): boolean {
  const pid = String(productId ?? "").trim();
  if (!pid) return false;
  const raw = (row as Record<string, unknown>).quantity_required_sprig_sod;
  const parsed = parseJsonMaybe(raw);
  if (!Array.isArray(parsed)) return false;
  return parsed.some((item) => {
    if (!item || typeof item !== "object") return false;
    const rec = item as Record<string, unknown>;
    return String(rec.product_id ?? "").trim() === pid;
  });
}

function rowMatchesGrassFilter(row: MondayProjectServerRow, grassFilterIds: string[]): boolean {
  if (grassFilterIds.length === 0) return true;
  return grassFilterIds.some((id) => rowHasGrassProduct(row, id));
}

/** Merge harvesting-plan rows into each project `subitems` by `project_id` / `id`. */
function mergeSubitemsWithHarvestPlan(
  projectRows: Array<Record<string, unknown>>,
  harvestPlanRows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  if (projectRows.length === 0 || harvestPlanRows.length === 0) return projectRows;
  const planByProjectId = new Map<string, Array<Record<string, unknown>>>();
  for (const row of harvestPlanRows) {
    const pid = String(row.project_id ?? "").trim();
    if (!pid) continue;
    const list = planByProjectId.get(pid) ?? [];
    list.push(row);
    planByProjectId.set(pid, list);
  }
  return projectRows.map((row) => {
    const projectId = String(row.project_id ?? "").trim();
    if (!projectId) return row;
    const planRows = planByProjectId.get(projectId) ?? [];
    if (planRows.length === 0) return row;
    const existingSubitems = parseSubitems(row.subitems);
    const planIds = new Set(
      planRows
        .map((x) => String(x.id ?? "").trim())
        .filter(Boolean),
    );
    const merged = [
      ...planRows,
      ...existingSubitems.filter((x) => {
        const sid = String(x.id ?? "").trim();
        return !sid || !planIds.has(sid);
      }),
    ];
    return { ...row, subitems: JSON.stringify(merged) };
  });
}

function isDeleted(row: MondayProjectServerRow): boolean {
  return String((row as Record<string, unknown>).deleted ?? "0").trim() === "1";
}

type ForecastHorizonStripProps = {
  forecastMonths: ForecastHorizonMonths;
  onForecastMonthsChange: (months: ForecastHorizonMonths) => void;
};

export function ForecastHorizonStrip({
  forecastMonths,
  onForecastMonthsChange,
}: ForecastHorizonStripProps) {
  const t = useAppTranslations();
  const locale = useLocale();
  const { selectedFarmIds, selectedFarmIdSet } = useSyncedFarmMultiSelect();
  const hasFarmSelection = selectedFarmIds.length > 0;
  const harvestListGrassFilter = useHarvestingDataStore((s) => s.harvestListGrassFilter);
  const grassFilterIds = useMemo(
    () => parseCsvList(harvestListGrassFilter),
    [harvestListGrassFilter],
  );
  const [rows, setRows] = useState<MondayProjectServerRow[]>([]);

  const forecastHorizonEnd = useMemo(() => {
    return addCalendarMonths(startOfLocalToday(), forecastMonths);
  }, [forecastMonths]);

  const horizonThroughLabel = useMemo(
    () => formatMonthYearLong(forecastHorizonEnd, locale),
    [forecastHorizonEnd, locale],
  );

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const res = await fetchMondayProjectRowsFromServer({
        module: "project",
        page: 1,
        perPage: 5000,
      });
      if (!mounted) return;
      let merged = res.rows as unknown as Array<Record<string, unknown>>;
      try {
        const allHarvestRows: Array<Record<string, unknown>> = [];
        let page = 1;
        let totalPages = 1;
        const maxPages = 20;
        do {
          const harvestRes = await stsProxyGetHarvestingIndex({
            page,
            per_page: 200,
          });
          allHarvestRows.push(
            ...harvestRes.rows.filter(
              (x): x is Record<string, unknown> => !!x && typeof x === "object",
            ),
          );
          totalPages = Math.max(1, harvestRes.totalPages);
          page += 1;
        } while (page <= totalPages && page <= maxPages);
        if (!mounted) return;
        if (allHarvestRows.length > 0) {
          merged = mergeSubitemsWithHarvestPlan(merged, allHarvestRows);
        }
      } catch {
        // Summary still works off Monday-only subitems when plan index fails.
      }
      setRows(sortMondayProjectRows(merged) as unknown as MondayProjectServerRow[]);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const upcomingDeliveries = useMemo(() => {
    let length = 0;
    let totalKg = 0;
    const todayY = todayYmd();
    const horizonY = dateToLocalYmd(forecastHorizonEnd);
    for (const row of rows) {
      if (isDeleted(row)) continue;
      if (!rowMatchesGrassFilter(row, grassFilterIds)) continue;
      for (const item of parseSubitems((row as Record<string, unknown>).subitems)) {
        const rec = item as Record<string, unknown>;
        if (String(rec.deleted ?? "0").trim() === "1") continue;
        const farmId = String(rec.farm_id ?? "").trim();
        if (hasFarmSelection && !selectedFarmIdSet.has(farmId)) continue;
        const targetYmd = getForecastTargetYmd(rec);
        if (!targetYmd) continue;
        if (targetYmd <= todayY) continue;
        if (targetYmd > horizonY) continue;
        length += 1;
        const qtyRaw = rec.quantity_harvested ?? rec.quantity ?? 0;
        const qty = Number(String(qtyRaw).replace(/,/g, "").trim());
        const uom = String(rec.uom ?? "").trim().toLowerCase();
        if (Number.isFinite(qty) && qty > 0 && uom === "kg") totalKg += qty;
      }
    }
    return { length, totalKg };
  }, [rows, hasFarmSelection, selectedFarmIdSet, forecastHorizonEnd, grassFilterIds]);

  return (
    <div className="glass-card flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("Dashboard.forecastHorizonSection")}
        </p>
        <p className="mt-0.5 text-sm text-foreground">
          <span className="font-heading font-bold">{upcomingDeliveries.length}</span>{" "}
          {t("Dashboard.forecastUpcomingDeliveriesBullet")}{" "}
          <span className="font-heading font-bold">
            {(upcomingDeliveries.totalKg / 1000).toFixed(1)}k kg
          </span>{" "}
          {t("Dashboard.forecastSprigThrough")}{" "}
          <span className="font-heading font-semibold">{horizonThroughLabel}</span>
        </p>
      </div>
      <div className="flex gap-1 rounded-lg bg-muted p-0.5">
        {([1, 3, 6, 12] as ForecastHorizonMonths[]).map((h) => (
          <button
            key={h}
            type="button"
            onClick={() => onForecastMonthsChange(h)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              forecastMonths === h
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {h === 1 ? t("Dashboard.forecastNextMonth") : t("Dashboard.forecastNextNMonths", { months: h })}
          </button>
        ))}
      </div>
    </div>
  );
}
