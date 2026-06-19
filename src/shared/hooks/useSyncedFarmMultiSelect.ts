"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

import type { AppPermissionModule } from "@/shared/auth/permissions";
import type { HarvestSelectOption } from "@/shared/lib/harvestReferenceData";
import {
  buildScopedFarmSelectOptions,
  clampFarmIdsToScope,
  useFarmUserScope,
} from "@/shared/store/farmUserScope";
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
export function useSyncedFarmMultiSelect(
  module: AppPermissionModule = "harvests",
): SyncedFarmMultiSelect {
  const farms = useHarvestingDataStore((s) => s.farms);
  const harvestListFarmFilter = useHarvestingDataStore((s) => s.harvestListFarmFilter);
  const setHarvestListFarmFilter = useHarvestingDataStore((s) => s.setHarvestListFarmFilter);
  const { scopeIds, scopeKey } = useFarmUserScope(module);
  const appliedScopeKeyRef = useRef<string | null>(null);

  const farmOptions = useMemo(
    () => buildScopedFarmSelectOptions(farms as unknown[], scopeIds),
    [farms, scopeIds],
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
      const next = toCsvList(clampFarmIdsToScope(ids, scopeIds));
      if (next === useHarvestingDataStore.getState().harvestListFarmFilter) return;
      setHarvestListFarmFilter(next);
    },
    [scopeIds, setHarvestListFarmFilter],
  );

  /** One-time clamp when farm scope becomes known — avoids URL/store fight loops. */
  useEffect(() => {
    if (appliedScopeKeyRef.current === scopeKey) return;
    appliedScopeKeyRef.current = scopeKey;
    if (!scopeIds?.length) return;

    const current = parseCsvList(useHarvestingDataStore.getState().harvestListFarmFilter);
    const next = toCsvList(clampFarmIdsToScope(current, scopeIds));
    if (next !== useHarvestingDataStore.getState().harvestListFarmFilter) {
      setHarvestListFarmFilter(next);
    }
  }, [scopeKey, scopeIds, setHarvestListFarmFilter]);

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
