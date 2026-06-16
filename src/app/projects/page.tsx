"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { AlignLeft, ArrowDown, Download, FolderOpen, Loader2, Plus, Search, Upload } from "lucide-react";

import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import RequireAuth from "@/features/auth/RequireAuth";
import { canAccessModule } from "@/shared/auth/permissions";
import { useSyncedFarmMultiSelect } from "@/shared/hooks/useSyncedFarmMultiSelect";
import { useAuthUserStore } from "@/shared/store/authUserStore";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { MultiSelect } from "@/shared/ui/multi-select";
import {
  fetchMondayProjectRowsFromServer,
  type MondayDynamicRowLike,
  type MondayProjectListQuery,
  type MondayProjectServerRow,
} from "@/entities/projects";
import {
  ProjectListItem,
  buildMondayEditArgs,
  fetchHarvestPlanIndexRowsForProjects,
  mergeHarvestPlanRows,
  mergeMondayDisplayData,
  mergeProjectSubitemsWithHarvestPlan,
} from "@/features/project";
import { resolveStaffAvatarImageUrl } from "@/features/project/lib/staffAvatarUrl";
import { cn } from "@/lib/utils";
import { bgSurfaceFilter } from "@/shared/lib/surfaceFilter";
import { useGrassFilterByFarm } from "@/shared/hooks/useGrassFilterByFarm";
import { mapRowsToSelectOptions } from "@/shared/lib/harvestReferenceData";
import { ProjectListExportDialog } from "@/features/project/ui/ProjectListExportDialog";
import { type ProjectListExportFilter } from "@/features/project/lib/projectListExport";

function parseCsvParam(v: string | null): string[] {
  return String(v ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

/** URL token meaning “no status filter” (all statuses). */
const STATUS_FILTER_URL_ALL = "all";

const DEFAULT_STATUS_FILTER_VALUES = ["Ongoing", "Future"] as const;

function serializeStatusFilterToUrl(values: string[]): string {
  if (values.length === 0) return STATUS_FILTER_URL_ALL;
  return values.join(",");
}

/**
 * - No `status` in URL → default Ongoing + Future (first visit).
 * - `status=all` → all statuses (no server filter); MultiSelect shows placeholder.
 * - `status=Done` / `status=Ongoing,Future` → explicit selection.
 */
function parseStatusFilterFromUrl(raw: string | null): string[] {
  if (raw === null) return [...DEFAULT_STATUS_FILTER_VALUES];
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.toLowerCase() === STATUS_FILTER_URL_ALL) {
    return [];
  }
  return parseCsvParam(raw);
}

function urlSearchParamsEquivalent(builtQs: string, currentQs: string): boolean {
  const a = new URLSearchParams(builtQs);
  const b = new URLSearchParams(currentQs);
  const keys = new Set([...a.keys(), ...b.keys()]);
  for (const k of keys) {
    if ((a.get(k) ?? "") !== (b.get(k) ?? "")) return false;
  }
  return true;
}

function formatNumber(v: number): string {
  return new Intl.NumberFormat().format(Math.max(0, Math.floor(v)));
}

function toRecArray(rows: unknown[]): Record<string, unknown>[] {
  return rows.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
}

function normalizeProjectStatusLabel(v: unknown): string {
  const s = String(v ?? "").toLowerCase().trim();
  if (!s) return "";
  if (s.includes("done") || s.includes("complete")) return "Done";
  if (s.includes("future")) return "Future";
  if (s.includes("warning")) return "Warning";
  if (s.includes("ongoing")) return "Ongoing";
  return "";
}

function normalizeDynamicFieldName(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function normalizeDynamicFieldValue(v: unknown): string {
  return String(v ?? "").trim();
}

function makeRowTableKey(row: Record<string, unknown>): string {
  const rowId = String(row.row_id ?? row.id_row ?? row.id ?? "").trim();
  const tableId = String(row.table_id ?? row.table ?? "").trim();
  return `${rowId}__${tableId}`;
}

const PROJECT_LIST_PAGE_SIZE = 20;

const PROJECT_CARD_STATUS_FILTERS = [
  "Ongoing",
  "Future",
  "Done",
  "Warning",
] as const;

function isAllProjectStatusesSelected(values: string[]): boolean {
  if (values.length === 0) return true;
  const picked = new Set(
    values.map((x) => normalizeProjectStatusLabel(x)).filter(Boolean),
  );
  return PROJECT_CARD_STATUS_FILTERS.every((s) => picked.has(s));
}

function mondayRowDedupeKey(row: MondayProjectServerRow): string {
  return makeRowTableKey(row as unknown as Record<string, unknown>);
}

function mergeMondayRowsUnique(
  prev: MondayProjectServerRow[],
  more: MondayProjectServerRow[],
): MondayProjectServerRow[] {
  const keys = new Set(prev.map((x) => mondayRowDedupeKey(x)));
  const out = [...prev];
  for (const x of more) {
    const k = mondayRowDedupeKey(x);
    if (!keys.has(k)) {
      keys.add(k);
      out.push(x);
    }
  }
  return out;
}

export default function ProjectListPage() {
  const t = useTranslations("Projects");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const refreshParam = (searchParams.get("refresh") ?? "").trim();
  const user = useAuthUserStore((s) => s.user);
  const canCreateProjects = canAccessModule(user, "projects", "create");
  const canEditProjects = canAccessModule(user, "projects", "edit");
  const canImportProjects = canAccessModule(user, "projects", "import");
  const canExportProjects =
    canAccessModule(user, "harvests", "export") ||
    canAccessModule(user, "projects", "export");
  const searchParamsKey = searchParams.toString();
  const [urlReady, setUrlReady] = useState(false);
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [debouncedSearch, setDebouncedSearch] = useState(
    () => (searchParams.get("q") ?? "").trim(),
  );
  const [countryFilterIds, setCountryFilterIds] = useState(() =>
    parseCsvParam(searchParams.get("country")),
  );
  const [grassFilterIds, setGrassFilterIds] = useState(() =>
    parseCsvParam(searchParams.get("grass")),
  );
  const [projectFilterIds, setProjectFilterIds] = useState(() =>
    parseCsvParam(searchParams.get("project")),
  );
  const [statusFilterValues, setStatusFilterValues] = useState(() =>
    parseStatusFilterFromUrl(searchParams.get("status")),
  );

  const harvestListFarmFilter = useHarvestingDataStore((s) => s.harvestListFarmFilter);
  const { selectedFarmIds: farmFilterIds, setSelectedFarmIds } = useSyncedFarmMultiSelect();
  const projectsRef = useHarvestingDataStore((s) => s.projects);
  const allProjectsRef = useHarvestingDataStore((s) => s.allProjects);
  const keyAreasRef = useHarvestingDataStore((s) => s.keyAreas);
  const countriesRef = useHarvestingDataStore((s) => s.countries);
  const activeCountriesRef = useHarvestingDataStore((s) => s.activeCountries);
  const farmsRef = useHarvestingDataStore((s) => s.farms);
  const staffsRef = useHarvestingDataStore((s) => s.staffs);
  const productsRef = useHarvestingDataStore((s) => s.products);
  const grassesRef = useHarvestingDataStore((s) => s.grasses);
  const farmZonesRef = useHarvestingDataStore((s) => s.farmZones);
  const zoneConfigurations = useHarvestingDataStore((s) => s.zoneConfigurations);
  const fetchAllHarvestingReferenceData = useHarvestingDataStore(
    (s) => s.fetchAllHarvestingReferenceData,
  );
  const referenceBootstrapDone = useHarvestingDataStore((s) => s.bootstrapDone);
  const referenceLoading = useHarvestingDataStore((s) => s.loading);

  const { grassFilterOptions } = useGrassFilterByFarm({
    grasses: grassesRef as unknown[],
    zoneConfigs: zoneConfigurations,
    selectedFarmIds: farmFilterIds,
    selectedGrassIds: grassFilterIds,
    onSelectedGrassIdsChange: setGrassFilterIds,
    catalogMode: "all",
  });

  useEffect(() => {
    const parsed = new URLSearchParams(searchParamsKey);
    setSearch(parsed.get("q") ?? "");
    setDebouncedSearch((parsed.get("q") ?? "").trim());
    setCountryFilterIds(parseCsvParam(parsed.get("country")));
    /** Only overwrite global farm filter when URL carries `farm` (parity with Harvest page). Avoid clearing store on `/projects` without farm. */
    if (parsed.has("farm")) {
      setSelectedFarmIds(parseCsvParam(parsed.get("farm")));
    }
    setGrassFilterIds(parseCsvParam(parsed.get("grass")));
    setProjectFilterIds(parseCsvParam(parsed.get("project")));
    setStatusFilterValues(parseStatusFilterFromUrl(parsed.get("status")));
    setUrlReady(true);
  }, [searchParamsKey, setSelectedFarmIds]);

  const returnTo = useMemo(() => {
    const params = new URLSearchParams();
    const q = search.trim();
    if (q) params.set("q", q);
    if (countryFilterIds.length) params.set("country", countryFilterIds.join(","));
    if (harvestListFarmFilter.trim())
      params.set("farm", harvestListFarmFilter.trim());
    if (grassFilterIds.length) params.set("grass", grassFilterIds.join(","));
    if (projectFilterIds.length) params.set("project", projectFilterIds.join(","));
    params.set("status", serializeStatusFilterToUrl(statusFilterValues));
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }, [
    pathname,
    search,
    countryFilterIds,
    harvestListFarmFilter,
    grassFilterIds,
    projectFilterIds,
    statusFilterValues,
  ]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [totalRecords, setTotalRecords] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<MondayProjectServerRow[]>([]);
  const [harvestPlanRows, setHarvestPlanRows] = useState<Array<Record<string, unknown>>>(
    [],
  );
  const [manualReloadSeq, setManualReloadSeq] = useState(() => (refreshParam ? 1 : 0));
  const [exportOpen, setExportOpen] = useState(false);
  const resumeGoogleSheetExport =
    (searchParams.get("googleSheetExport") ?? "").trim() === "resume";
  const googleSheetExportError = (searchParams.get("googleSheetError") ?? "").trim();
  const pageLoadedRef = useRef(0);
  const loadMoreLockRef = useRef(false);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const handledRefreshParamRef = useRef(refreshParam);
  const fetchedPlanProjectIdsRef = useRef<Set<string>>(new Set());

  /** Reference catalog (zones, farms, countries, …) lives in Zustand — bootstrapped once in DashboardLayout. */
  useEffect(() => {
    if (!refreshParam || handledRefreshParamRef.current === refreshParam) return;
    handledRefreshParamRef.current = refreshParam;
    setManualReloadSeq((prev) => prev + 1);
    void fetchAllHarvestingReferenceData(true);
  }, [fetchAllHarvestingReferenceData, refreshParam]);

  // Debounce search to avoid calling server on every keystroke
  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 400);
    return () => clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    if (resumeGoogleSheetExport) {
      setExportOpen(true);
    }
  }, [resumeGoogleSheetExport]);

  const clearGoogleSheetExportQuery = useCallback(() => {
    const params = new URLSearchParams(searchParamsKey);
    params.delete("googleSheetExport");
    params.delete("googleSheetError");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router, searchParamsKey]);

  useEffect(() => {
    if (!urlReady) return;
    const params = new URLSearchParams();
    const q = debouncedSearch.trim();
    if (q) params.set("q", q);
    if (countryFilterIds.length) params.set("country", countryFilterIds.join(","));
    if (harvestListFarmFilter.trim())
      params.set("farm", harvestListFarmFilter.trim());
    if (grassFilterIds.length) params.set("grass", grassFilterIds.join(","));
    if (projectFilterIds.length) params.set("project", projectFilterIds.join(","));
    params.set("status", serializeStatusFilterToUrl(statusFilterValues));
    const qs = params.toString();
    if (urlSearchParamsEquivalent(qs, searchParamsKey)) return;
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [
    countryFilterIds,
    debouncedSearch,
    grassFilterIds,
    projectFilterIds,
    harvestListFarmFilter,
    pathname,
    router,
    searchParamsKey,
    statusFilterValues,
    urlReady,
  ]);

  const buildStatusQuery = useCallback(() => {
    if (isAllProjectStatusesSelected(statusFilterValues)) return "";
    return statusFilterValues
      .map((x) => normalizeProjectStatusLabel(x))
      .filter(Boolean)
      .join(",");
  }, [statusFilterValues]);

  const buildCountryQuery = useCallback(() => {
    if (countryFilterIds.length === 0) return undefined;
    return countryFilterIds.join(",");
  }, [countryFilterIds]);

  const buildIdListQuery = useCallback((ids: string[]) => {
    if (ids.length === 0) return undefined;
    return ids.join(",");
  }, []);

  const buildProjectListFilterParams = useCallback((): Omit<
    MondayProjectListQuery,
    "page" | "perPage" | "listPaged"
  > => ({
    module: "project",
    search: debouncedSearch || undefined,
    status: buildStatusQuery() || undefined,
    countryId: buildCountryQuery(),
    farmId: buildIdListQuery(farmFilterIds),
    grassId: buildIdListQuery(grassFilterIds),
    projectId: buildIdListQuery(projectFilterIds),
    sortBy: "project_id",
    sortDir: "desc",
  }), [
    buildCountryQuery,
    buildIdListQuery,
    buildStatusQuery,
    debouncedSearch,
    farmFilterIds,
    grassFilterIds,
    projectFilterIds,
  ]);

  const buildProjectListFetchParams = useCallback(
    (page: number): MondayProjectListQuery => ({
      ...buildProjectListFilterParams(),
      page,
      perPage: PROJECT_LIST_PAGE_SIZE,
      listPaged: true,
    }),
    [buildProjectListFilterParams],
  );

  /** Stable key so URL-sync state churn does not re-fetch with identical query params. */
  const projectListPageOneFetchKey = useMemo(() => {
    const p = buildProjectListFetchParams(1);
    return JSON.stringify({
      module: p.module ?? "",
      search: p.search ?? "",
      status: p.status ?? "",
      countryId: p.countryId ?? "",
      farmId: p.farmId ?? "",
      grassId: p.grassId ?? "",
      projectId: p.projectId ?? "",
      sortBy: p.sortBy ?? "",
      sortDir: p.sortDir ?? "",
      page: 1,
      perPage: PROJECT_LIST_PAGE_SIZE,
    });
  }, [buildProjectListFetchParams]);

  useEffect(() => {
    if (!urlReady) return;

    let cancelled = false;
    pageLoadedRef.current = 0;
    loadMoreLockRef.current = false;
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        setRows([]);
        setTotalRecords(null);
        setHasMore(true);
        fetchedPlanProjectIdsRef.current = new Set();
        setHarvestPlanRows([]);
        const res = await fetchMondayProjectRowsFromServer(buildProjectListFetchParams(1));
        if (cancelled) return;
        const list = res.rows as MondayProjectServerRow[];
        const total = res.totalRecords;
        setRows(list);
        setTotalRecords(total);
        pageLoadedRef.current = 1;
        setHasMore(
          total != null
            ? list.length < total
            : list.length >= PROJECT_LIST_PAGE_SIZE,
        );
      } catch (e) {
        if (cancelled) return;
        setRows([]);
        setError(e instanceof Error ? e.message : t("loadError"));
        setHasMore(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [urlReady, projectListPageOneFetchKey, manualReloadSeq, buildProjectListFetchParams, t]);

  useEffect(() => {
    const projectIds = [
      ...new Set(
        rows
          .map((row) => String(row.project_id ?? "").trim())
          .filter(Boolean),
      ),
    ];
    const missing = projectIds.filter((id) => !fetchedPlanProjectIdsRef.current.has(id));
    if (missing.length === 0) return;

    let cancelled = false;
    void fetchHarvestPlanIndexRowsForProjects(missing, { userId: user?.id })
      .then((planRows) => {
        if (cancelled) return;
        for (const id of missing) {
          fetchedPlanProjectIdsRef.current.add(id);
        }
        if (planRows.length === 0) return;
        setHarvestPlanRows((prev) => mergeHarvestPlanRows(prev, planRows));
      })
      .catch(() => {
        /* cards keep Monday subitems; progress may update on next scroll */
      });
    return () => {
      cancelled = true;
    };
  }, [rows, user?.id]);

  const rowsWithHarvestPlan = useMemo(() => {
    if (harvestPlanRows.length === 0) return rows;
    return mergeProjectSubitemsWithHarvestPlan(
      rows as unknown as Array<Record<string, unknown>>,
      harvestPlanRows,
    ) as MondayProjectServerRow[];
  }, [harvestPlanRows, rows]);

  useEffect(() => {
    const el = loadMoreSentinelRef.current;
    if (!el || loading || !hasMore) return;

    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        if (loadMoreLockRef.current || loading) return;
        loadMoreLockRef.current = true;
        setLoadingMore(true);
        const nextPage = pageLoadedRef.current + 1;
        void fetchMondayProjectRowsFromServer(buildProjectListFetchParams(nextPage))
          .then((res) => {
            const list = res.rows as MondayProjectServerRow[];
            if (list.length === 0) {
              setHasMore(false);
              return;
            }
            setRows((prev) => {
              const merged = mergeMondayRowsUnique(prev, list);
              setHasMore(
                totalRecords != null
                  ? merged.length < totalRecords
                  : list.length >= PROJECT_LIST_PAGE_SIZE,
              );
              return merged;
            });
            pageLoadedRef.current = nextPage;
          })
          .catch(() => {
            /* keep hasMore; user can scroll again to retry */
          })
          .finally(() => {
            loadMoreLockRef.current = false;
            setLoadingMore(false);
          });
      },
      { root: null, rootMargin: "160px", threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
    // Re-bind after each append so a still-visible sentinel triggers the next page.
  }, [loading, hasMore, buildProjectListFetchParams, rows.length, totalRecords]);

  const projectCountryById = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of toRecArray(projectsRef)) {
      const id = String(r.id ?? "").trim();
      const countryId = String(r.country_id ?? "").trim();
      if (id && countryId) map.set(id, countryId);
    }
    return map;
  }, [projectsRef]);

  /**
   * Flutter monday_screen.dart parity:
   * - data = displayData[index]
   * - rowId = data['row_id'] ?? data['id']
   * - rowData = controller.rows.firstWhere((row) => row.rowId == rowId)
   */
  const projects = useMemo(() => {
    const allowedProjectIdsByCountry = new Set<string>();
    if (countryFilterIds.length > 0) {
      // Fallback resolver for dynamic-table style rows:
      // 1) find records where name=country_id and value in selected filters
      // 2) with same (row_id, table_id), find name=project_id and collect its value
      const byRowTable = new Map<string, Record<string, unknown>[]>();
      for (const row of rows as unknown as Record<string, unknown>[]) {
        const key = makeRowTableKey(row);
        if (!key || key === "__") continue;
        const list = byRowTable.get(key) ?? [];
        list.push(row);
        byRowTable.set(key, list);
      }

      for (const grouped of byRowTable.values()) {
        let matchedCountry = false;
        for (const rec of grouped) {
          const fieldName = normalizeDynamicFieldName(rec.name);
          if (fieldName !== "country_id") continue;
          const fieldValue = normalizeDynamicFieldValue(rec.value);
          if (countryFilterIds.includes(fieldValue)) {
            matchedCountry = true;
            break;
          }
        }
        if (!matchedCountry) continue;

        for (const rec of grouped) {
          const fieldName = normalizeDynamicFieldName(rec.name);
          if (fieldName !== "project_id") continue;
          const projectId = normalizeDynamicFieldValue(rec.value ?? rec.project_id);
          if (projectId) allowedProjectIdsByCountry.add(projectId);
        }
      }
    }
    const mergedRows = rowsWithHarvestPlan.map((data) => {
      const rowId = String(data.row_id ?? data.id ?? "").trim();
      const rowData =
        rowsWithHarvestPlan.find((row) => {
          const candidateRowId = String(row.row_id ?? row.id ?? "").trim();
          if (candidateRowId !== rowId) return false;
          const dataTableId = String(data.table_id ?? "").trim();
          if (!dataTableId) return true;
          return String(row.table_id ?? "").trim() === dataTableId;
        }) ?? null;

      const rowDataLike: MondayDynamicRowLike | null = rowData
        ? {
          rowId: String(rowData.row_id ?? rowData.id ?? "").trim(),
          tableId: String(rowData.table_id ?? "").trim(),
          status: String(rowData.status ?? rowData.status_app ?? "").trim(),
          createdAt: String(rowData.created_at ?? "").trim(),
          projectImg: rowData.project_img,
          subitems: rowData.subitems,
          quantityRequiredSprigSod: rowData.quantity_required_sprig_sod,
          toJson: () => ({ ...(rowData as Record<string, unknown>) }),
        }
        : null;

      const merged = mergeMondayDisplayData(
        data as unknown as Record<string, unknown>,
        rowDataLike,
      );
      return { data: merged, rowData: rowDataLike };
    });

    return mergedRows.filter(({ data }) => {
      const rec = data as Record<string, unknown>;
      const recProjectId = String(rec.project_id ?? "").trim();
      const visibleByServerRow = recProjectId !== "";
      const rowCountryId =
        String(rec.country_id ?? "").trim() ||
        (recProjectId ? projectCountryById.get(recProjectId) ?? "" : "");
      const countryOk =
        countryFilterIds.length === 0 ||
        countryFilterIds.includes(rowCountryId) ||
        (recProjectId ? allowedProjectIdsByCountry.has(recProjectId) : false);
      return visibleByServerRow && countryOk;
    });
  }, [rowsWithHarvestPlan, countryFilterIds, projectCountryById, rows]);

  const projectTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of toRecArray(allProjectsRef)) {
      const id = String(r.id ?? "").trim();
      const label = String(r.title ?? r.name ?? "").trim();
      if (id && label) map.set(id, label);
    }
    for (const r of toRecArray(projectsRef)) {
      const id = String(r.id ?? "").trim();
      const label = String(r.title ?? r.name ?? "").trim();
      if (id && label && !map.has(id)) map.set(id, label);
    }
    return map;
  }, [allProjectsRef, projectsRef]);

  const countryNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of toRecArray(countriesRef)) {
      const id = String(r.id ?? "").trim();
      const label = String(r.country_name ?? r.name ?? r.title ?? "").trim();
      if (id && label) map.set(id, label);
    }
    return map;
  }, [countriesRef]);

  const staffNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of toRecArray(staffsRef)) {
      const id = String(r.id ?? "").trim();
      const label = String(
        r.first_name ?? r.full_name ?? r.name ?? r.title ?? "",
      ).trim();
      if (id && label) map.set(id, label);
    }
    return map;
  }, [staffsRef]);

  const staffAvatarMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of toRecArray(staffsRef)) {
      const id = String(r.id ?? "").trim();
      const avatar = resolveStaffAvatarImageUrl(r.image);
      if (id && avatar) map.set(id, avatar);
    }
    return map;
  }, [staffsRef]);

  const productNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of toRecArray(productsRef)) {
      const id = String(r.id ?? "").trim();
      const label = String(r.name ?? r.title ?? "").trim();
      if (id && label) map.set(id, label);
    }
    return map;
  }, [productsRef]);

  const keyAreaNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of keyAreasRef) {
      const id = String(r.id ?? "").trim();
      const title = String(r.title ?? "").trim();
      if (id && title) map.set(id, title);
    }
    return map;
  }, [keyAreasRef]);

  const countryOptions = useMemo(() => {
    const list = toRecArray(activeCountriesRef)
      .map((r) => ({
        id: String(r.id ?? "").trim(),
        name: String(r.country_name ?? r.name ?? r.title ?? "").trim(),
      }))
      .filter((x) => x.id && x.name);
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [activeCountriesRef]);

  /** Farm-scoped grass options (zone configuration); all farms → full catalog. */
  const grassOptions = useMemo(
    () =>
      grassFilterOptions.map((o) => ({
        id: o.value,
        name: o.label,
      })),
    [grassFilterOptions],
  );

  const projectOptions = useMemo(() => {
    const catalog = toRecArray(projectsRef);
    const pinned = new Set(projectFilterIds);
    const pinnedRows = projectFilterIds
      .map((id) => catalog.find((r) => String(r.id ?? "").trim() === id))
      .filter((r): r is Record<string, unknown> => !!r);
    const merged = [
      ...pinnedRows,
      ...catalog.filter((r) => !pinned.has(String(r.id ?? "").trim())),
    ];
    return mapRowsToSelectOptions(merged as unknown[], "title").map((o) => ({
      id: o.id,
      name: o.label,
    }));
  }, [projectsRef, projectFilterIds]);

  const farmOptions = useMemo(() => {
    const list = toRecArray(farmsRef)
      .map((r) => ({
        id: String(r.id ?? "").trim(),
        name: String(r.name ?? r.title ?? "").trim(),
      }))
      .filter((x) => x.id && x.name);
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [farmsRef]);

  const exportFilter = useMemo<ProjectListExportFilter>(
    () => ({
      search: debouncedSearch,
      countryIds: countryFilterIds,
      farmIds: farmFilterIds,
      grassIds: grassFilterIds,
      projectIds: projectFilterIds,
      statusValues: statusFilterValues,
    }),
    [
      debouncedSearch,
      countryFilterIds,
      farmFilterIds,
      grassFilterIds,
      projectFilterIds,
      statusFilterValues,
    ],
  );

  const filteredProjectCount = useMemo(() => {
    if (totalRecords != null) return totalRecords;
    return projects.length;
  }, [projects.length, totalRecords]);

  const projectCountLabel = useMemo(() => {
    return t("projectsFound", { count: filteredProjectCount });
  }, [filteredProjectCount, t]);

  const countHeaderLoading =
    (!referenceBootstrapDone && referenceLoading) || loading;

  const exportResolveContext = useMemo(
    () => ({
      projects: projectsRef,
      products: productsRef,
      farms: farmsRef,
      farmZones: farmZonesRef,
      countries: countriesRef,
      staffs: staffsRef,
      locale,
      projectStatusLabel: (status: string) => {
        switch (status) {
          case "Ongoing":
            return t("statusOngoing");
          case "Future":
            return t("statusFuture");
          case "Done":
            return t("statusDone");
          case "Warning":
            return t("statusWarning");
          default:
            return status;
        }
      },
    }),
    [
      countriesRef,
      farmZonesRef,
      farmsRef,
      locale,
      productsRef,
      projectsRef,
      staffsRef,
      t,
    ],
  );

  const filterTriggerIcon = (
    <>
      <AlignLeft className="h-3.5 w-3.5 shrink-0" />
      <ArrowDown className="h-3.5 w-3.5 shrink-0" />
    </>
  );

  const multiSelectBaseClass =
    "min-w-[140px] max-w-[180px] rounded-md border border-input text-sm hover:bg-btnhover/40";

  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="p-4 lg:p-8 space-y-6">
          {/* Header — Harvesting Portal Projects layout */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-heading font-bold text-foreground">
                {t("title")}
              </h1>
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                {countHeaderLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                    <span>{t("loading")}</span>
                  </>
                ) : (
                  projectCountLabel
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canExportProjects ? (
                <button
                  onClick={() => setExportOpen(true)}
                  className="bg-background inline-flex h-10 items-center justify-center gap-2 rounded-md border border-input px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
                  type="button"
                >
                  <Download className="h-4 w-4 shrink-0" />
                  {t("exportData")}
                </button>
              ) : null}
              {canImportProjects ? (
                <button
                  onClick={() => router.push("/projects/import")}
                  className="bg-background inline-flex h-10 items-center justify-center gap-2 rounded-md border border-input px-4 text-sm font-medium text-foreground transition-colors"
                  type="button"
                >
                  <Upload className="h-4 w-4 shrink-0" />
                  {t("importExcel")}
                </button>
              ) : null}
              {canCreateProjects ? (
                <button
                  onClick={() =>
                    router.push(
                      `/projects/new?returnTo=${encodeURIComponent(returnTo)}`,
                    )
                  }
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
                  type="button"
                >
                  <Plus className="h-4 w-4 shrink-0" />
                  {t("newProject")}
                </button>
              ) : null}
            </div>
          </div>

          {googleSheetExportError ? (
            <p className="text-sm text-destructive">{googleSheetExportError}</p>
          ) : null}

          {/* Search & filters — inline row like Harvesting Portal */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                placeholder={t("searchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={cn(
                  "h-10 w-full rounded-md border border-input pl-9 pr-3 text-sm",
                  bgSurfaceFilter(!!search.trim()),
                )}
                autoComplete="off"
              />
            </div>
            <MultiSelect
              options={countryOptions.map((c) => ({ value: c.id, label: c.name }))}
              values={countryFilterIds}
              onChange={setCountryFilterIds}
              placeholder={t("allCountries")}
              showAllOption
              className={cn(multiSelectBaseClass, bgSurfaceFilter(countryFilterIds.length > 0))}
              rightIcon={filterTriggerIcon}
            />
            {/* <MultiSelect
              options={projectOptions.map((p) => ({ value: p.id, label: p.name }))}
              values={projectFilterIds}
              onChange={setProjectFilterIds}
              disabled={projectOptions.length === 0}
              placeholder={t("allProjectsCount", { count: projectOptions.length })}
              className={cn(multiSelectBaseClass, bgSurfaceFilter(projectFilterIds.length > 0))}
              rightIcon={filterTriggerIcon}
            /> */}
            <MultiSelect
              options={farmOptions.map((f) => ({ value: f.id, label: f.name }))}
              values={farmFilterIds}
              onChange={setSelectedFarmIds}
              placeholder={t("allFarms")}
              showAllOption
              className={cn(multiSelectBaseClass, bgSurfaceFilter(farmFilterIds.length > 0))}
              rightIcon={filterTriggerIcon}
            />
            <MultiSelect
              options={grassOptions.map((g) => ({ value: g.id, label: g.name }))}
              values={grassFilterIds}
              onChange={setGrassFilterIds}
              placeholder={t("allGrass")}
              showAllOption
              className={cn(multiSelectBaseClass, bgSurfaceFilter(grassFilterIds.length > 0))}
              rightIcon={filterTriggerIcon}
            />
            <MultiSelect
              options={[
                { value: "Ongoing", label: t("statusOngoing") },
                { value: "Future", label: t("statusFuture") },
                { value: "Done", label: t("statusDone") },
                { value: "Warning", label: t("statusWarning") },
              ]}
              values={statusFilterValues}
              onChange={setStatusFilterValues}
              placeholder={t("allStatuses")}
              showAllOption
              className={cn(multiSelectBaseClass, bgSurfaceFilter(statusFilterValues.length > 0))}
              rightIcon={filterTriggerIcon}
            />
          </div>

          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : null}

          {loading ? null : projects.length === 0 ? (
            <div className="rounded-lg border border-border bg-background text-card-foreground shadow-sm">
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground px-4">
                <FolderOpen className="mb-3 h-12 w-12 opacity-40" />
                <p className="font-medium text-foreground">{t("empty")}</p>
                <p className="mt-1 text-center text-sm">{t("emptyHint")}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {projects.map(({ data, rowData }) => (
                  <ProjectListItem
                    key={String(data.row_id ?? data.id)}
                    serverRow={data}
                    getProjectTitleById={(id?: string) => (id ? projectTitleMap.get(id) : undefined)}
                    getCountryNameById={(id?: string) => (id ? countryNameMap.get(id) : undefined)}
                    getUserNameById={(id?: string) => (id ? staffNameMap.get(id) : undefined)}
                    getUserAvatarById={(id?: string) => (id ? staffAvatarMap.get(id) : undefined)}
                    getProductNameById={(id?: string) => (id ? productNameMap.get(id) : undefined)}
                    getKeyAreaNameById={(id?: string | number) => {
                      const key = String(id ?? "").trim();
                      return key ? keyAreaNameMap.get(key) : undefined;
                    }}
                    showEditAction={canEditProjects}
                    onViewProject={() => {
                      const args = buildMondayEditArgs(
                        data as unknown as Record<string, unknown>,
                        rowData,
                      );
                      const projectId = String(
                        (data as Record<string, unknown>).project_id ??
                          (data as Record<string, unknown>).id ??
                          "",
                      ).trim();
                      router.push(
                        `/projects/detail?rowId=${encodeURIComponent(args.rowId ?? "")}&tableId=${encodeURIComponent(args.tableId ?? "")}&projectId=${encodeURIComponent(projectId)}&returnTo=${encodeURIComponent(returnTo)}`,
                      );
                    }}
                    onEditProject={() => {
                      const args = buildMondayEditArgs(
                        data as unknown as Record<string, unknown>,
                        rowData,
                      );
                      router.push(
                        `/projects/new?rowId=${encodeURIComponent(args.rowId ?? "")}&tableId=${encodeURIComponent(args.tableId ?? "")}&returnTo=${encodeURIComponent(returnTo)}`,
                      );
                    }}
                  />
                ))}
              </div>
              {hasMore ? (
                <div
                  ref={loadMoreSentinelRef}
                  className="h-6 w-full shrink-0"
                  aria-hidden
                />
              ) : null}
              {loadingMore ? (
                <div className="flex items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span>{t("loadingMore")}</span>
                </div>
              ) : null}
            </div>
          )}
        </div>
        {canExportProjects ? (
          <ProjectListExportDialog
            open={exportOpen}
            onClose={() => setExportOpen(false)}
            filter={exportFilter}
            harvestPlanRows={harvestPlanRows}
            resolveContext={exportResolveContext}
            resumeGoogleSheetExport={resumeGoogleSheetExport}
            onResumeHandled={clearGoogleSheetExportQuery}
          />
        ) : null}
      </DashboardLayout>
    </RequireAuth>
  );
}
