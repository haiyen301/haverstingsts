import { create } from "zustand";

import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import { stsProxyGet } from "@/shared/api/stsProxyClient";

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (!v || typeof v !== "object") return [];
  const obj = v as Record<string, unknown>;
  const candidates = [
    obj.data,
    obj.rows,
    obj.items,
    obj.results,
    obj.result,
    obj.list,
    obj.payload,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  // Some endpoints may wrap arrays deeper (e.g. { data: { rows: [] } }).
  const dataObj = obj.data;
  if (dataObj && typeof dataObj === "object") {
    const nested = dataObj as Record<string, unknown>;
    const nestedCandidates = [nested.rows, nested.items, nested.results, nested.list];
    for (const c of nestedCandidates) {
      if (Array.isArray(c)) return c;
    }
  }
  return [];
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
  grasses: [] as unknown[],
  /** @deprecated Use `grasses`. */
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
  grasses: unknown[];
  /** @deprecated Use `grasses`. */
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
  setGrasses: (grasses: unknown[]) => void;
  /** @deprecated Use `setGrasses`. */
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
  setGrasses: (grasses) => set({ grasses, products: grasses }),
  setProducts: (products) => set({ products, grasses: products }),

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
    const entries = [
      ["farmZones", STS_API_PATHS.farmZones],
      ["staffs", STS_API_PATHS.staffs],
      ["farms", STS_API_PATHS.farms],
      ["projects", STS_API_PATHS.projects],
      ["countries", STS_API_PATHS.countries],
      ["products", STS_API_PATHS.products],
    ] as const;
    const settled = await Promise.allSettled(entries.map(([, path]) => stsProxyGet(path)));
    const byKey = new Map<string, unknown>();
    const errors: string[] = [];
    entries.forEach(([key], idx) => {
      const rs = settled[idx];
      if (rs.status === "fulfilled") {
        byKey.set(key, rs.value);
      } else {
        const msg = rs.reason instanceof Error ? rs.reason.message : String(rs.reason);
        errors.push(`${key}: ${msg}`);
      }
    });

    const farmZones = byKey.get("farmZones");
    const staffs = byKey.get("staffs");
    const farms = byKey.get("farms");
    const projects = byKey.get("projects");
    const countries = byKey.get("countries");
    const products = byKey.get("products");

    set({
      farmZones: normalizeFarmZonesPayload(farmZones),
      staffs: asArray(staffs),
      farms: asArray(farms),
      projects: asArray(projects),
      countries: asArray(countries),
      grasses: asArray(products),
      products: asArray(products),
      loading: false,
      error: errors.length ? `Reference partial load: ${errors.join(" | ")}` : null,
      bootstrapDone: true,
    });
  },

  reset: () =>
    set({
      ...empty,
      loading: false,
      error: null,
      bootstrapDone: false,
    }),
}));
