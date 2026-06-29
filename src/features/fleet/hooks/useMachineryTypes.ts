"use client";

import { useEffect, useState } from "react";

import {
  DEFAULT_MACHINERY_TYPES,
  fetchMachineryTypes,
  machineryTypeLabels,
  type MachineryTypeRow,
} from "@/features/fleet/api/machineryTypesApi";

let cachedTypes: MachineryTypeRow[] | null = null;
let cachePromise: Promise<MachineryTypeRow[]> | null = null;

export function useMachineryTypes(admin = false): {
  types: string[];
  rows: MachineryTypeRow[];
  loading: boolean;
} {
  const [rows, setRows] = useState<MachineryTypeRow[]>(cachedTypes ?? []);
  const [loading, setLoading] = useState(!cachedTypes);

  useEffect(() => {
    if (!admin && cachedTypes) {
      setRows(cachedTypes);
      setLoading(false);
      return;
    }

    let mounted = true;
    const load = cachePromise ?? fetchMachineryTypes(admin);
    if (!cachePromise) cachePromise = load;

    void load
      .then((data) => {
        if (!mounted) return;
        if (!admin) cachedTypes = data;
        setRows(data);
      })
      .catch(() => {
        if (!mounted) return;
        setRows([]);
      })
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
        if (cachePromise === load) cachePromise = null;
      });

    return () => {
      mounted = false;
    };
  }, [admin]);

  const types = machineryTypeLabels(rows);
  return {
    types: types.length ? types : [...DEFAULT_MACHINERY_TYPES],
    rows,
    loading,
  };
}

export function clearMachineryTypesCache(): void {
  cachedTypes = null;
  cachePromise = null;
}
