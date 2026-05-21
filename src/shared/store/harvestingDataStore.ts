import { create } from "zustand";

import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import {
  filterActiveCountryRows,
  filterGrassesBySalesWindow,
  filterGrassesBySalesWindowsOr,
  grassRowsForHarvestGrassSelect,
  pickGrassCatalogRows,
  type PickGrassCatalogRowsArgs,
  normalizeFarmZoneRows,
  normalizeKeyAreaRows,
  type FarmZoneReferenceRow,
  type KeyAreaReferenceRow,
} from "@/shared/lib/harvestReferenceData";
import { stsProxyGetWithParams } from "@/shared/api/stsProxyClient";

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

const empty = {
  farmZones: [] as FarmZoneReferenceRow[],
  /** Key areas from admin `/api/keyareas` (id → title). */
  keyAreas: [] as KeyAreaReferenceRow[],
  farms: [] as unknown[],
  projects: [] as unknown[],
  staffs: [] as unknown[],
  countries: [] as unknown[],
  /** Active countries from `/api/countries?active_only=1` (selects / filters). */
  activeCountries: [] as unknown[],
  grasses: [] as unknown[],
  /** @deprecated Use `grasses`. */
  products: [] as unknown[],
  harvestListSearch: "",
  harvestListFarmFilter: "",
  harvestListProjectFilter: "",
  harvestListGrassFilter: "",
  harvestListStatusFilter: "",
};

export type HarvestingDataState = {
  /** Zone reference rows from `/api/zones`. */
  farmZones: FarmZoneReferenceRow[];
  keyAreas: KeyAreaReferenceRow[];
  farms: unknown[];
  projects: unknown[];
  staffs: unknown[];
  countries: unknown[];
  /** Active countries only (`active_only=1` on API) — use for create/edit/filter dropdowns. */
  activeCountries: unknown[];
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
  /** Harvest list: grass/product id; empty = all. */
  harvestListGrassFilter: string;
  /** Harvest list: status select; empty = all. */
  harvestListStatusFilter: string;
  setHarvestListSearch: (value: string) => void;
  setHarvestListFarmFilter: (value: string) => void;
  setHarvestListProjectFilter: (value: string) => void;
  setHarvestListGrassFilter: (value: string) => void;
  setHarvestListStatusFilter: (value: string) => void;
  setFarmZones: (farmZones: FarmZoneReferenceRow[]) => void;
  setKeyAreas: (keyAreas: KeyAreaReferenceRow[]) => void;
  setFarms: (farms: unknown[]) => void;
  setProjects: (projects: unknown[]) => void;
  setStaffs: (staffs: unknown[]) => void;
  setCountries: (countries: unknown[]) => void;
  setActiveCountries: (activeCountries: unknown[]) => void;
  setGrasses: (grasses: unknown[]) => void;
  /** @deprecated Use `setGrasses`. */
  setProducts: (products: unknown[]) => void;
  /** Loads farm zones, staffs, farms, projects, countries, products (parallel). */
  fetchAllHarvestingReferenceData: (force?: boolean) => Promise<void>;
  /** Grass rows visible for a single calendar day (`YYYY-MM-DD`), using `sales_from` / `sales_to`. */
  pickGrassesVisibleOnSalesDate: (refYmd: string) => unknown[];
  /** Grass rows visible if any of `refYmds` falls in range; empty refs → today (local). */
  pickGrassesVisibleOnAnySalesDate: (refYmds: string[]) => unknown[];
  /** Harvest form grass dropdown: OR on harvest date refs (else today); keeps `pinnedGrassId` if set. */
  pickGrassesForHarvestGrassSelect: (
    harvestRefYmds: string[],
    pinnedGrassId: string,
  ) => unknown[];
  /** Harvest list grass filter: full catalog + pinned ids (URL / multi-select). */
  pickGrassesVisibleOnSalesDateWithPins: (refYmd: string, pinnedGrassIds: string[]) => unknown[];
  /** Zone-config grass select: delegates to {@link pickGrassCatalogRows} `zone_config_dates`. */
  pickGrassesForZoneConfigSelectWithPins: (refYmd: string, pinnedGrassIds: string[]) => unknown[];
  /** Central grass catalog picker backed by store `grasses`. */
  pickGrassCatalogRowsFromStore: (
    args: Omit<PickGrassCatalogRowsArgs, "catalog">,
  ) => unknown[];
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
  setKeyAreas: (keyAreas) => set({ keyAreas }),
  setFarms: (farms) => set({ farms }),
  setProjects: (projects) => set({ projects }),
  setStaffs: (staffs) => set({ staffs }),
  setCountries: (countries) => set({ countries }),
  setActiveCountries: (activeCountries) => set({ activeCountries }),
  setGrasses: (grasses) => set({ grasses, products: grasses }),
  setProducts: (products) => set({ products, grasses: products }),

  setHarvestListSearch: (harvestListSearch) => set({ harvestListSearch }),
  setHarvestListFarmFilter: (harvestListFarmFilter) =>
    set({ harvestListFarmFilter }),
  setHarvestListProjectFilter: (harvestListProjectFilter) =>
    set({ harvestListProjectFilter }),
  setHarvestListGrassFilter: (harvestListGrassFilter) =>
    set({ harvestListGrassFilter }),
  setHarvestListStatusFilter: (harvestListStatusFilter) =>
    set({ harvestListStatusFilter }),

  pickGrassesVisibleOnSalesDate: (refYmd) =>
    filterGrassesBySalesWindow(get().grasses, refYmd),
  pickGrassesVisibleOnAnySalesDate: (refYmds) =>
    filterGrassesBySalesWindowsOr(get().grasses, refYmds),
  pickGrassesForHarvestGrassSelect: (harvestRefYmds, pinnedGrassId) =>
    grassRowsForHarvestGrassSelect(get().grasses, harvestRefYmds, pinnedGrassId),
  pickGrassesVisibleOnSalesDateWithPins: (_refYmd, pinnedGrassIds) =>
    pickGrassCatalogRows({
      catalog: get().grasses,
      mode: "all",
      refYmds: [],
      pinnedGrassIds,
    }),
  pickGrassesForZoneConfigSelectWithPins: (refYmd, pinnedGrassIds) =>
    pickGrassCatalogRows({
      catalog: get().grasses,
      mode: "zone_config_dates",
      refYmds: [refYmd],
      pinnedGrassIds,
    }),
  pickGrassCatalogRowsFromStore: (args) =>
    pickGrassCatalogRows({ ...args, catalog: get().grasses }),

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
    const refParams: Record<string, string | number | undefined> = {};
    if (typeof window !== "undefined") {
      const { getSessionUser } = await import("@/shared/store/authUserStore");
      const uid = getSessionUser()?.id;
      if (uid != null && Number.isFinite(Number(uid)) && Number(uid) > 0) {
        refParams.react_client_user_id = Number(uid);
      }
    }
    const entries = [
      ["farmZones", STS_API_PATHS.farmZones, undefined],
      ["keyAreas", STS_API_PATHS.keyareas, undefined],
      ["staffs", STS_API_PATHS.staffs, undefined],
      ["farms", STS_API_PATHS.farms, undefined],
      ["projects", STS_API_PATHS.projects, undefined],
      ["countries", STS_API_PATHS.countries, undefined],
      ["activeCountries", STS_API_PATHS.countries, { active_only: 1 }],
      ["grasses", STS_API_PATHS.grasses, undefined],
      ["products", STS_API_PATHS.products, undefined],
    ] as const;
    const settled = await Promise.allSettled(
      entries.map(([, path, extra]) =>
        stsProxyGetWithParams(path, { ...refParams, ...extra }),
      ),
    );
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
    const keyAreasRaw = byKey.get("keyAreas");
    const staffs = byKey.get("staffs");
    const farms = byKey.get("farms");
    const projects = byKey.get("projects");
    const countries = byKey.get("countries");
    const activeCountriesRaw = byKey.get("activeCountries");
    const grassesRaw = byKey.get("grasses");
    const products = byKey.get("products");
    const grassesArr = grassesRaw !== undefined ? asArray(grassesRaw) : [];
    const productsArr = asArray(products);
    const countriesArr = asArray(countries);
    const activeCountriesArr =
      activeCountriesRaw !== undefined
        ? asArray(activeCountriesRaw)
        : filterActiveCountryRows(countriesArr);

    set({
      farmZones: normalizeFarmZoneRows(farmZones),
      keyAreas: normalizeKeyAreaRows(keyAreasRaw),
      staffs: asArray(staffs),
      farms: asArray(farms),
      projects: asArray(projects),
      countries: countriesArr,
      activeCountries: activeCountriesArr,
      /** `sts_grasses` via `/api/grasses`; fall back to `/api/items` if grasses request failed or returned nothing. */
      grasses: grassesArr.length > 0 ? grassesArr : productsArr,
      products: productsArr,
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
