"use client";

import { useEffect, useMemo } from "react";

import type { GrassCatalogPickMode } from "@/shared/lib/harvestReferenceData";
import {
  buildGrassFilterOptionsForFarms,
  collectGrassIdsFromZoneConfigForFarms,
  pruneGrassIdsToFarmZoneOptions,
  type GrassFilterSelectOption,
  type ZoneConfigGrassLinkRow,
} from "@/shared/lib/grassFilterByFarmZone";

export type UseGrassFilterByFarmArgs = {
  grasses: unknown[];
  zoneConfigs: readonly ZoneConfigGrassLinkRow[];
  selectedFarmIds: readonly string[];
  selectedGrassIds: readonly string[];
  onSelectedGrassIdsChange: (ids: string[]) => void;
  catalogMode?: GrassCatalogPickMode;
  refYmds?: string[];
};

export type UseGrassFilterByFarmResult = {
  grassFilterOptions: GrassFilterSelectOption[];
  /** `null` when no farm is selected → full grass catalog applies. */
  allowedGrassIdsForSelectedFarms: Set<string> | null;
};

/**
 * Farm ↔ grass filter pairing used across Dashboard, Harvest, Inventory, and Forecasting.
 * All farms → full catalog; specific farm(s) → grasses from zone configuration only.
 */
export function useGrassFilterByFarm(args: UseGrassFilterByFarmArgs): UseGrassFilterByFarmResult {
  const {
    grasses,
    zoneConfigs,
    selectedFarmIds,
    selectedGrassIds,
    onSelectedGrassIdsChange,
    catalogMode = "all",
    refYmds = [],
  } = args;

  const grassFilterOptions = useMemo(
    () =>
      buildGrassFilterOptionsForFarms({
        grasses,
        zoneConfigs,
        selectedFarmIds,
        pinnedGrassIds: selectedGrassIds,
        catalogMode,
        refYmds,
      }),
    [grasses, zoneConfigs, selectedFarmIds, selectedGrassIds, catalogMode, refYmds],
  );

  const allowedGrassIdsForSelectedFarms = useMemo(
    () => collectGrassIdsFromZoneConfigForFarms(zoneConfigs, selectedFarmIds),
    [zoneConfigs, selectedFarmIds],
  );

  useEffect(() => {
    if (selectedGrassIds.length === 0) return;
    const next = pruneGrassIdsToFarmZoneOptions(selectedGrassIds, grassFilterOptions);
    if (next.length !== selectedGrassIds.length) {
      onSelectedGrassIdsChange(next);
    }
  }, [selectedGrassIds, grassFilterOptions, onSelectedGrassIdsChange]);

  return { grassFilterOptions, allowedGrassIdsForSelectedFarms };
}
