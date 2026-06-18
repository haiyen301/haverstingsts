"use client";

import { useEffect, useMemo, useState } from "react";

import { getForecastToday, ymdFromDate } from "@/features/forecasting/forecastDateUtils";
import {
  fetchForecastMeta,
  fetchForecastSnapshots,
  queueForecastForwardRebuild,
  AGGREGATE_ZONE_KEY,
  type DbSnapshotRow,
} from "@/features/forecasting/forecastSnapshotApi";
import {
  buildAggregateAvailableByDate,
  filterSnapshotRowsForZoneKey,
  zoneLevelSnapshotRows,
} from "@/features/forecasting/inventoryDbSnapshots";
import { forecastZoneKeysEqual } from "@/features/forecasting/inventoryRegrowthCalculator";
import { useForecastDataStore } from "@/shared/store/forecastDataStore";

type Args = {
  dateFrom: string;
  dateTo: string;
  zoneKey?: string | null;
  farmId?: number | null;
  grassId?: number | null;
  enabled?: boolean;
  refreshKey?: number;
};

export function useInventoryZoneDbSnapshots(args: Args) {
  const enabled = args.enabled ?? true;
  const [snapshotRows, setSnapshotRows] = useState<DbSnapshotRow[]>([]);
  const [aggregateAvailableByDate, setAggregateAvailableByDate] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputKey = useMemo(
    () =>
      JSON.stringify({
        from: args.dateFrom,
        to: args.dateTo,
        zoneKey: args.zoneKey ?? "",
        farmId: args.farmId ?? "",
        grassId: args.grassId ?? "",
        refresh: args.refreshKey ?? 0,
      }),
    [args.dateFrom, args.dateTo, args.zoneKey, args.farmId, args.grassId, args.refreshKey],
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const anchor = ymdFromDate(getForecastToday());
        const meta = await fetchForecastMeta(anchor);
        if (cancelled) return;

        const stale = Boolean(meta?.is_stale);
        setIsStale(stale);
        if (stale && (meta?.snapshot_count ?? 0) > 0) {
          void queueForecastForwardRebuild(anchor).catch(() => undefined);
        }

        const farmId = args.farmId != null && args.farmId > 0 ? args.farmId : undefined;
        const grassId = args.grassId != null && args.grassId > 0 ? args.grassId : undefined;
        const zoneKey = args.zoneKey?.trim() || undefined;

        let rawRows = await fetchForecastSnapshots({
          dateFrom: args.dateFrom,
          dateTo: args.dateTo,
          ...(zoneKey ? { zoneKey } : {}),
          ...(farmId ? { farmId } : {}),
          ...(grassId ? { grassId } : {}),
        });

        if (
          zoneKey &&
          rawRows.length === 0 &&
          farmId != null &&
          grassId != null
        ) {
          rawRows = await fetchForecastSnapshots({
            dateFrom: args.dateFrom,
            dateTo: args.dateTo,
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

  useEffect(() => {
    if (!enabled || !isStale) return;
    let cancelled = false;
    const intervalId = setInterval(() => {
      void (async () => {
        try {
          const anchor = ymdFromDate(getForecastToday());
          const meta = await fetchForecastMeta(anchor);
          if (cancelled || meta?.is_stale) return;
          useForecastDataStore.getState().bumpDbSeriesRefresh();
        } catch {
          /* retry on next tick */
        }
      })();
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [enabled, isStale]);

  const hasData = snapshotRows.length > 0 || aggregateAvailableByDate.size > 0;

  return {
    snapshotRows,
    aggregateAvailableByDate,
    hasData,
    isLoading,
    isStale,
    error,
  };
}
