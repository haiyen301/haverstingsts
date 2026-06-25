"use client";

import { useEffect, useMemo, useState } from "react";

import { getForecastToday, ymdFromDate } from "@/features/forecasting/forecastDateUtils";
import {
  fetchForecastMeta,
  fetchForecastSnapshots,
  fetchZoneBalanceHistorySnapshots,
  AGGREGATE_ZONE_KEY,
  type DbSnapshotRow,
} from "@/features/forecasting/forecastSnapshotApi";
import {
  buildAggregateAvailableByDate,
  filterSnapshotRowsForZoneKey,
  zoneLevelSnapshotRows,
} from "@/features/forecasting/inventoryDbSnapshots";
import { forecastZoneKeysEqual } from "@/features/forecasting/inventoryRegrowthCalculator";
import { useForecastSnapshotRebuildPoll } from "@/features/forecasting/useForecastSnapshotRebuildPoll";
import { useForecastDataStore } from "@/shared/store/forecastDataStore";

type Args = {
  dateFrom: string;
  dateTo: string;
  periodId?: number | null;
  /** Read MIN(snapshot_date)..dateTo across all periods (balance breakdown). */
  allPeriods?: boolean;
  /** Server-side filter: harvest/regrowth/manual/cap activity days only. */
  impactOnly?: boolean;
  zoneKey?: string | null;
  farmId?: number | null;
  grassId?: number | null;
  enabled?: boolean;
  refreshKey?: number;
};

export function useInventoryZoneDbSnapshots(args: Args) {
  const enabled = args.enabled ?? true;
  const dbSeriesRefreshKey = useForecastDataStore((s) => s.dbSeriesRefreshKey);
  const { rebuilding } = useForecastSnapshotRebuildPoll(enabled);
  const [snapshotRows, setSnapshotRows] = useState<DbSnapshotRow[]>([]);
  const [aggregateAvailableByDate, setAggregateAvailableByDate] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputKey = useMemo(
    () =>
      JSON.stringify({
        from: args.dateFrom,
        to: args.dateTo,
        zoneKey: args.zoneKey ?? "",
        farmId: args.farmId ?? "",
        grassId: args.grassId ?? "",
        periodId: args.periodId ?? "",
        allPeriods: args.allPeriods ?? false,
        refresh: args.refreshKey ?? 0,
        storeRefresh: dbSeriesRefreshKey,
        impactOnly: args.impactOnly ?? false,
      }),
    [
      args.dateFrom,
      args.dateTo,
      args.zoneKey,
      args.farmId,
      args.grassId,
      args.periodId,
      args.allPeriods,
      args.impactOnly,
      args.refreshKey,
      dbSeriesRefreshKey,
    ],
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

        const farmId = args.farmId != null && args.farmId > 0 ? args.farmId : undefined;
        const grassId = args.grassId != null && args.grassId > 0 ? args.grassId : undefined;
        const zoneKey = args.zoneKey?.trim() || undefined;

        const periodId =
          args.periodId != null && args.periodId > 0 ? args.periodId : undefined;
        const allPeriods = args.allPeriods === true;

        let rawRows: DbSnapshotRow[];
        if (allPeriods && zoneKey) {
          rawRows = await fetchZoneBalanceHistorySnapshots({
            dateFrom: args.dateFrom,
            dateTo: args.dateTo,
            zoneKey,
            farmId,
            grassId,
            impactOnly: args.impactOnly,
          });
        } else {
          rawRows = await fetchForecastSnapshots({
            dateFrom: args.dateFrom,
            dateTo: args.dateTo,
            ...(allPeriods ? { allPeriods: true } : periodId ? { periodId } : {}),
            ...(args.impactOnly ? { impactOnly: true } : {}),
            ...(zoneKey ? { zoneKey } : {}),
            ...(farmId ? { farmId } : {}),
            ...(grassId ? { grassId } : {}),
          });
        }

        if (
          zoneKey &&
          rawRows.length === 0 &&
          farmId != null &&
          grassId != null &&
          !allPeriods
        ) {
          rawRows = await fetchForecastSnapshots({
            dateFrom: args.dateFrom,
            dateTo: args.dateTo,
            ...(allPeriods ? { allPeriods: true } : periodId ? { periodId } : {}),
            farmId,
            grassId,
          });
        }

        if (cancelled) return;

        let zoneRows = zoneKey ? rawRows : zoneLevelSnapshotRows(rawRows);
        if (zoneKey) {
          zoneRows = filterSnapshotRowsForZoneKey(zoneRows, zoneKey);
          if (zoneRows.length === 0 && rawRows.length > 0) {
            zoneRows = zoneLevelSnapshotRows(rawRows).filter((row) =>
              forecastZoneKeysEqual(String(row.zone_key ?? ""), zoneKey),
            );
          }
        }

        const aggregateRows = zoneKey
          ? ([] as DbSnapshotRow[])
          : await fetchForecastSnapshots({
              dateFrom: args.dateFrom,
              dateTo: args.dateTo,
              zoneKey: AGGREGATE_ZONE_KEY,
            });

        if (cancelled) return;

        setSnapshotRows(zoneRows);
        setAggregateAvailableByDate(buildAggregateAvailableByDate(aggregateRows));
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load inventory snapshots");
          setSnapshotRows([]);
          setAggregateAvailableByDate(new Map());
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled, inputKey, args.dateFrom, args.dateTo, args.zoneKey, args.farmId, args.grassId]);

  const hasData = snapshotRows.length > 0 || aggregateAvailableByDate.size > 0;

  return {
    snapshotRows,
    aggregateAvailableByDate,
    hasData,
    isLoading,
    isStale: rebuilding,
    error,
  };
}
