"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { ZoneConfigurationRow } from "@/features/admin/api/adminApi";
import {
  computeInventoryStyleFarmGrassDailySeriesWithBreakdown,
  type DailySeriesResult,
} from "@/features/forecasting/forecastAvailableAtDate";
import {
  deserializeDailySeriesResult,
  runForecastDailySeriesCompute,
  type ForecastComputeWorkerRequest,
  type ForecastComputeWorkerResponse,
} from "@/features/forecasting/forecastComputeShared";
import type { ForecastHarvestRow } from "@/features/forecasting/forecastingTypes";
import type { RegrowthReferenceConfig } from "@/features/forecasting/forecastingRegrowth";
import type { InventoryAvailableOverrideEntry } from "@/shared/store/inventoryAvailableOverrideStore";
import { useForecastDataStore } from "@/shared/store/forecastDataStore";
import { getForecastToday } from "@/features/forecasting/forecastDateUtils";

const EMPTY_RESULT: DailySeriesResult = {
  aggregate: [],
  byFarmProduct: new Map(),
};

type UseForecastDailySeriesArgs = {
  filteredRows: ForecastHarvestRow[];
  zoneConfigs: ZoneConfigurationRow[];
  regrowthConfig: RegrowthReferenceConfig;
  overridesByZone: Record<string, InventoryAvailableOverrideEntry>;
  forecastHorizonEnd: Date;
  debouncedFarmIds: string[];
  debouncedGrassIds: string[];
  enabled?: boolean;
};

function computeSync(args: UseForecastDailySeriesArgs): DailySeriesResult {
  const farmIdSet = new Set(args.debouncedFarmIds);
  const grassIdSet = new Set(args.debouncedGrassIds);
  const farmProductFilter = (farmId: number, productId: number) => {
    if (farmIdSet.size > 0 && !farmIdSet.has(String(farmId))) return false;
    if (grassIdSet.size > 0 && !grassIdSet.has(String(productId))) return false;
    return true;
  };

  return computeInventoryStyleFarmGrassDailySeriesWithBreakdown(
    args.filteredRows,
    args.zoneConfigs,
    args.regrowthConfig,
    args.overridesByZone,
    getForecastToday(),
    args.forecastHorizonEnd,
    farmProductFilter,
  );
}

export function useForecastDailySeries(args: UseForecastDailySeriesArgs): DailySeriesResult {
  const enabled = args.enabled ?? true;
  const [result, setResult] = useState<DailySeriesResult>(EMPTY_RESULT);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);

  const inputKey = useMemo(
    () =>
      JSON.stringify({
        rowsLen: args.filteredRows.length,
        zonesLen: args.zoneConfigs.length,
        horizon: args.forecastHorizonEnd.getTime(),
        farms: args.debouncedFarmIds,
        grasses: args.debouncedGrassIds,
        overridesLen: Object.keys(args.overridesByZone).length,
      }),
    [
      args.filteredRows.length,
      args.zoneConfigs.length,
      args.forecastHorizonEnd,
      args.debouncedFarmIds,
      args.debouncedGrassIds,
      args.overridesByZone,
    ],
  );

  useEffect(() => {
    if (!enabled || (args.filteredRows.length === 0 && args.zoneConfigs.length === 0)) {
      setResult(EMPTY_RESULT);
      useForecastDataStore.getState().setLoadState({ isRecomputing: false });
      return;
    }

    let cancelled = false;
    useForecastDataStore.getState().setLoadState({ isRecomputing: true });

    const runSyncFallback = () => {
      if (cancelled) return;
      setResult(computeSync(args));
      useForecastDataStore.getState().setLoadState({ isRecomputing: false });
    };

    if (typeof Worker === "undefined") {
      runSyncFallback();
      return () => {
        cancelled = true;
      };
    }

    try {
      if (!workerRef.current) {
        workerRef.current = new Worker(
          new URL("./forecastCompute.worker.ts", import.meta.url),
        );
      }

      const worker = workerRef.current;
      const requestId = ++requestIdRef.current;

      const onMessage = (event: MessageEvent<ForecastComputeWorkerResponse & { error?: string }>) => {
        if (event.data.id !== requestId) return;
        worker.removeEventListener("message", onMessage);
        if (cancelled) return;
        if (event.data.error) {
          runSyncFallback();
          return;
        }
        setResult(deserializeDailySeriesResult(event.data));
        useForecastDataStore.getState().setLoadState({ isRecomputing: false });
      };

      worker.addEventListener("message", onMessage);

      const payload: ForecastComputeWorkerRequest = {
        id: requestId,
        forecastRows: args.filteredRows,
        zoneConfigs: args.zoneConfigs,
        regrowthConfig: args.regrowthConfig,
        overridesByZone: args.overridesByZone,
        startDateMs: getForecastToday().getTime(),
        endDateMs: args.forecastHorizonEnd.getTime(),
        debouncedFarmIds: args.debouncedFarmIds,
        debouncedGrassIds: args.debouncedGrassIds,
      };
      worker.postMessage(payload);

      return () => {
        cancelled = true;
        worker.removeEventListener("message", onMessage);
      };
    } catch {
      runSyncFallback();
      return () => {
        cancelled = true;
      };
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by inputKey
  }, [
    enabled,
    inputKey,
    args.filteredRows,
    args.zoneConfigs,
    args.regrowthConfig,
    args.overridesByZone,
    args.forecastHorizonEnd,
    args.debouncedFarmIds,
    args.debouncedGrassIds,
  ]);

  return result;
}
