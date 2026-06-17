"use client";

import { useCallback, useEffect, useMemo } from "react";

import { getForecastToday } from "@/features/forecasting/forecastDateUtils";
import { ensureForecastDataLoaded } from "@/features/forecasting/forecastDataLoader";
import {
  filterActiveRegrowthRules,
  filterActiveZoneConfigurations,
} from "@/features/forecasting/forecastActiveRecords";
import { buildForecastRowsFromHarvestRaw } from "@/features/forecasting/mapHarvestApiToForecastRows";
import {
  DEFAULT_REGROWTH_REFERENCE_CONFIG,
  resolveRegrowthReferenceConfigFromRules,
} from "@/features/forecasting/forecastingRegrowth";
import {
  type ForecastCacheScope,
  useForecastDataStore,
} from "@/shared/store/forecastDataStore";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { useHarvestingReferenceHydrated } from "@/shared/hooks/useHarvestingReferenceHydrated";
import { useInventoryAvailableOverrideStore } from "@/shared/store/inventoryAvailableOverrideStore";
import { setForecastZoneCatalog } from "@/features/forecasting/zoneKeyNormalization";

const ALL_SCOPES = new Set<ForecastCacheScope>([
  "overrides",
  "harvest",
  "zones",
  "rules",
  "reference",
]);

export function useForecastSnapshot(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;

  const harvestRowsRaw = useForecastDataStore((s) => s.harvestRowsRaw);
  const forecastRowsCached = useForecastDataStore((s) => s.forecastRows);
  const zoneConfigs = useForecastDataStore((s) => s.zoneConfigs);
  const regrowthConfig = useForecastDataStore((s) => s.regrowthConfig);
  const harvestError = useForecastDataStore((s) => s.harvestError);
  const isLoading = useForecastDataStore((s) => s.isLoading);
  const isRefreshing = useForecastDataStore((s) => s.isRefreshing);
  const isRecomputing = useForecastDataStore((s) => s.isRecomputing);
  const hasSnapshot = useForecastDataStore((s) => s.hasSnapshot);
  const error = useForecastDataStore((s) => s.error);

  const overridesByZone = useInventoryAvailableOverrideStore((s) => s.overridesByZone);
  const farmZones = useHarvestingDataStore((s) => s.farmZones);
  const zoneConfigurationsRef = useHarvestingDataStore((s) => s.zoneConfigurations);
  const regrowthRulesRef = useHarvestingDataStore((s) => s.regrowthRules);
  const referenceBootstrapDone = useHarvestingDataStore((s) => s.bootstrapDone);
  const referenceHydrated = useHarvestingReferenceHydrated();

  useEffect(() => {
    setForecastZoneCatalog(farmZones);
  }, [farmZones]);

  /** Keep forecast config scopes aligned with `harvestingDataStore` without network calls. */
  useEffect(() => {
    if (!enabled) return;
    if (referenceBootstrapDone || farmZones.length > 0) {
      useForecastDataStore.getState().markValid("reference");
    }
    if (referenceBootstrapDone || zoneConfigurationsRef.length > 0) {
      const active = filterActiveZoneConfigurations(zoneConfigurationsRef);
      useForecastDataStore.getState().setZoneConfigs(active);
      useForecastDataStore.getState().markValid("zones");
    }
    if (referenceBootstrapDone || regrowthRulesRef.length > 0) {
      useForecastDataStore
        .getState()
        .setRegrowthConfig(
          resolveRegrowthReferenceConfigFromRules(
            filterActiveRegrowthRules(regrowthRulesRef),
          ),
        );
      useForecastDataStore.getState().markValid("rules");
    }
  }, [
    enabled,
    farmZones,
    zoneConfigurationsRef,
    regrowthRulesRef,
    referenceBootstrapDone,
  ]);

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
    if (!enabled || !referenceHydrated) return;
    let cancelled = false;
    void ensureForecastDataLoaded({ scopes: ALL_SCOPES }).then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, referenceHydrated]);

  const combinedError = error ?? harvestError ?? null;

  /** Always remap from raw plans so charts / lists use latest m²→kg rules (Sod quantity, zone 1). */
  const activeZoneConfigs = useMemo(
    () => filterActiveZoneConfigurations(zoneConfigs ?? []),
    [zoneConfigs],
  );

  const forecastRows = useMemo(() => {
    if (harvestRowsRaw?.length) {
      return buildForecastRowsFromHarvestRaw(
        harvestRowsRaw,
        activeZoneConfigs,
        getForecastToday(),
        farmZones,
      );
    }
    return forecastRowsCached ?? [];
  }, [harvestRowsRaw, activeZoneConfigs, forecastRowsCached, farmZones]);

  return {
    forecastRows,
    harvestRowsRaw: harvestRowsRaw ?? [],
    zoneConfigs: activeZoneConfigs,
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
