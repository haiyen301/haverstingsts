"use client";

import { useEffect, useState } from "react";

import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";

/** True after `harvestingDataStore` rehydrates from sessionStorage (safe to read catalog / bootstrap). */
export function useHarvestingReferenceHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() =>
    useHarvestingDataStore.persist.hasHydrated(),
  );

  useEffect(() => {
    if (useHarvestingDataStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    return useHarvestingDataStore.persist.onFinishHydration(() => {
      setHydrated(true);
    });
  }, []);

  return hydrated;
}
