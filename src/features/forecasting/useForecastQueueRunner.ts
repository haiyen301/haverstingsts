"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";

import {
  fetchForecastQueueStatus,
  processForecastQueueJob,
  type ForecastQueueStatus,
} from "@/features/forecasting/forecastSnapshotApi";
import { notifyForecastRefresh } from "@/features/forecasting/forecastDataSync";
import { useForecastDataStore } from "@/shared/store/forecastDataStore";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";

const STATUS_POLL_MS = 5000;

let sharedProcessing = false;

function applyQueueStatus(status: ForecastQueueStatus | null): void {
  if (!status) return;
  const store = useForecastDataStore.getState();
  if (status.is_stale) {
    store.setSnapshotRebuildPending(true);
  } else {
    store.setSnapshotRebuildPending(false);
  }
}

export function useForecastQueueRunner() {
  const bumpDbSeriesRefresh = useForecastDataStore((s) => s.bumpDbSeriesRefresh);
  const snapshotRebuildPending = useForecastDataStore((s) => s.snapshotRebuildPending);
  const [queueStatus, setQueueStatus] = useState<ForecastQueueStatus | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const refreshQueueStatus = useCallback(async () => {
    try {
      const status = await fetchForecastQueueStatus();
      if (!status) return null;
      setQueueStatus(status);
      applyQueueStatus(status);
      return status;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshQueueStatus();
  }, [refreshQueueStatus, snapshotRebuildPending]);

  useEffect(() => {
    if (!queueStatus?.is_stale && !snapshotRebuildPending) return;
    let cancelled = false;

    const intervalId = window.setInterval(() => {
      void (async () => {
        const status = await refreshQueueStatus();
        if (cancelled || !status) return;
        if (!status.is_stale && !sharedProcessing) {
          bumpDbSeriesRefresh();
          await notifyForecastRefresh(
            new Set(["overrides", "harvest", "zones", "rules", "reference"]),
          );
        }
      })();
    }, STATUS_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [queueStatus?.is_stale, snapshotRebuildPending, refreshQueueStatus, bumpDbSeriesRefresh]);

  const refreshPageData = useCallback(async () => {
    bumpDbSeriesRefresh();
    await notifyForecastRefresh(
      new Set(["overrides", "harvest", "zones", "rules", "reference"]),
    );
    await refreshQueueStatus();
  }, [bumpDbSeriesRefresh, refreshQueueStatus]);

  const runNextQueueJob = useCallback(async () => {
    if (sharedProcessing || isProcessing) return;

    sharedProcessing = true;
    setIsProcessing(true);
    useForecastDataStore.getState().setSnapshotRebuildPending(true);

    try {
      const result = await processForecastQueueJob();
      setQueueStatus(result);
      applyQueueStatus(result);

      if (result.outcome === "completed") {
        bumpDbSeriesRefresh();
        await notifyForecastRefresh(
          new Set(["overrides", "harvest", "zones", "rules", "reference"]),
        );
        toast.success(result.message ?? "Queue job completed.", {
          containerId: TOAST_CONTAINER_TOP_RIGHT,
        });
      } else if (result.outcome === "empty") {
        toast.info(result.message ?? "No pending queue jobs.", {
          containerId: TOAST_CONTAINER_TOP_RIGHT,
        });
      } else if (result.outcome === "busy") {
        toast.warning(result.message ?? "A queue job is already running.", {
          containerId: TOAST_CONTAINER_TOP_RIGHT,
        });
      } else {
        toast.error(result.message ?? result.error ?? "Queue job failed.", {
          containerId: TOAST_CONTAINER_TOP_RIGHT,
        });
      }

      if (!result.is_stale) {
        useForecastDataStore.getState().setSnapshotRebuildPending(false);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to run queue job.", {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    } finally {
      sharedProcessing = false;
      setIsProcessing(false);
      void refreshQueueStatus();
    }
  }, [bumpDbSeriesRefresh, isProcessing, refreshQueueStatus]);

  const pendingJobs = queueStatus?.pending_jobs ?? 0;
  const queueBusy = Boolean(queueStatus?.is_processing) || isProcessing;
  const canRunQueue = pendingJobs > 0 && !queueBusy;

  return {
    queueStatus,
    isProcessing,
    queueBusy,
    canRunQueue,
    pendingJobs,
    refreshPageData,
    runNextQueueJob,
  };
}
