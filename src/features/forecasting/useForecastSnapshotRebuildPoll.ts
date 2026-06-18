"use client";

import { useEffect, useState } from "react";

import { getForecastToday, ymdFromDate } from "@/features/forecasting/forecastDateUtils";
import { fetchForecastMeta } from "@/features/forecasting/forecastSnapshotApi";
import { useForecastDataStore } from "@/shared/store/forecastDataStore";

const POLL_MS = 5000;

/**
 * Poll forecast meta until queued rebuild finishes, then bump DB snapshot refresh.
 * Used by /forecasting chart and /inventory zone tables.
 */
export function useForecastSnapshotRebuildPoll(enabled = true) {
  const snapshotRebuildPending = useForecastDataStore((s) => s.snapshotRebuildPending);
  const setSnapshotRebuildPending = useForecastDataStore((s) => s.setSnapshotRebuildPending);
  const bumpDbSeriesRefresh = useForecastDataStore((s) => s.bumpDbSeriesRefresh);
  const [metaStale, setMetaStale] = useState(false);

  const rebuilding = snapshotRebuildPending || metaStale;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    void (async () => {
      try {
        const anchor = ymdFromDate(getForecastToday());
        const meta = await fetchForecastMeta(anchor);
        if (cancelled) return;
        const stale = Boolean(meta?.is_stale);
        setMetaStale(stale);
        if (!stale && snapshotRebuildPending) {
          setSnapshotRebuildPending(false);
        }
      } catch {
        /* retry on poll interval */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, snapshotRebuildPending, setSnapshotRebuildPending]);

  useEffect(() => {
    if (!enabled || !rebuilding) return;
    let cancelled = false;

    const intervalId = setInterval(() => {
      void (async () => {
        try {
          const anchor = ymdFromDate(getForecastToday());
          const meta = await fetchForecastMeta(anchor);
          if (cancelled) return;
          const stale = Boolean(meta?.is_stale);
          setMetaStale(stale);
          if (stale) return;
          setSnapshotRebuildPending(false);
          bumpDbSeriesRefresh();
        } catch {
          /* retry on next tick */
        }
      })();
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [enabled, rebuilding, bumpDbSeriesRefresh, setSnapshotRebuildPending]);

  return { rebuilding, metaStale };
}
