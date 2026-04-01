import { create } from "zustand";

import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import { stsProxyGet } from "@/shared/api/stsProxyClient";

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** API returns a zone key → label map (not an array). */
function normalizeFarmZonesPayload(v: unknown): unknown {
  if (v === null || v === undefined) return {};
  if (Array.isArray(v)) return v;
  if (typeof v === "object") return v;
  return {};
}

const empty = {
  farmZones: {} as unknown,
  farms: [] as unknown[],
  projects: [] as unknown[],
  staffs: [] as unknown[],
  countries: [] as unknown[],
  products: [] as unknown[],
  harvestListSearch: "",
  harvestListFarmFilter: "",
  harvestListProjectFilter: "",
  harvestListStatusFilter: "",
};

export type HarvestingDataState = {
  /** Zone key → label map from `react_get_farm_zones`, or legacy array. */
  farmZones: unknown;
  farms: unknown[];
  projects: unknown[];
  staffs: unknown[];
  countries: unknown[];
  products: unknown[];
  loading: boolean;
  error: string | null;
  /** True after first successful bootstrap (skip duplicate fetches). */
  bootstrapDone: boolean;
  /** Harvest list `/harvest`: search box (project, farm, grass, zone, status). */
  harvestListSearch: string;
  /** Harvest list: farm select; empty = all. */
  harvestListFarmFilter: string;
  /** Harvest list: project select; empty = all. */
  harvestListProjectFilter: string;
  /** Harvest list: status select; empty = all. */
  harvestListStatusFilter: string;
  setHarvestListSearch: (value: string) => void;
  setHarvestListFarmFilter: (value: string) => void;
  setHarvestListProjectFilter: (value: string) => void;
  setHarvestListStatusFilter: (value: string) => void;
  setFarmZones: (farmZones: unknown) => void;
  setFarms: (farms: unknown[]) => void;
  setProjects: (projects: unknown[]) => void;
  setStaffs: (staffs: unknown[]) => void;
  setCountries: (countries: unknown[]) => void;
  setProducts: (products: unknown[]) => void;
  /** Loads farm zones, staffs, farms, projects, countries, products (parallel). */
  fetchAllHarvestingReferenceData: (force?: boolean) => Promise<void>;
  /** Merge or append one project (e.g. from `react_update_parent_item` response) by `id`. */
  upsertProjectInList: (project: unknown) => void;
  reset: () => void;
};

export const useHarvestingDataStore = create<HarvestingDataState>((set, get) => ({
  ...empty,
  loading: false,
  error: null,
  bootstrapDone: false,

  setFarmZones: (farmZones) => set({ farmZones }),
  setFarms: (farms) => set({ farms }),
  setProjects: (projects) => set({ projects }),
  setStaffs: (staffs) => set({ staffs }),
  setCountries: (countries) => set({ countries }),
  setProducts: (products) => set({ products }),

  setHarvestListSearch: (harvestListSearch) => set({ harvestListSearch }),
  setHarvestListFarmFilter: (harvestListFarmFilter) =>
    set({ harvestListFarmFilter }),
  setHarvestListProjectFilter: (harvestListProjectFilter) =>
    set({ harvestListProjectFilter }),
  setHarvestListStatusFilter: (harvestListStatusFilter) =>
    set({ harvestListStatusFilter }),

  upsertProjectInList: (project) => {
    const p = project as Record<string, unknown>;
    const id = String(p?.id ?? "").trim();
    if (!id) return;
    const prev = get().projects;
    const next = [...prev];
    const idx = next.findIndex((x) => {
      if (!x || typeof x !== "object") return false;
      const row = x as Record<string, unknown>;
      return String(row.id ?? "").trim() === id;
    });
    if (idx >= 0) {
      const cur = next[idx];
      next[idx] =
        cur && typeof cur === "object"
          ? { ...(cur as Record<string, unknown>), ...p }
          : project;
    } else {
      next.push(project);
    }
    set({ projects: next });
  },

  fetchAllHarvestingReferenceData: async (force = false) => {
    if (!force && get().bootstrapDone) return;
    set({ loading: true, error: null });
    try {
      const [
        farmZones,
        staffs,
        farms,
        projects,
        countries,
        products,
      ] = await Promise.all([
        stsProxyGet(STS_API_PATHS.farmZones),
        stsProxyGet(STS_API_PATHS.staffs),
        stsProxyGet(STS_API_PATHS.farms),
        stsProxyGet(STS_API_PATHS.projects),
        stsProxyGet(STS_API_PATHS.countries),
        stsProxyGet(STS_API_PATHS.products),
      ]);

      set({
        farmZones: normalizeFarmZonesPayload(farmZones),
        staffs: asArray(staffs),
        farms: asArray(farms),
        projects: asArray(projects),
        countries: asArray(countries),
        products: asArray(products),
        loading: false,
        error: null,
        bootstrapDone: true,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load reference data";
      set({ loading: false, error: msg });
    }
  },

  reset: () =>
    set({
      ...empty,
      loading: false,
      error: null,
      bootstrapDone: false,
    }),
}));
