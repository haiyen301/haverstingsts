"use client";

import { useEffect, useState } from "react";

import {
  fetchFleetOptionCatalog,
  fleetOptionCatalogDefaults,
  fleetOptionCatalogToOptions,
  fleetOptionCatalogValues,
  type FleetOption,
  type FleetOptionCatalogKey,
  type FleetOptionCatalogRow,
} from "@/features/fleet/api/fleetOptionCatalogApi";

const cache = new Map<FleetOptionCatalogKey, FleetOptionCatalogRow[]>();
const cachePromises = new Map<FleetOptionCatalogKey, Promise<FleetOptionCatalogRow[]>>();

export function clearFleetOptionCatalogCache(catalog?: FleetOptionCatalogKey): void {
  if (catalog) {
    cache.delete(catalog);
    cachePromises.delete(catalog);
    return;
  }
  cache.clear();
  cachePromises.clear();
}

export function useFleetOptionCatalog(catalog: FleetOptionCatalogKey, admin = false): {
  rows: FleetOptionCatalogRow[];
  options: FleetOption[];
  values: string[];
  loading: boolean;
} {
  const [rows, setRows] = useState<FleetOptionCatalogRow[]>(cache.get(catalog) ?? []);
  const [loading, setLoading] = useState(!cache.has(catalog));

  useEffect(() => {
    if (!admin && cache.has(catalog)) {
      setRows(cache.get(catalog) ?? []);
      setLoading(false);
      return;
    }

    let mounted = true;
    const existingPromise = cachePromises.get(catalog);
    const load = existingPromise ?? fetchFleetOptionCatalog(catalog, admin);
    if (!existingPromise) cachePromises.set(catalog, load);

    void load
      .then((data) => {
        if (!mounted) return;
        if (!admin) cache.set(catalog, data);
        setRows(data);
      })
      .catch(() => {
        if (!mounted) return;
        setRows([]);
      })
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
        if (cachePromises.get(catalog) === load) cachePromises.delete(catalog);
      });

    return () => {
      mounted = false;
    };
  }, [catalog, admin]);

  const options = fleetOptionCatalogToOptions(rows, catalog);
  const values = fleetOptionCatalogValues(rows, catalog);

  return {
    rows,
    options: options.length ? options : fleetOptionCatalogDefaults(catalog),
    values: values.length ? values : fleetOptionCatalogDefaults(catalog).map((row) => row.value),
    loading,
  };
}
