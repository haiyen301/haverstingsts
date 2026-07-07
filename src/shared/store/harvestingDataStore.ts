import { create } from "zustand";
import {
  persist,
  createJSONStorage,
  type StateStorage,
} from "zustand/middleware";

import type { RegrowthRuleRow, ZoneConfigurationRow } from "@/features/admin/api/adminApi";
import { filterActiveZoneConfigurations } from "@/features/forecasting/forecastActiveRecords";
import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import {
  filterActiveCountryRows,
  filterGrassesBySalesWindow,
  filterGrassesBySalesWindowsOr,
  findProjectRowBySelectId,
  grassRowsForHarvestGrassSelect,
  pickGrassCatalogRows,
  type PickGrassCatalogRowsArgs,
  normalizeFarmZoneRows,
  normalizeKeyAreaRows,
  type FarmZoneReferenceRow,
  type KeyAreaReferenceRow,
} from "@/shared/lib/harvestReferenceData";
import { canViewAllModuleData } from "@/shared/auth/permissions";
import { stsProxyGetWithParams, stsProxyGetWithParamsOptional } from "@/shared/api/stsProxyClient";

export const HARVESTING_REFERENCE_PERSIST_KEY = "sts-harvesting-reference-v2";

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

/** Shared in-flight bootstrap — concurrent callers await one request batch. */
let referenceBootstrapPromise: Promise<void> | null = null;

function upsertProjectInArray(prev: unknown[], project: unknown): unknown[] {
  const p = project as Record<string, unknown>;
  const id = String(p?.id ?? "").trim();
  if (!id) return prev;
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
  return next;
}

const empty = {
  farmZones: [] as FarmZoneReferenceRow[],
  /** Zone configuration rows (`farm_id` + `grass_id`) from `/api/zone_configurations`. */
  zoneConfigurations: [] as ZoneConfigurationRow[],
  /** Key areas from admin `/api/keyareas` (id → title). */
  keyAreas: [] as KeyAreaReferenceRow[],
  /** Regrowth rule rows from `/api/regrowth_rules`. */
  regrowthRules: [] as RegrowthRuleRow[],
  farms: [] as unknown[],
  /** Project catalog for forms/export — full list only when user has view-all on projects. */
  allProjects: [] as unknown[],
  /** Projects visible for the current user role (farm / plan / creator scope). */
  roleVisibleProjects: [] as unknown[],
  /**
   * @deprecated Use `roleVisibleProjects` for scoped lists or `allProjects` for full catalog.
   * Kept for existing screens that still read `projects`.
   */
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
  referenceUserId: null as number | null,
};

export type HarvestingDataState = {
  /** Zone reference rows from `/api/zones`. */
  farmZones: FarmZoneReferenceRow[];
  /** Zone setup rows linking farms to grasses (`/api/zone_configurations`). */
  zoneConfigurations: ZoneConfigurationRow[];
  keyAreas: KeyAreaReferenceRow[];
  regrowthRules: RegrowthRuleRow[];
  farms: unknown[];
  /** Project catalog (`react_get_all_projects` when view-all, else role-scoped `/api/projects`). */
  allProjects: unknown[];
  /** Role-scoped projects (`GET /api/projects` → `filterVisibleProjectsForUser`). */
  roleVisibleProjects: unknown[];
  /** @deprecated Alias of `roleVisibleProjects`. */
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
  /** Session user id when reference rows were cached — cleared on logout / user switch. */
  referenceUserId: number | null;
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
  setZoneConfigurations: (zoneConfigurations: ZoneConfigurationRow[]) => void;
  setKeyAreas: (keyAreas: KeyAreaReferenceRow[]) => void;
  setRegrowthRules: (regrowthRules: RegrowthRuleRow[]) => void;
  setFarms: (farms: unknown[]) => void;
  setAllProjects: (allProjects: unknown[]) => void;
  setRoleVisibleProjects: (roleVisibleProjects: unknown[]) => void;
  /** @deprecated Use `setRoleVisibleProjects`. */
  setProjects: (projects: unknown[]) => void;
  setStaffs: (staffs: unknown[]) => void;
  setCountries: (countries: unknown[]) => void;
  setActiveCountries: (activeCountries: unknown[]) => void;
  setGrasses: (grasses: unknown[]) => void;
  /** @deprecated Use `setGrasses`. */
  setProducts: (products: unknown[]) => void;
  /** True when `projectId` is in the role-scoped project list. */
  isProjectRoleVisible: (projectId: string) => boolean;
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

const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

function getHarvestingPersistStorage(): StateStorage {
  if (typeof window === "undefined") return noopStorage;
  try {
    return window.sessionStorage;
  } catch {
    return noopStorage;
  }
}

/** Catalog is usable for forecast/inventory when bootstrap finished and core rows exist. */
export function hasHarvestReferenceCatalog(
  state: Pick<HarvestingDataState, "bootstrapDone" | "farms" | "grasses">,
): boolean {
  return state.bootstrapDone && state.farms.length > 0 && state.grasses.length > 0;
}

type PersistedHarvestReferenceSlice = Pick<
  HarvestingDataState,
  | "farmZones"
  | "zoneConfigurations"
  | "keyAreas"
  | "regrowthRules"
  | "farms"
  | "allProjects"
  | "roleVisibleProjects"
  | "projects"
  | "staffs"
  | "countries"
  | "activeCountries"
  | "grasses"
  | "products"
  | "bootstrapDone"
  | "referenceUserId"
>;

export const useHarvestingDataStore = create<HarvestingDataState>()(
  persist(
    (set, get) => ({
  ...empty,
  loading: false,
  error: null,
  bootstrapDone: false,
  referenceUserId: null,

  setFarmZones: (farmZones) => set({ farmZones }),
  setZoneConfigurations: (zoneConfigurations) => set({ zoneConfigurations }),
  setKeyAreas: (keyAreas) => set({ keyAreas }),
  setRegrowthRules: (regrowthRules) => set({ regrowthRules }),
  setFarms: (farms) => set({ farms }),
  setAllProjects: (allProjects) => set({ allProjects }),
  setRoleVisibleProjects: (roleVisibleProjects) =>
    set({ roleVisibleProjects, projects: roleVisibleProjects }),
  setProjects: (projects) => set({ projects, roleVisibleProjects: projects }),
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

  isProjectRoleVisible: (projectId) => {
    const normalized = projectId.trim();
    if (!normalized) return false;
    return Boolean(findProjectRowBySelectId(get().roleVisibleProjects, normalized));
  },

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
    const allProjects = upsertProjectInArray(get().allProjects, project);
    const p = project as Record<string, unknown>;
    const id = String(p?.id ?? "").trim();
    const prevRoleVisible = get().roleVisibleProjects;
    const roleIdx = prevRoleVisible.findIndex((x) => {
      if (!x || typeof x !== "object") return false;
      const row = x as Record<string, unknown>;
      return String(row.id ?? "").trim() === id;
    });
    const roleVisibleProjects =
      roleIdx >= 0 ? upsertProjectInArray(prevRoleVisible, project) : prevRoleVisible;
    set({
      allProjects,
      roleVisibleProjects,
      projects: roleVisibleProjects,
    });
  },

  fetchAllHarvestingReferenceData: async (force = false) => {
    if (!force && get().bootstrapDone) return;

    if (referenceBootstrapPromise) {
      await referenceBootstrapPromise;
      if (!force && get().bootstrapDone) return;
      if (!force) return;
    }

    if (!force && get().bootstrapDone) return;

    const run = async () => {
      set({ loading: true, error: null });
      const refParams: Record<string, string | number | undefined> = {};
      let sessionUser: Awaited<
        ReturnType<(typeof import("@/shared/store/authUserStore"))["getSessionUser"]>
      > = null;
      if (typeof window !== "undefined") {
        const { getSessionUser } = await import("@/shared/store/authUserStore");
        sessionUser = getSessionUser();
        const uid = sessionUser?.id;
        if (uid != null && Number.isFinite(Number(uid)) && Number(uid) > 0) {
          refParams.react_client_user_id = Number(uid);
        }
      }
      const canViewAllProjects = canViewAllModuleData(sessionUser, "projects");
      const entries = [
        ["farmZones", STS_API_PATHS.farmZones, undefined],
        ["zoneConfigurations", STS_API_PATHS.zoneConfigurations, { scope_module: "harvests" }],
        ["keyAreas", STS_API_PATHS.keyareas, undefined],
        ["staffs", STS_API_PATHS.staffs, undefined],
        ["farms", STS_API_PATHS.farms, undefined],
        ["roleVisibleProjects", STS_API_PATHS.projects, undefined],
        ["countries", STS_API_PATHS.countries, undefined],
        ["activeCountries", STS_API_PATHS.countries, { active_only: 1 }],
        ["grasses", STS_API_PATHS.grasses, undefined],
        ["products", STS_API_PATHS.products, undefined],
        ["regrowthRules", STS_API_PATHS.regrowthRules, undefined],
      ] as const;
      const settled = await Promise.allSettled([
        ...entries.map(([, path, extra]) =>
          stsProxyGetWithParams(path, { ...refParams, ...extra }),
        ),
        ...(canViewAllProjects
          ? [stsProxyGetWithParamsOptional(STS_API_PATHS.projectsAll, refParams)]
          : []),
      ]);
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
      if (canViewAllProjects) {
        const allProjectsRs = settled[entries.length];
        if (allProjectsRs?.status === "fulfilled" && allProjectsRs.value != null) {
          byKey.set("allProjects", allProjectsRs.value);
        } else if (allProjectsRs?.status === "rejected") {
          const msg =
            allProjectsRs.reason instanceof Error
              ? allProjectsRs.reason.message
              : String(allProjectsRs.reason);
          errors.push(`allProjects: ${msg}`);
        }
      }

      const farmZones = byKey.get("farmZones");
      const zoneConfigurationsRaw = byKey.get("zoneConfigurations");
      const keyAreasRaw = byKey.get("keyAreas");
      const staffs = byKey.get("staffs");
      const farms = byKey.get("farms");
      const allProjects = byKey.get("allProjects");
      const roleVisibleProjects = byKey.get("roleVisibleProjects");
      const countries = byKey.get("countries");
      const activeCountriesRaw = byKey.get("activeCountries");
      const grassesRaw = byKey.get("grasses");
      const products = byKey.get("products");
      const regrowthRulesRaw = byKey.get("regrowthRules");
      const grassesArr = grassesRaw !== undefined ? asArray(grassesRaw) : [];
      const productsArr = asArray(products);
      const countriesArr = asArray(countries);
      const activeCountriesArr =
        activeCountriesRaw !== undefined
          ? asArray(activeCountriesRaw)
          : filterActiveCountryRows(countriesArr);
      const roleVisibleProjectsArr = asArray(roleVisibleProjects);
      const allProjectsArr = canViewAllProjects ? asArray(allProjects) : [];
      const resolvedAllProjects =
        canViewAllProjects && allProjectsArr.length > 0
          ? allProjectsArr
          : roleVisibleProjectsArr;
      const referenceUserId =
        refParams.react_client_user_id != null &&
        Number.isFinite(Number(refParams.react_client_user_id))
          ? Number(refParams.react_client_user_id)
          : null;

      set({
        farmZones: normalizeFarmZoneRows(farmZones),
        zoneConfigurations: filterActiveZoneConfigurations(
          asArray(zoneConfigurationsRaw) as ZoneConfigurationRow[],
        ),
        keyAreas: normalizeKeyAreaRows(keyAreasRaw),
        staffs: asArray(staffs),
        farms: asArray(farms),
        allProjects: resolvedAllProjects,
        roleVisibleProjects: roleVisibleProjectsArr,
        projects: roleVisibleProjectsArr,
        countries: countriesArr,
        activeCountries: activeCountriesArr,
        /** `sts_grasses` via `/api/grasses`; fall back to `/api/items` if grasses request failed or returned nothing. */
        grasses: grassesArr.length > 0 ? grassesArr : productsArr,
        products: productsArr,
        regrowthRules: asArray(regrowthRulesRaw) as RegrowthRuleRow[],
        loading: false,
        error: errors.length ? `Reference partial load: ${errors.join(" | ")}` : null,
        bootstrapDone: true,
        referenceUserId,
      });
    };

    referenceBootstrapPromise = run();
    try {
      await referenceBootstrapPromise;
    } finally {
      referenceBootstrapPromise = null;
    }
  },

  reset: () => {
    referenceBootstrapPromise = null;
    set({
      ...empty,
      loading: false,
      error: null,
      bootstrapDone: false,
      referenceUserId: null,
    });
    void useHarvestingDataStore.persist.clearStorage();
  },
    }),
    {
      name: HARVESTING_REFERENCE_PERSIST_KEY,
      storage: createJSONStorage(getHarvestingPersistStorage),
      partialize: (state): PersistedHarvestReferenceSlice => ({
        farmZones: state.farmZones,
        zoneConfigurations: state.zoneConfigurations,
        keyAreas: state.keyAreas,
        regrowthRules: state.regrowthRules,
        farms: state.farms,
        allProjects: state.allProjects,
        roleVisibleProjects: state.roleVisibleProjects,
        projects: state.projects,
        staffs: state.staffs,
        countries: state.countries,
        activeCountries: state.activeCountries,
        grasses: state.grasses,
        products: state.products,
        bootstrapDone: state.bootstrapDone,
        referenceUserId: state.referenceUserId,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        void (async () => {
          const { getSessionUser } = await import("@/shared/store/authUserStore");
          const uid = getSessionUser()?.id;
          const cachedFor = state.referenceUserId;
          if (
            cachedFor != null &&
            uid != null &&
            Number.isFinite(Number(uid)) &&
            Number(uid) !== cachedFor
          ) {
            useHarvestingDataStore.getState().reset();
          }
        })();
      },
    },
  ),
);
