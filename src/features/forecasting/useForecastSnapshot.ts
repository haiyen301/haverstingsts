"use client";

import { useCallback, useEffect } from "react";

import {
  DEFAULT_REGROWTH_REFERENCE_CONFIG,
} from "@/features/forecasting/forecastingRegrowth";
import { ensureForecastDataLoaded } from "@/features/forecasting/forecastDataLoader";
import {
  type ForecastCacheScope,
  useForecastDataStore,
} from "@/shared/store/forecastDataStore";
import { useInventoryAvailableOverrideStore } from "@/shared/store/inventoryAvailableOverrideStore";

const ALL_SCOPES = new Set<ForecastCacheScope>([
  "overrides",
  "harvest",
  "zones",
  "rules",
  "reference",
]);

export function useForecastSnapshot(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;

  const forecastRows = useForecastDataStore((s) => s.forecastRows);
  const zoneConfigs = useForecastDataStore((s) => s.zoneConfigs);
  const regrowthConfig = useForecastDataStore((s) => s.regrowthConfig);
  const harvestError = useForecastDataStore((s) => s.harvestError);
  const isLoading = useForecastDataStore((s) => s.isLoading);
  const isRefreshing = useForecastDataStore((s) => s.isRefreshing);
  const isRecomputing = useForecastDataStore((s) => s.isRecomputing);
  const hasSnapshot = useForecastDataStore((s) => s.hasSnapshot);
  const error = useForecastDataStore((s) => s.error);

  const overridesByZone = useInventoryAvailableOverrideStore((s) => s.overridesByZone);

  const reloadFromCache = useCallback(
    async (scopes: Set<ForecastCacheScope> = ALL_SCOPES) => {
      for (const scope of scopes) {
        useForecastDataStore.getState().invalidate(scope);
      }
      await ensureForecastDataLoaded({ scopes, force: true, showLoading: false });
    },
    [],
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void ensureForecastDataLoaded({ scopes: ALL_SCOPES }).then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const combinedError = error ?? harvestError ?? null;

  return {
    forecastRows: forecastRows ?? [],
    zoneConfigs: zoneConfigs ?? [],
    regrowthConfig: regrowthConfig ?? DEFAULT_REGROWTH_REFERENCE_CONFIG,
    overridesByZone,
    isLoading,
    isRefreshing,
    isRecomputing,
    hasSnapshot,
    error: combinedError,
    reloadFromCache,
  };
}
