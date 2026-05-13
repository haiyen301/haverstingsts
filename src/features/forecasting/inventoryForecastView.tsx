"use client";

import { useEffect, useMemo, useState } from "react";
import { AlignLeft, ArrowDown } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Line,
  ReferenceDot,
} from "recharts";

import {
  fetchHarvestRowsForForecasting,
  rowsToMockHarvestRows,
} from "@/features/forecasting/mapHarvestApiToForecastRows";
import type { ForecastHarvestRow } from "@/features/forecasting/forecastingTypes";
import {
  DEFAULT_REGROWTH_REFERENCE_CONFIG,
  resolveRegrowthReferenceConfigFromRules,
  type RegrowthReferenceConfig,
} from "@/features/forecasting/forecastingRegrowth";
import {
  computeCappedAvailableByZoneAtDate,
  computeZoneCapacityMap,
  forecastZoneKeyFromRow,
  getRegrowthDateFromHarvest,
} from "@/features/forecasting/inventoryRegrowthCalculator";
import { applyInventoryAvailableOverridesToZoneMap } from "@/features/forecasting/inventoryAvailableOverrides";
import { fetchRegrowthRules, fetchZoneConfigurations } from "@/features/admin/api/adminApi";
import { mapRowsToSelectOptions, zoneIdToLabel } from "@/shared/lib/harvestReferenceData";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { useInventoryAvailableOverrideStore } from "@/shared/store/inventoryAvailableOverrideStore";
import { MultiSelect } from "@/components/ui/multi-select";
import { cn } from "@/lib/utils";
import { bgSurfaceFilter } from "@/shared/lib/surfaceFilter";
import {
  parseCsvList,
  toCsvList,
  useSyncedFarmMultiSelect,
} from "@/shared/hooks/useSyncedFarmMultiSelect";

type ForecastPoint = {
  date: string;
  available: number;
  calculatedAvailable: number;
  regrowing: number;
  max: number;
  overrideCount: number;
};

type SeriesPoint = {
  date: string;
  [key: string]: string | number;
};

function seriesSystemKey(key: string): string {
  return `__system__${key}`;
}

function seriesOverrideCountKey(key: string): string {
  return `__override_count__${key}`;
}

const DEBUG_UPCOMING_FILTER = false;
const DEBUG_REGROWTH_EVENTS = false;

const GRASS_SERIES_PALETTE = [
  "hsl(152, 55%, 36%)",
  "hsl(28, 80%, 55%)",
  "hsl(210, 75%, 50%)",
  "hsl(280, 55%, 55%)",
  "hsl(345, 70%, 55%)",
  "hsl(45, 85%, 50%)",
  "hsl(180, 60%, 40%)",
  "hsl(95, 50%, 45%)",
];

const FARM_SERIES_PALETTE = [
  "hsl(210, 75%, 50%)",
  "hsl(28, 80%, 55%)",
  "hsl(280, 55%, 55%)",
  "hsl(152, 55%, 36%)",
  "hsl(345, 70%, 55%)",
  "hsl(45, 85%, 50%)",
  "hsl(180, 60%, 40%)",
  "hsl(95, 50%, 45%)",
];

function harvestTypeLabel(
  harvestType: ForecastHarvestRow["harvestType"],
  t: (key: string) => string,
): string {
  if (harvestType === "sod_for_sprig") return t("types.sodForSprig");
  if (harvestType === "sprig") return t("types.sprig");
  return t("types.sod");
}

/** Normalize plan UOM for display (matches harvest list idea: show real unit, not always kg). */
function forecastQtyUnit(uomRaw: string | undefined): { suffix: string; kind: "kg" | "m2" | "other" } {
  const raw = String(uomRaw ?? "").trim();
  const u = raw.toLowerCase().replace(/\s/g, "").replace(/²/g, "2");
  if (u === "kg" || u === "kgs" || u === "kilogram" || u === "kilograms") {
    return { suffix: "kg", kind: "kg" };
  }
  if (
    u === "m2" ||
    u === "sqm" ||
    u === "sq.m" ||
    u === "m²" ||
    u === "squaremeter" ||
    u === "squaremeters"
  ) {
    return { suffix: "m²", kind: "m2" };
  }
  if (!raw) return { suffix: "", kind: "other" };
  return { suffix: raw, kind: "other" };
}

function formatForecastQty(qty: number, uomRaw: string | undefined): string {
  const { suffix } = forecastQtyUnit(uomRaw);
  const n = qty.toLocaleString();
  return suffix ? `${n} ${suffix}` : n;
}

function loadTypeBadgeMeta(
  harvestType: ForecastHarvestRow["harvestType"],
  t: (key: string) => string,
): { label: string; className: string } {
  if (harvestType === "sod_for_sprig") {
    return {
      label: t("badges.sodToSprig"),
      className: "bg-primary/10 text-primary",
    };
  }
  if (harvestType === "sod") {
    return {
      label: t("badges.sod"),
      className: "bg-primary/10 text-primary",
    };
  }
  return {
    label: t("badges.sprig"),
    className: "bg-secondary/40 text-foreground",
  };
}

function normalizeYmd(value: string): string {
  return value.trim().slice(0, 10);
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function ymdFromDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function parseYmdLocal(ymd: string): Date | null {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

const FORECAST_TODAY_FOR_TEST: string | null = null;

function getForecastToday(): Date {
  if (!FORECAST_TODAY_FOR_TEST) return startOfLocalDay(new Date());
  return parseYmdLocal(FORECAST_TODAY_FOR_TEST) ?? startOfLocalDay(new Date());
}

function formatDayMonth(ymd: string): string {
  const d = parseYmdLocal(ymd);
  if (!d) return ymd;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

function formatDateLong(ymd: string): string {
  const d = parseYmdLocal(ymd);
  if (!d) return ymd;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function formatSprigRangeForReference(
  bands: RegrowthReferenceConfig["sprigBands"],
  rowIndex: number,
): string {
  const cur = bands[rowIndex];
  if (!cur) return "";
  const t = Number.isFinite(cur.thresholdKgPerM2) ? cur.thresholdKgPerM2 : 0;
  if (rowIndex === 0) return `≤ ${t} kg/m²`;

  const prev = bands[rowIndex - 1];
  if (!prev) return `≤ ${t} kg/m²`;
  const p = Number.isFinite(prev.thresholdKgPerM2) ? prev.thresholdKgPerM2 : 0;

  if (rowIndex === bands.length - 1 || cur.comparator === "GT" || cur.comparator === "GTE") {
    return `> ${p} kg/m²`;
  }
  return `${p} - ${t} kg/m²`;
}

export function InventoryForecast() {
  const t = useTranslations("ForecastInventory");
  const farmZones = useHarvestingDataStore((s) => s.farmZones);
  const grasses = useHarvestingDataStore((s) => s.grasses);
  const harvestListGrassFilter = useHarvestingDataStore((s) => s.harvestListGrassFilter);
  const setHarvestListGrassFilter = useHarvestingDataStore((s) => s.setHarvestListGrassFilter);
  const overridesByZone = useInventoryAvailableOverrideStore((s) => s.overridesByZone);
  const fetchOverrides = useInventoryAvailableOverrideStore((s) => s.fetchOverrides);
  const {
    selectedFarmIds,
    selectedFarmIdSet,
    setSelectedFarmIds,
    farmOptions,
  } = useSyncedFarmMultiSelect();
  const [forecastMonths, setForecastMonths] = useState<number>(6);
  const [rows, setRows] = useState<ForecastHarvestRow[]>([]);
  const [regrowthConfig, setRegrowthConfig] = useState<RegrowthReferenceConfig>(
    DEFAULT_REGROWTH_REFERENCE_CONFIG,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zoneLabel = (zoneId: string) => zoneIdToLabel(zoneId, farmZones) || zoneId;

  const selectedGrassIds = useMemo(
    () => parseCsvList(harvestListGrassFilter),
    [harvestListGrassFilter],
  );
  const selectedGrassIdSet = useMemo(
    () => new Set(selectedGrassIds),
    [selectedGrassIds],
  );
  const setSelectedGrassIds = (ids: string[]) =>
    setHarvestListGrassFilter(toCsvList(ids));

  useEffect(() => {
    void fetchOverrides();
  }, [fetchOverrides]);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setError(null);

      const today = getForecastToday();
      const from = ymdFromDate(addMonths(today, -12));
      const to = ymdFromDate(addMonths(today, 18));

      const [res, zoneConfigs] = await Promise.all([
        fetchHarvestRowsForForecasting({
          actual_harvest_date_from: from,
          actual_harvest_date_to: to,
          perPage: 200,
          maxPages: 50,
        }),
        fetchZoneConfigurations(),
      ]);

      if (!alive) return;
      const mapped = rowsToMockHarvestRows(res.rows, today, zoneConfigs);
      setRows(mapped);
      setError(res.error ?? null);
      setLoading(false);
    }

    void load();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const rules = await fetchRegrowthRules();
        if (!alive) return;
        setRegrowthConfig(resolveRegrowthReferenceConfigFromRules(rules));
      } catch {
        if (!alive) return;
        setRegrowthConfig(resolveRegrowthReferenceConfigFromRules([]));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const farmFilterOptions = useMemo(
    () => farmOptions.map((o) => ({ value: o.id, label: o.label })),
    [farmOptions],
  );

  const grassOptionsFromStore = useMemo(
    () => mapRowsToSelectOptions(grasses as unknown[], "title"),
    [grasses],
  );

  /** Limit grass options to grass types present in the loaded rows (optionally narrowed by selected farms). */
  const grassFilterOptions = useMemo(() => {
    const allowedIds = new Set<string>();
    for (const r of rows) {
      if (selectedFarmIds.length > 0 && !selectedFarmIdSet.has(String(r.farmId))) continue;
      const pid = String(r.productId);
      if (pid && pid !== "0") allowedIds.add(pid);
    }
    return grassOptionsFromStore
      .filter((o) => allowedIds.has(o.id))
      .map((o) => ({ value: o.id, label: o.label }));
  }, [rows, selectedFarmIds, selectedFarmIdSet, grassOptionsFromStore]);

  const filteredRows = useMemo(
    () =>
      rows.filter((r) => {
        const farmIdStr = String(r.farmId);
        const productIdStr = String(r.productId);
        if (selectedFarmIds.length > 0 && !selectedFarmIdSet.has(farmIdStr)) return false;
        if (selectedGrassIds.length > 0 && !selectedGrassIdSet.has(productIdStr)) return false;
        return true;
      }),
    [rows, selectedFarmIds, selectedFarmIdSet, selectedGrassIds, selectedGrassIdSet],
  );

  const zoneCapacityByKey = useMemo(() => computeZoneCapacityMap(filteredRows), [filteredRows]);

  const totalMax = useMemo(
    () => Array.from(zoneCapacityByKey.values()).reduce((s, n) => s + n, 0),
    [zoneCapacityByKey],
  );

  const zoneSeriesMeta = useMemo(() => {
    const out = new Map<string, string>();
    for (const r of filteredRows) {
      const zoneKey = forecastZoneKeyFromRow(r);
      if (out.has(zoneKey)) continue;
      out.set(zoneKey, r.grassType);
    }
    return out;
  }, [filteredRows]);

  const zoneFarmMeta = useMemo(() => {
    const out = new Map<string, string>();
    for (const r of filteredRows) {
      const zoneKey = forecastZoneKeyFromRow(r);
      if (!out.has(zoneKey)) out.set(zoneKey, r.farm);
    }
    return out;
  }, [filteredRows]);

  const breakdownMode: "grass" | "farm" =
    selectedGrassIds.length > 0 ? "farm" : "grass";

  const selectedGrassSummary = useMemo(() => {
    if (selectedGrassIds.length === 0) return "";
    const labels = grassFilterOptions
      .filter((o) => selectedGrassIdSet.has(o.value))
      .map((o) => o.label);
    if (labels.length > 0) return labels.join(", ");
    return selectedGrassIds.join(", ");
  }, [selectedGrassIds, selectedGrassIdSet, grassFilterOptions]);

  const forecastData = useMemo<ForecastPoint[]>(() => {
    const today = getForecastToday();
    const weeks: ForecastPoint[] = [];
    const totalWeeks = Math.max(1, Math.round(forecastMonths * 4.33));

    for (let w = 0; w < totalWeeks; w++) {
      const forecastDate = addDays(today, w * 7);
      const dateStr = ymdFromDate(forecastDate);
      const calculatedByZone = computeCappedAvailableByZoneAtDate(
        filteredRows,
        regrowthConfig,
        forecastDate,
      );
      const { adjustedByZone, appliedByZone } = applyInventoryAvailableOverridesToZoneMap({
        availableByZone: calculatedByZone,
        maxByZone: zoneCapacityByKey,
        overridesByZone,
        asOf: forecastDate,
        overrideRecoveryDays: regrowthConfig.overrideRecoveryDays,
      });
      const totalCalculated = Array.from(calculatedByZone.values()).reduce((s, v) => s + v, 0);
      const totalAvailable = Array.from(adjustedByZone.values()).reduce((s, v) => s + v, 0);
      const totalRegrowing = Math.max(0, totalMax - totalAvailable);

      weeks.push({
        date: dateStr,
        available: Math.max(0, Math.round(totalAvailable)),
        calculatedAvailable: Math.max(0, Math.round(totalCalculated)),
        regrowing: Math.max(0, Math.round(totalRegrowing)),
        max: Math.max(0, Math.round(totalMax)),
        overrideCount: appliedByZone.size,
      });
    }
    return weeks;
  }, [filteredRows, forecastMonths, overridesByZone, regrowthConfig, totalMax, zoneCapacityByKey]);

  const maxAvailableForChart = useMemo(
    () => forecastData.reduce((m, p) => Math.max(m, p.available), 0),
    [forecastData],
  );

  const yAxisMaxForAvailable = useMemo(() => {
    if (maxAvailableForChart <= 0) return 500;
    const padded = maxAvailableForChart * 1.2;
    return Math.max(500, Math.ceil(padded / 100) * 100);
  }, [maxAvailableForChart]);

  const showMaxCapacityBand = useMemo(
    () => totalMax > 0 && totalMax <= yAxisMaxForAvailable * 5,
    [totalMax, yAxisMaxForAvailable],
  );

  const hasManualOverridesInForecast = useMemo(
    () => forecastData.some((point) => point.overrideCount > 0),
    [forecastData],
  );

  const seriesKeys = useMemo(() => {
    if (breakdownMode === "farm") {
      const set = new Set<string>();
      for (const r of filteredRows) {
        if (r.farm) set.add(r.farm);
      }
      return Array.from(set).sort((a, b) => a.localeCompare(b));
    }
    return Array.from(new Set(filteredRows.map((r) => r.grassType).filter(Boolean))).sort(
      (a, b) => a.localeCompare(b),
    );
  }, [filteredRows, breakdownMode]);

  const forecastBySeries = useMemo<SeriesPoint[]>(() => {
    const today = getForecastToday();
    const totalWeeks = Math.max(1, Math.round(forecastMonths * 4.33));
    const points: SeriesPoint[] = [];

    for (let w = 0; w < totalWeeks; w++) {
      const forecastDate = addDays(today, w * 7);
      const row: SeriesPoint = { date: ymdFromDate(forecastDate) };
      const calculatedByZone = computeCappedAvailableByZoneAtDate(
        filteredRows,
        regrowthConfig,
        forecastDate,
      );
      const { adjustedByZone, appliedByZone } = applyInventoryAvailableOverridesToZoneMap({
        availableByZone: calculatedByZone,
        maxByZone: zoneCapacityByKey,
        overridesByZone,
        asOf: forecastDate,
        overrideRecoveryDays: regrowthConfig.overrideRecoveryDays,
      });
      for (const [zoneKey, available] of adjustedByZone) {
        const seriesKey =
          breakdownMode === "farm"
            ? zoneFarmMeta.get(zoneKey)
            : zoneSeriesMeta.get(zoneKey);
        if (!seriesKey) continue;
        row[seriesKey] = Number(row[seriesKey] ?? 0) + available;
      }
      for (const [zoneKey, calculated] of calculatedByZone) {
        const seriesKey =
          breakdownMode === "farm"
            ? zoneFarmMeta.get(zoneKey)
            : zoneSeriesMeta.get(zoneKey);
        if (!seriesKey) continue;
        row[seriesSystemKey(seriesKey)] = Number(row[seriesSystemKey(seriesKey)] ?? 0) + calculated;
      }
      for (const [zoneKey] of appliedByZone) {
        const seriesKey =
          breakdownMode === "farm"
            ? zoneFarmMeta.get(zoneKey)
            : zoneSeriesMeta.get(zoneKey);
        if (!seriesKey) continue;
        row[seriesOverrideCountKey(seriesKey)] =
          Number(row[seriesOverrideCountKey(seriesKey)] ?? 0) + 1;
      }
      for (const key of seriesKeys) {
        row[key] = Math.max(0, Math.round(Number(row[key] ?? 0)));
        row[seriesSystemKey(key)] = Math.max(0, Math.round(Number(row[seriesSystemKey(key)] ?? 0)));
        row[seriesOverrideCountKey(key)] = Math.max(
          0,
          Math.round(Number(row[seriesOverrideCountKey(key)] ?? 0)),
        );
      }

      points.push(row);
    }

    return points;
  }, [
    filteredRows,
    forecastMonths,
    overridesByZone,
    seriesKeys,
    regrowthConfig,
    zoneCapacityByKey,
    zoneSeriesMeta,
    zoneFarmMeta,
    breakdownMode,
  ]);

  const hasManualOverridesInSeriesForecast = useMemo(
    () =>
      forecastBySeries.some((point) =>
        seriesKeys.some((key) => Number(point[seriesOverrideCountKey(key)] ?? 0) > 0),
      ),
    [forecastBySeries, seriesKeys],
  );

  const upcomingHarvests = useMemo(() => {
    const today = getForecastToday();
    const end = addMonths(today, forecastMonths);
    const result = filteredRows
      .filter((h, index) => {
        const normalized = normalizeYmd(h.harvestDate);
        const d = parseYmdLocal(normalized);
        if (!d) {
          // if (DEBUG_UPCOMING_FILTER) {
          //   console.log("[forecast][upcoming-filter] reject invalid date", {
          //     index,
          //     id: h.id,
          //     harvestDate: h.harvestDate,
          //     normalized,
          //   });
          // }
          return false;
        }
        const inRange = d >= today && d <= end;
        if (DEBUG_UPCOMING_FILTER) {
          // console.log(
          //   inRange
          //     ? "[forecast][upcoming-filter] pass"
          //     : "[forecast][upcoming-filter] reject out of range",
          //   {
          //     index,
          //     id: h.id,
          //     harvestDate: h.harvestDate,
          //     normalized,
          //     parsed: ymdFromDate(d),
          //     today: ymdFromDate(today),
          //     end: ymdFromDate(end),
          //   },
          // );
        }
        return inRange;
      })
      .map((h) => ({
        id: h.id,
        date: normalizeYmd(h.harvestDate),
        farm: h.farm,
        grass: h.grassType,
        zone: h.zone ?? "",
        project: h.project ?? "",
        customer: h.customer ?? "",
        qty: Number.isFinite(h.inventoryKg) ? h.inventoryKg : h.quantity,
        uom: "kg",
        inventoryIsCapped: h.inventoryIsCapped,
        harvestType: h.harvestType,
        type: harvestTypeLabel(h.harvestType, t),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (DEBUG_UPCOMING_FILTER) {
      // console.log("[forecast][upcoming-filter] summary", {
      //   filteredRowsCount: filteredRows.length,
      //   upcomingCount: result.length,
      //   today: ymdFromDate(today),
      //   end: ymdFromDate(end),
      // });
      // console.table(
      //   result.map((r) => ({
      //     id: r.id,
      //     harvestDate:
      //       filteredRows.find((h) => h.id === r.id)?.harvestDate ?? "",
      //     date: r.date,
      //     farm: r.farm,
      //     grass: r.grass,
      //     qty: r.qty,
      //     type: r.type,
      //   })),
      // );
    }
    return result;
  }, [filteredRows, forecastMonths, t]);

  const upcomingTotalsSummary = useMemo(() => {
    const kgSum = upcomingHarvests.reduce((sum, h) => sum + h.qty, 0);
    if (kgSum <= 0) return "";
    return t("upcoming.summaryKg", { quantity: kgSum.toLocaleString() });
  }, [upcomingHarvests, t]);

  const regrowthEvents = useMemo(() => {
    const today = getForecastToday();
    const maxByZone = computeZoneCapacityMap(filteredRows);
    const candidates = filteredRows
      .map((h) => {
        const regrowDateObj = getRegrowthDateFromHarvest(h, regrowthConfig);
        if (!regrowDateObj) return null;
        return {
          id: h.id,
          harvestDate: h.harvestDate,
          dateObj: regrowDateObj,
          date: ymdFromDate(regrowDateObj),
          farm: h.farm,
          grass: h.grassType,
          qty: Number.isFinite(h.inventoryKg) ? h.inventoryKg : h.quantity,
          uom: "kg",
          type: harvestTypeLabel(h.harvestType, t),
          zoneKey: forecastZoneKeyFromRow(h),
          sourceWasCapped: h.inventoryIsCapped,
        };
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => {
        const da = a.dateObj.getTime() - b.dateObj.getTime();
        if (da !== 0) return da;
        return a.id.localeCompare(b.id);
      });

    const rawByZone = new Map<string, number>();
    const cappedByZone = new Map<string, number>();
    const finalEvents: Array<{
      harvestDate: string;
      date: string;
      farm: string;
      grass: string;
      qty: number;
      uom: string;
      type: string;
      inventoryIsCapped: boolean;
      overflowKg: number;
    }> = [];

    for (const ev of candidates) {
      const max = maxByZone.get(ev.zoneKey) ?? 0;
      const beforeRaw = rawByZone.get(ev.zoneKey) ?? 0;
      const beforeCapped = cappedByZone.get(ev.zoneKey) ?? 0;
      const afterRaw = beforeRaw + ev.qty;
      const afterCapped = max > 0 ? Math.min(afterRaw, max) : afterRaw;
      const creditedKg = Math.max(0, afterCapped - beforeCapped);
      const overflowKg = Math.max(0, ev.qty - creditedKg);

      rawByZone.set(ev.zoneKey, afterRaw);
      cappedByZone.set(ev.zoneKey, afterCapped);

      if (ev.dateObj <= today) continue;
      finalEvents.push({
        harvestDate: ev.harvestDate,
        date: ev.date,
        farm: ev.farm,
        grass: ev.grass,
        qty: creditedKg,
        uom: ev.uom,
        type: ev.type,
        inventoryIsCapped: ev.sourceWasCapped || overflowKg > 0,
        overflowKg,
      });
    }

    if (DEBUG_REGROWTH_EVENTS) {
      console.log("[forecast][regrowth-events] summary", {
        filteredRowsCount: filteredRows.length,
        finalCountAfterSlice: finalEvents.length,
      });
      // Same order as UI list (sorted by regrowth date, then sliced top 15).
      console.table(
        finalEvents.map((ev, idx) => ({
          order: idx + 1,
          harvestDate: ev.harvestDate,
          regrowthDate: ev.date,
          qty: ev.qty,
          uom: ev.uom,
          farm: ev.farm,
          grass: ev.grass,
          type: ev.type,
          overflowKg: ev.overflowKg,
        })),
      );
    }
    return finalEvents;
  }, [filteredRows, regrowthConfig, t]);

  /** Stable colors from full dataset so hues do not shift when filters change (matches Harvesting Portal). */
  const grassColors = useMemo(() => {
    const all = Array.from(new Set(rows.map((r) => r.grassType).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b),
    );
    const map: Record<string, string> = {};
    all.forEach((g, i) => {
      map[g] = GRASS_SERIES_PALETTE[i % GRASS_SERIES_PALETTE.length];
    });
    return map;
  }, [rows]);

  const farmColors = useMemo(() => {
    const all = Array.from(new Set(rows.map((r) => r.farm).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b),
    );
    const map: Record<string, string> = {};
    all.forEach((f, i) => {
      map[f] = FARM_SERIES_PALETTE[i % FARM_SERIES_PALETTE.length];
    });
    return map;
  }, [rows]);

  const seriesColor = (key: string) =>
    (breakdownMode === "farm" ? farmColors[key] : grassColors[key]) ?? GRASS_SERIES_PALETTE[0];

  const filterTriggerIcon = (
    <>
      <AlignLeft className="h-3.5 w-3.5 shrink-0" />
      <ArrowDown className="h-3.5 w-3.5 shrink-0" />
    </>
  );
  const multiSelectBaseClass =
    "min-w-[140px] max-w-[180px] rounded-md border border-input text-sm text-foreground hover:bg-btnhover/40";

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-2xl font-bold">{t("title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("subtitle", { months: forecastMonths })}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <MultiSelect
          options={farmFilterOptions}
          values={selectedFarmIds}
          onChange={setSelectedFarmIds}
          placeholder={t("filters.allFarms")}
          className={cn(multiSelectBaseClass, bgSurfaceFilter(selectedFarmIds.length > 0))}
          rightIcon={filterTriggerIcon}
        />
        <MultiSelect
          options={grassFilterOptions}
          values={selectedGrassIds}
          onChange={setSelectedGrassIds}
          placeholder={t("filters.allGrasses")}
          className={cn(multiSelectBaseClass, bgSurfaceFilter(selectedGrassIds.length > 0))}
          rightIcon={filterTriggerIcon}
        />
        <select
          value={forecastMonths}
          onChange={(e) => setForecastMonths(Number(e.target.value))}
          className={cn(
            "h-10 min-w-[140px] max-w-[200px] rounded-md border border-input px-3 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] hover:bg-btnhover/40 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35",
            bgSurfaceFilter(forecastMonths !== 6),
          )}
        >
          <option value={6}>{t("filters.nextMonths", { months: 6 })}</option>
          <option value={12}>{t("filters.nextMonths", { months: 12 })}</option>
          <option value={18}>{t("filters.nextMonths", { months: 18 })}</option>
        </select>
      </div>

      {loading ? (
        <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          {t("loading")}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="rounded-xl border  border-border bg-card p-5">
        <h3 className="mb-4 text-sm font-semibold">{t("charts.projectedInventory")}</h3>
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={forecastData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(214,18%,89%)" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => formatDayMonth(String(v))} />
            <YAxis
              domain={[0, yAxisMaxForAvailable]}
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => `${(Number(v) / 1000).toFixed(0)}k`}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0) return null;
                const point = payload[0]?.payload as ForecastPoint | undefined;
                if (!point) return null;
                return (
                  <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
                    <p className="font-medium text-foreground">{formatDateLong(String(label))}</p>
                    <div className="mt-2 space-y-1.5">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-muted-foreground">{t("charts.available")}</span>
                        <span className="font-medium text-foreground">
                          {point.available.toLocaleString()} kg
                        </span>
                      </div>
                      {point.overrideCount > 0 ? (
                        <>
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-muted-foreground">
                              {t("charts.calculatedReference")}
                            </span>
                            <span className="font-medium text-foreground">
                              {point.calculatedAvailable.toLocaleString()} kg
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-4 text-amber-700">
                            <span>{t("charts.manualOverrideActive")}</span>
                            <span className="font-medium">
                              {t("charts.overrideCount", { count: point.overrideCount })}
                            </span>
                          </div>
                        </>
                      ) : null}
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-muted-foreground">{t("charts.maxCapacity")}</span>
                        <span className="font-medium text-foreground">{point.max.toLocaleString()} kg</span>
                      </div>
                    </div>
                  </div>
                );
              }}
            />
            {showMaxCapacityBand ? (
              <Area
                type="monotone"
                dataKey="max"
                stroke="hsl(214,18%,89%)"
                fill="hsl(214,18%,89%)"
                fillOpacity={0.3}
                strokeDasharray="4 4"
              />
            ) : null}
            {hasManualOverridesInForecast ? (
              <Line
                type="monotone"
                dataKey="calculatedAvailable"
                stroke="hsl(35, 65%, 45%)"
                strokeDasharray="6 4"
                strokeWidth={2}
                dot={false}
                activeDot={false}
              />
            ) : null}
            <Area
              type="monotone"
              dataKey="available"
              stroke="hsl(152,55%,36%)"
              fill="hsl(152,55%,36%)"
              fillOpacity={0.2}
              strokeWidth={2}
            />
            {forecastData.map((point) =>
              point.overrideCount > 0 ? (
                <ReferenceDot
                  key={`override-${point.date}`}
                  x={point.date}
                  y={point.available}
                  r={4}
                  fill="hsl(35,92%,52%)"
                  stroke="white"
                  strokeWidth={2}
                />
              ) : null,
            )}
          </AreaChart>
        </ResponsiveContainer>
        {hasManualOverridesInForecast ? (
          <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="inline-block h-0 w-6 border-t-2 border-dashed border-[hsl(35,65%,45%)]" />
              <span>{t("charts.calculatedReference")}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-full bg-[hsl(35,92%,52%)] ring-2 ring-white" />
              <span>
                {t("charts.manualOverrideMarker", {
                  days: regrowthConfig.overrideRecoveryDays,
                })}
              </span>
            </div>
          </div>
        ) : null}
        {!showMaxCapacityBand ? (
          <p className="mt-2 text-[11px] text-muted-foreground">
            {t("charts.maxCapacityHidden")}
          </p>
        ) : null}
      </div>

      <div className="rounded-xl border  border-border bg-card p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            {breakdownMode === "farm"
              ? t("charts.projectedByFarm", { grass: selectedGrassSummary })
              : t("charts.projectedByGrass")}
          </h3>
          <div className="flex flex-wrap items-center gap-3">
            {seriesKeys.map((k) => (
              <div key={k} className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: seriesColor(k) }} />
                <span className="text-[11px] text-muted-foreground">{k}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          {breakdownMode === "farm"
            ? t("charts.stackedHintByFarm", { grass: selectedGrassSummary })
            : t("charts.stackedHint")}
        </p>
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={forecastBySeries}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(214,18%,89%)" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => formatDayMonth(String(v))} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(Number(v) / 1000).toFixed(0)}k`} />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0) return null;
                const point = payload[0]?.payload as SeriesPoint | undefined;
                if (!point) return null;
                return (
                  <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
                    <p className="font-medium text-foreground">{formatDateLong(String(label))}</p>
                    <div className="mt-2 space-y-2">
                      {seriesKeys.map((key) => {
                        const balance = Number(point[key] ?? 0);
                        const system = Number(point[seriesSystemKey(key)] ?? balance);
                        const overrideCount = Number(point[seriesOverrideCountKey(key)] ?? 0);
                        return (
                          <div key={key}>
                            <div className="flex items-center justify-between gap-4">
                              <div className="flex items-center gap-2">
                                <span
                                  className="inline-block h-2.5 w-2.5 rounded-sm"
                                  style={{ backgroundColor: seriesColor(key) }}
                                />
                                <span style={{ color: seriesColor(key) }}>{key}</span>
                                {overrideCount > 0 ? (
                                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                                    {t("charts.manualOverrideActive")}
                                  </span>
                                ) : null}
                              </div>
                              <span className="font-medium text-foreground">
                                {balance.toLocaleString()} kg
                              </span>
                            </div>
                            {overrideCount > 0 ? (
                              <div className="mt-1 pl-4 text-[11px] text-muted-foreground">
                                {t("charts.calculatedReference")} {system.toLocaleString()} kg ·{" "}
                                {t("charts.overrideCount", { count: overrideCount })}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              }}
            />
            {seriesKeys.map((k) => (
              <Area
                key={k}
                type="monotone"
                dataKey={k}
                stackId="1"
                stroke={seriesColor(k)}
                fill={seriesColor(k)}
                fillOpacity={0.45}
                strokeWidth={1.5}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
        {hasManualOverridesInSeriesForecast ? (
          <p className="mt-3 text-[11px] text-muted-foreground">
            {t("charts.manualOverrideTooltipHint")}
          </p>
        ) : null}
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t("upcoming.title")}</h3>
          <span className="text-xs font-medium text-muted-foreground">
            {upcomingHarvests.length}{" "}
            {upcomingHarvests.length !== 1 ? t("upcoming.harvests") : t("upcoming.harvest")}
            {upcomingTotalsSummary ? ` · ${upcomingTotalsSummary}` : ""}
          </span>
        </div>
        {upcomingHarvests.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("upcoming.empty")}
          </p>
        ) : (
          <div className="max-h-[360px] space-y-1 overflow-y-auto pr-1">
            {upcomingHarvests.map((h) => (
              <div
                key={h.id}
                className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-[hsl(var(--muted)/0.3)]"
              >
                <div className="h-2 w-2 shrink-0 rounded-full bg-accent" />
                <div className="min-w-[90px] text-sm font-medium">{formatDayMonth(h.date)}</div>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate">
                    <span className="font-medium">{h.farm}</span>
                    <span className="text-muted-foreground"> . {h.grass} {zoneLabel(h.zone)}</span>
                  </p>
                  {(h.project || h.customer) && (
                    <p className="text-[11px] text-muted-foreground truncate">
                      {h.customer}{h.customer && h.project ? ' · ' : ''}{h.project}
                    </p>
                  )}
                </div>
                <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
                  {t("upcoming.scheduled")}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${loadTypeBadgeMeta(h.harvestType, t).className}`}
                >
                  {loadTypeBadgeMeta(h.harvestType, t).label}
                </span>
                {h.inventoryIsCapped ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                    {t("badges.max")}
                  </span>
                ) : null}
                <span className="min-w-22 shrink-0 text-right text-sm font-medium text-destructive">
                  -{formatForecastQty(h.qty, h.uom)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="mb-4 text-sm font-semibold">{t("events.title")}</h3>
        <p className="mb-4 text-xs text-muted-foreground">
          {t("events.description")}
        </p>
        {regrowthEvents.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("events.empty")}</p>
        ) : (
          <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
            {regrowthEvents.map((ev, i) => (
              <div
                key={`${ev.date}-${ev.farm}-${ev.grass}-${i}`}
                className="flex items-center gap-4 rounded-lg px-3 py-2.5 hover:bg-[hsl(var(--muted)/0.3)]"
              >
                <div className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                <div className="min-w-[90px] text-sm font-medium">{formatDayMonth(ev.date)}</div>
                <div className="flex-1 text-sm">
                  <span className="font-medium">{ev.farm}</span>
                  <span className="text-muted-foreground"> . {ev.grass}</span>
                </div>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  {ev.type}
                </span>
                {ev.inventoryIsCapped ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                    {t("badges.max")}
                  </span>
                ) : null}
                {ev.overflowKg > 0 ? (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">
                    +{ev.overflowKg.toLocaleString()} {t("events.overflow")}
                  </span>
                ) : null}
                <span className="min-w-22 shrink-0 text-right text-sm font-medium">
                  +{formatForecastQty(ev.qty, ev.uom)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t("reference.title")}</h3>
          <span className="text-[11px] text-muted-foreground">
            {t("reference.editableInAdmin")}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs lg:grid-cols-3">
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="font-medium">{t("reference.sodHarvest")}</p>
            <p className="mt-1 text-muted-foreground">{regrowthConfig.sodDays} {t("days")}</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="font-medium">{t("reference.sodForSprig")}</p>
            <p className="mt-1 text-muted-foreground">{regrowthConfig.sodForSprigDays} {t("days")}</p>
          </div>
          {regrowthConfig.sprigBands.map((b, idx) => (
            <div key={b.id} className="rounded-lg bg-muted/50 p-3">
              <p className="font-medium">
                {t("reference.sprig")} {formatSprigRangeForReference(regrowthConfig.sprigBands, idx)}
              </p>
              <p className="mt-1 text-muted-foreground">{b.regrowthDays} {t("days")}</p>
            </div>
          ))}
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="font-medium">{t("reference.overrideRecovery")}</p>
            <p className="mt-1 text-muted-foreground">
              {regrowthConfig.overrideRecoveryDays} {t("days")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
