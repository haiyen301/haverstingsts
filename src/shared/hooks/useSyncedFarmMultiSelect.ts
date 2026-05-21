"use client";

import { useCallback, useMemo } from "react";

import { mapRowsToSelectOptions, type HarvestSelectOption } from "@/shared/lib/harvestReferenceData";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";

export function parseCsvList(value: string | null | undefined): string[] {
  return String(value ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export function toCsvList(values: string[]): string {
  return values.map((x) => String(x).trim()).filter(Boolean).join(",");
}

type SyncedFarmMultiSelect = {
  farmOptions: HarvestSelectOption[];
  selectedFarmIds: string[];
  selectedFarmIdSet: Set<string>;
  selectedFarmLabels: string[];
  farmIdByName: Map<string, string>;
  farmNameById: Map<string, string>;
  setSelectedFarmIds: (ids: string[]) => void;
};

/** Shared helper for farm MultiSelect synchronized with global harvestListFarmFilter. */
export function useSyncedFarmMultiSelect(): SyncedFarmMultiSelect {
  const farms = useHarvestingDataStore((s) => s.farms);
  const harvestListFarmFilter = useHarvestingDataStore((s) => s.harvestListFarmFilter);
  const setHarvestListFarmFilter = useHarvestingDataStore((s) => s.setHarvestListFarmFilter);

  const farmOptions = useMemo(
    () => mapRowsToSelectOptions(farms as unknown[], "name"),
    [farms],
  );
  const selectedFarmIds = useMemo(
    () => parseCsvList(harvestListFarmFilter),
    [harvestListFarmFilter],
  );
  const selectedFarmIdSet = useMemo(
    () => new Set(selectedFarmIds),
    [selectedFarmIds],
  );

  const farmNameById = useMemo(
    () => new Map(farmOptions.map((o) => [o.id, o.label])),
    [farmOptions],
  );
  const farmIdByName = useMemo(
    () => new Map(farmOptions.map((o) => [o.label, o.id])),
    [farmOptions],
  );
  const selectedFarmLabels = useMemo(
    () => selectedFarmIds.map((id) => farmNameById.get(id) ?? id),
    [selectedFarmIds, farmNameById],
  );

  const setSelectedFarmIds = useCallback(
    (ids: string[]) => {
      setHarvestListFarmFilter(toCsvList(ids));
    },
    [setHarvestListFarmFilter],
  );

  return {
    farmOptions,
    selectedFarmIds,
    selectedFarmIdSet,
    selectedFarmLabels,
    farmIdByName,
    farmNameById,
    setSelectedFarmIds,
  };
}
