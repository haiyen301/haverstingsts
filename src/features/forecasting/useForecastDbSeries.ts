"use client";

import { useEffect, useMemo, useState } from "react";

import type { DailySeriesResult } from "@/features/forecasting/forecastDbTypes";
import { getForecastToday, ymdFromDate } from "@/features/forecasting/forecastDateUtils";
import {
  buildDbDailySeriesResult,
  type DbDailySeriesResult,
} from "@/features/forecasting/mapDbSnapshots";
import {
  fetchForecastMeta,
  fetchForecastSnapshots,
  fetchRegrowthStats,
  AGGREGATE_ZONE_KEY,
  type DbSnapshotRow,
} from "@/features/forecasting/forecastSnapshotApi";
import { useForecastSnapshotRebuildPoll } from "@/features/forecasting/useForecastSnapshotRebuildPoll";
import { useForecastDataStore } from "@/shared/store/forecastDataStore";

/** Zone rows carry farm_id + grass_id for stacked breakdown; aggregate rows do not. */
function zoneSnapshotRows(rows: DbSnapshotRow[]): DbSnapshotRow[] {
  return rows.filter((row) => String(row.zone_key ?? "") !== AGGREGATE_ZONE_KEY);
}

const EMPTY: DailySeriesResult = {
  aggregate: [],
  byFarmProduct: new Map(),
};

type Args = {
  dateFrom: string;
  dateTo: string;
  farmIds: string[];
  grassIds: string[];
  enabled?: boolean;
};

export function useForecastDbSeries(args: Args) {
  const enabled = args.enabled ?? true;
  const dbSeriesRefreshKey = useForecastDataStore((s) => s.dbSeriesRefreshKey);
  const { rebuilding } = useForecastSnapshotRebuildPoll(enabled);
  const [dbResult, setDbResult] = useState<DbDailySeriesResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputKey = useMemo(
    () =>
      JSON.stringify({
        from: args.dateFrom,
        to: args.dateTo,
        farms: args.farmIds,
        grasses: args.grassIds,
        refresh: dbSeriesRefreshKey,
      }),
    [args.dateFrom, args.dateTo, args.farmIds, args.grassIds, dbSeriesRefreshKey],
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const anchor = ymdFromDate(getForecastToday());
        await fetchForecastMeta(anchor);
        if (cancelled) return;

        const useAggregateOnly =
          args.farmIds.length === 0 && args.grassIds.length === 0;

        const regrowthPromise = fetchRegrowthStats({
          dateFrom: args.dateFrom,
          dateTo: args.dateTo,
          anchorDate: anchor,
        });

        let snapshots: DbSnapshotRow[];
        let regrowthStats: Awaited<typeof regrowthPromise>;

        if (useAggregateOnly) {
          const [aggregateRows, scopedRows, stats] = await Promise.all([
            fetchForecastSnapshots({
              dateFrom: args.dateFrom,
              dateTo: args.dateTo,
              zoneKey: AGGREGATE_ZONE_KEY,
            }),
            fetchForecastSnapshots({
              dateFrom: args.dateFrom,
              dateTo: args.dateTo,
            }),
            regrowthPromise,
          ]);
          if (cancelled) return;
          snapshots = [...aggregateRows, ...zoneSnapshotRows(scopedRows)];
          regrowthStats = stats;
        } else {
          const [scopedRows, stats] = await Promise.all([
            fetchForecastSnapshots({
              dateFrom: args.dateFrom,
              dateTo: args.dateTo,
            }),
            regrowthPromise,
          ]);
          if (cancelled) return;
          snapshots = scopedRows;
          regrowthStats = stats;
        }

        if (snapshots.length === 0) {
          setDbResult(null);
          return;
        }

        setDbResult(
          buildDbDailySeriesResult(snapshots, regrowthStats, args.farmIds, args.grassIds),
        );
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load forecast snapshots");
          setDbResult(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled, inputKey, args.dateFrom, args.dateTo, args.farmIds, args.grassIds]);

  const result: DailySeriesResult = dbResult
    ? { aggregate: dbResult.aggregate, byFarmProduct: dbResult.byFarmProduct }
    : EMPTY;

  return {
    result,
    regrowthStatsByDate: dbResult?.regrowthStatsByDate ?? new Map(),
    hasData: (dbResult?.aggregate.length ?? 0) > 0,
    isLoading,
    isStale: rebuilding,
    error,
  };
}
