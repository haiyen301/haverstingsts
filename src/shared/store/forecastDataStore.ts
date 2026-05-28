import { create } from "zustand";

import type { ZoneConfigurationRow } from "@/features/admin/api/adminApi";
import type { ForecastHarvestRow } from "@/features/forecasting/forecastingTypes";
import type { RegrowthReferenceConfig } from "@/features/forecasting/forecastingRegrowth";

export type ForecastCacheScope =
  | "overrides"
  | "harvest"
  | "zones"
  | "rules"
  | "reference"
  | "all";

export const FORECAST_DATA_SCOPES: ForecastCacheScope[] = [
  "overrides",
  "harvest",
  "zones",
  "rules",
];

export const FORECAST_CACHE_TTL_MS = 5 * 60 * 1000;

type FetchedAtMap = Partial<Record<ForecastCacheScope, number>>;

export type ForecastDataState = {
  generation: number;
  harvestRowsRaw: Record<string, unknown>[] | null;
  harvestError: string | null;
  forecastRows: ForecastHarvestRow[] | null;
  zoneConfigs: ZoneConfigurationRow[] | null;
  regrowthConfig: RegrowthReferenceConfig | null;
  harvestDateFrom: string | null;
  harvestDateTo: string | null;
  fetchedAt: FetchedAtMap;
  invalidated: ForecastCacheScope[];
  isLoading: boolean;
  isRefreshing: boolean;
  isRecomputing: boolean;
  hasSnapshot: boolean;
  error: string | null;
  invalidate: (scope: ForecastCacheScope) => void;
  markValid: (scope: ForecastCacheScope) => void;
  needsFetch: (scope: ForecastCacheScope, force?: boolean) => boolean;
  isFresh: (scope: ForecastCacheScope) => boolean;
  scopesNeedingFetch: (scopes: Set<ForecastCacheScope>, force?: boolean) => Set<ForecastCacheScope>;
  setLoadState: (
    patch: Partial<
      Pick<
        ForecastDataState,
        "isLoading" | "isRefreshing" | "isRecomputing" | "error" | "hasSnapshot"
      >
    >,
  ) => void;
  setHarvestData: (patch: {
    harvestRowsRaw: Record<string, unknown>[];
    harvestError: string | null;
    forecastRows: ForecastHarvestRow[];
    harvestDateFrom: string;
    harvestDateTo: string;
  }) => void;
  setZoneConfigs: (zoneConfigs: ZoneConfigurationRow[]) => void;
  setRegrowthConfig: (regrowthConfig: RegrowthReferenceConfig) => void;
  reset: () => void;
};

const INITIAL_INVALIDATED: ForecastCacheScope[] = [
  "overrides",
  "harvest",
  "zones",
  "rules",
  "reference",
];

function isScopeInvalidated(invalidated: ForecastCacheScope[], scope: ForecastCacheScope): boolean {
  return invalidated.includes(scope);
}

function hasHarvestData(state: ForecastDataState): boolean {
  return state.harvestRowsRaw != null && !isScopeInvalidated(state.invalidated, "harvest");
}

function hasCoreData(state: ForecastDataState): boolean {
  return (
    hasHarvestData(state) &&
    state.zoneConfigs != null &&
    state.regrowthConfig != null &&
    !isScopeInvalidated(state.invalidated, "zones") &&
    !isScopeInvalidated(state.invalidated, "rules")
  );
}

export const useForecastDataStore = create<ForecastDataState>((set, get) => ({
  generation: 0,
  harvestRowsRaw: null,
  harvestError: null,
  forecastRows: null,
  zoneConfigs: null,
  regrowthConfig: null,
  harvestDateFrom: null,
  harvestDateTo: null,
  fetchedAt: {},
  invalidated: [...INITIAL_INVALIDATED],
  isLoading: false,
  isRefreshing: false,
  isRecomputing: false,
  hasSnapshot: false,
  error: null,

  invalidate: (scope) => {
    set((state) => {
      const nextGen = state.generation + 1;
      if (scope === "all") {
        return {
          generation: nextGen,
          invalidated: [...INITIAL_INVALIDATED],
          harvestRowsRaw: null,
          harvestError: null,
          forecastRows: null,
          zoneConfigs: null,
          regrowthConfig: null,
          harvestDateFrom: null,
          harvestDateTo: null,
          fetchedAt: {},
          hasSnapshot: false,
        };
      }

      const invalidated = state.invalidated.includes(scope)
        ? state.invalidated
        : [...state.invalidated, scope];

      const patch: Partial<ForecastDataState> = {
        generation: nextGen,
        invalidated,
      };

      switch (scope) {
        case "harvest":
          patch.harvestRowsRaw = null;
          patch.harvestError = null;
          patch.forecastRows = null;
          patch.harvestDateFrom = null;
          patch.harvestDateTo = null;
          patch.hasSnapshot = false;
          break;
        case "zones":
          patch.zoneConfigs = null;
          patch.forecastRows = null;
          patch.hasSnapshot = false;
          break;
        case "rules":
          patch.regrowthConfig = null;
          break;
        case "reference":
          break;
        default:
          break;
      }

      return patch;
    });
  },

  markValid: (scope) => {
    const now = Date.now();
    set((state) => {
      if (scope === "all") {
        const cleared = state.invalidated.filter(
          (s) => s === "reference" ? false : !FORECAST_DATA_SCOPES.includes(s),
        );
        return {
          invalidated: cleared.filter((s) => s !== "reference"),
          fetchedAt: {
            ...state.fetchedAt,
            overrides: now,
            harvest: now,
            zones: now,
            rules: now,
            reference: now,
          },
          hasSnapshot: hasCoreData({ ...state, invalidated: cleared }),
        };
      }

      const invalidated = state.invalidated.filter((s) => s !== scope);
      const next: Partial<ForecastDataState> = {
        invalidated,
        fetchedAt: { ...state.fetchedAt, [scope]: now },
      };
      const merged = { ...get(), ...next, invalidated };
      next.hasSnapshot = hasCoreData(merged as ForecastDataState);
      return next;
    });
  },

  needsFetch: (scope, force = false) => {
    if (force) return true;
    const state = get();
    if (isScopeInvalidated(state.invalidated, scope)) return true;
    return !state.isFresh(scope);
  },

  isFresh: (scope) => {
    const state = get();
    if (scope === "all") {
      return FORECAST_DATA_SCOPES.every((s) => state.isFresh(s));
    }
    const fetchedAt = state.fetchedAt[scope];
    if (fetchedAt == null) return false;
    return Date.now() - fetchedAt < FORECAST_CACHE_TTL_MS;
  },

  scopesNeedingFetch: (scopes, force = false) => {
    const state = get();
    const out = new Set<ForecastCacheScope>();
    for (const scope of scopes) {
      if (scope === "all") {
        for (const s of FORECAST_DATA_SCOPES) {
          if (state.needsFetch(s, force)) out.add(s);
        }
        if (state.needsFetch("reference", force)) out.add("reference");
        continue;
      }
      if (state.needsFetch(scope, force)) out.add(scope);
    }
    return out;
  },

  setLoadState: (patch) => set(patch),

  setHarvestData: (patch) => {
    set((state) => ({
      ...patch,
      hasSnapshot:
        patch.forecastRows != null &&
        state.zoneConfigs != null &&
        state.regrowthConfig != null &&
        !state.invalidated.includes("harvest"),
    }));
  },

  setZoneConfigs: (zoneConfigs) => {
    set((state) => ({
      zoneConfigs,
      hasSnapshot:
        state.forecastRows != null &&
        state.forecastRows.length >= 0 &&
        state.regrowthConfig != null,
    }));
  },

  setRegrowthConfig: (regrowthConfig) => {
    set((state) => ({
      regrowthConfig,
      hasSnapshot:
        state.forecastRows != null && state.zoneConfigs != null,
    }));
  },

  reset: () =>
    set({
      generation: 0,
      harvestRowsRaw: null,
      harvestError: null,
      forecastRows: null,
      zoneConfigs: null,
      regrowthConfig: null,
      harvestDateFrom: null,
      harvestDateTo: null,
      fetchedAt: {},
      invalidated: [...INITIAL_INVALIDATED],
      isLoading: false,
      isRefreshing: false,
      isRecomputing: false,
      hasSnapshot: false,
      error: null,
    }),
}));

export function forecastStoreHasCoreData(): boolean {
  return hasCoreData(useForecastDataStore.getState());
}
