"use client";

import { useEffect, useMemo, useState } from "react";

import {
  enrichHarvestPlansWithRegrowthSchedules,
  mapHarvestDetailRowsToPlans,
  mapRegrowthDetailRowsToSources,
  type DevForecastCalendarHarvestPlan,
  type SourceAuditRow,
} from "@/features/forecasting/availableSourceDbMappers";
import type { RollingDailyAvailableDay } from "@/features/forecasting/forecastDbTypes";
import { getForecastToday, ymdFromDate } from "@/features/forecasting/forecastDateUtils";
import { buildDbDailySeriesResult } from "@/features/forecasting/mapDbSnapshots";
import {
  AGGREGATE_ZONE_KEY,
  fetchForecastDayDetail,
  fetchForecastMeta,
  fetchForecastSnapshots,
  fetchRegrowthStats,
  type RegrowthDayStats,
  type SnapshotDateBounds,
} from "@/features/forecasting/forecastSnapshotApi";
import { useForecastDataStore } from "@/shared/store/forecastDataStore";

const EMPTY: RollingDailyAvailableDay[] = [];

export type DbSelectableBounds = {
  minDate: string;
  maxDate: string;
  aggregateBounds: SnapshotDateBounds | null;
};

type Args = {
  dateFrom: string;
  dateTo: string;
  anchorDate?: string;
  farmIds: string[];
  grassIds: string[];
  calendarOpen: boolean;
  refreshKey?: number;
  enabled?: boolean;
};

function clampYmd(value: string, min: string, max: string): string {
  if (!value) return max;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function boundsFromMeta(meta: Awaited<ReturnType<typeof fetchForecastMeta>>): DbSelectableBounds | null {
  const selectable = meta?.selectable_bounds;
  if (selectable?.min_date && selectable?.max_date) {
    return {
      minDate: selectable.min_date,
      maxDate: selectable.max_date,
      aggregateBounds: meta?.snapshot_date_bounds?.aggregate ?? null,
    };
  }

  const aggregate = meta?.snapshot_date_bounds?.aggregate;
  if (aggregate?.min_date && aggregate?.max_date) {
    return {
      minDate: aggregate.min_date,
      maxDate: aggregate.max_date,
      aggregateBounds: aggregate,
    };
  }

  const all = meta?.snapshot_date_bounds?.all;
  if (all?.min_date && all?.max_date) {
    return {
      minDate: all.min_date,
      maxDate: all.max_date,
      aggregateBounds: null,
    };
  }

  return null;
}

async function fetchDayDetailsForDates(
  harvestDates: string[],
  regrowthDates: string[],
  anchor: string,
): Promise<{
  harvestByDate: Map<string, DevForecastCalendarHarvestPlan[]>;
  regrowthByDate: Map<string, SourceAuditRow[]>;
}> {
  const harvestByDate = new Map<string, DevForecastCalendarHarvestPlan[]>();
  const regrowthByDate = new Map<string, SourceAuditRow[]>();
  const harvestSet = new Set(harvestDates);
  const regrowthSet = new Set(regrowthDates);
  const allDates = [...new Set([...harvestDates, ...regrowthDates])].sort();
  const chunkSize = 6;

  for (let i = 0; i < allDates.length; i += chunkSize) {
    const chunk = allDates.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async (date) => {
        const needHarvest = harvestSet.has(date);
        const needRegrowth = regrowthSet.has(date);
        const [harvestRes, regrowthRes] = await Promise.all([
          needHarvest
            ? fetchForecastDayDetail({ date, kind: "harvest", anchorDate: anchor }).catch(() => null)
            : null,
          needRegrowth
            ? fetchForecastDayDetail({ date, kind: "regrowth", anchorDate: anchor }).catch(() => null)
            : null,
        ]);
        if (needHarvest && harvestRes) {
          harvestByDate.set(date, mapHarvestDetailRowsToPlans(harvestRes.rows ?? []));
        }
        if (needRegrowth && regrowthRes) {
          regrowthByDate.set(date, mapRegrowthDetailRowsToSources(regrowthRes.rows ?? []));
        }
      }),
    );
  }

  return { harvestByDate, regrowthByDate };
}

export function useAvailableSourceDbAudit(args: Args) {
  const enabled = args.enabled ?? true;
  const dbSeriesRefreshKey = useForecastDataStore((s) => s.dbSeriesRefreshKey);
  const [rollingDailyAvailable, setRollingDailyAvailable] =
    useState<RollingDailyAvailableDay[]>(EMPTY);
  const [regrowthStatsByDate, setRegrowthStatsByDate] = useState<
    Map<string, RegrowthDayStats>
  >(new Map());
  const [harvestPlansByDate, setHarvestPlansByDate] = useState<
    Map<string, DevForecastCalendarHarvestPlan[]>
  >(new Map());
  const [regrowthSourcesByDate, setRegrowthSourcesByDate] = useState<
    Map<string, SourceAuditRow[]>
  >(new Map());
  const [hasDbData, setHasDbData] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshotCount, setSnapshotCount] = useState(0);
  const [selectableBounds, setSelectableBounds] = useState<DbSelectableBounds | null>(null);

  const inputKey = useMemo(
    () =>
      JSON.stringify({
        from: args.dateFrom,
        to: args.dateTo,
        anchor: args.anchorDate ?? "",
        refresh: args.refreshKey ?? 0,
        storeRefresh: dbSeriesRefreshKey,
        farms: args.farmIds,
        grasses: args.grassIds,
      }),
    [args.dateFrom, args.dateTo, args.anchorDate, args.refreshKey, args.farmIds, args.grassIds, dbSeriesRefreshKey],
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function loadSnapshots() {
      setIsLoading(true);
      setError(null);
      setHasDbData(false);
      setHarvestPlansByDate(new Map());
      setRegrowthSourcesByDate(new Map());

      try {
        const anchor = args.anchorDate?.trim() || ymdFromDate(getForecastToday());
        const meta = await fetchForecastMeta(anchor);
        if (cancelled) return;

        const bounds = boundsFromMeta(meta);
        setSelectableBounds(bounds);

        const totalInDb = meta?.total_snapshot_count ?? meta?.snapshot_count ?? 0;
        setSnapshotCount(totalInDb);

        const useAggregateOnly =
          args.farmIds.length === 0 && args.grassIds.length === 0;

        let dateFrom = args.dateFrom;
        let dateTo = args.dateTo;
        if (bounds) {
          dateFrom = clampYmd(dateFrom, bounds.minDate, bounds.maxDate);
          dateTo = clampYmd(dateTo, bounds.minDate, bounds.maxDate);
          if (dateFrom > dateTo) dateTo = dateFrom;
        }

        const snapshots = await fetchForecastSnapshots({
          dateFrom,
          dateTo,
          zoneKey: useAggregateOnly ? AGGREGATE_ZONE_KEY : undefined,
        });

        const regrowthStats = await fetchRegrowthStats({
          dateFrom,
          dateTo,
          anchorDate: anchor,
        });
        if (cancelled) return;

        if (snapshots.length === 0) {
          setRollingDailyAvailable(EMPTY);
          setRegrowthStatsByDate(new Map());
          setHasDbData(false);
          if (totalInDb > 0 && bounds) {
            setError(
              `DB có ${totalInDb.toLocaleString()} snapshot (${bounds.minDate} → ${bounds.maxDate}) nhưng không có dòng trong khoảng ${dateFrom} → ${dateTo}. Chọn From/To trong phạm vi DB.`,
            );
          } else if (totalInDb > 0) {
            setError(
              `DB có ${totalInDb.toLocaleString()} snapshot nhưng không có dòng aggregate trong khoảng ${dateFrom} → ${dateTo}. Chạy rebuild hoặc mở rộng From/To.`,
            );
          }
          return;
        }

        const dbResult = buildDbDailySeriesResult(
          snapshots,
          regrowthStats,
          args.farmIds,
          args.grassIds,
          [],
          { anchorYmd: anchor },
        );
        setRollingDailyAvailable(dbResult.aggregate);
        setRegrowthStatsByDate(dbResult.regrowthStatsByDate);
        setHasDbData(dbResult.aggregate.length > 0);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load DB snapshots");
          setRollingDailyAvailable(EMPTY);
          setHasDbData(false);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadSnapshots();
    return () => {
      cancelled = true;
    };
  }, [enabled, inputKey, args.dateFrom, args.dateTo, args.anchorDate, args.refreshKey, args.farmIds, args.grassIds]);

  useEffect(() => {
    if (!enabled || !args.calendarOpen || !hasDbData || rollingDailyAvailable.length === 0) {
      return;
    }
    let cancelled = false;

    async function loadDetails() {
      setDetailsLoading(true);
      try {
        const anchor = args.anchorDate?.trim() || ymdFromDate(getForecastToday());
        const harvestDates: string[] = [];
        const regrowthDates: string[] = [];

        for (const day of rollingDailyAvailable) {
          const stats = regrowthStatsByDate.get(day.date);
          if (day.harvestKg > 0) {
            harvestDates.push(day.date);
          }
          if (day.regrowthKg > 0 || (stats?.source_count ?? 0) > 0) {
            regrowthDates.push(day.date);
          }
        }

        const { harvestByDate, regrowthByDate } = await fetchDayDetailsForDates(
          harvestDates,
          regrowthDates,
          anchor,
        );
        if (cancelled) return;
        setHarvestPlansByDate(enrichHarvestPlansWithRegrowthSchedules(harvestByDate, regrowthByDate));
        setRegrowthSourcesByDate(regrowthByDate);
      } finally {
        if (!cancelled) setDetailsLoading(false);
      }
    }

    void loadDetails();
    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    args.anchorDate,
    args.calendarOpen,
    hasDbData,
    rollingDailyAvailable,
    regrowthStatsByDate,
  ]);

  return {
    rollingDailyAvailable,
    regrowthStatsByDate,
    harvestPlansByDate,
    regrowthSourcesByDate,
    hasDbData,
    isLoading,
    detailsLoading,
    error,
    snapshotCount,
    selectableBounds,
  };
}
