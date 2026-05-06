"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlignLeft, ArrowDown, FolderOpen, Loader2, Plus, Search, Upload } from "lucide-react";

import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import RequireAuth from "@/features/auth/RequireAuth";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  fetchMondayProjectRowsFromServer,
  type MondayDynamicRowLike,
  type MondayProjectServerRow,
} from "@/entities/projects";
import {
  ProjectListItem,
  buildMondayEditArgs,
  mergeMondayDisplayData,
  sortMondayProjectRows,
} from "@/features/project";
import { parseJsonMaybe } from "@/shared/lib/parseJsonMaybe";
import { resolveStaffAvatarImageUrl } from "@/features/project/lib/staffAvatarUrl";
import { stsProxyGetHarvestingIndex } from "@/shared/api/stsProxyClient";
import { cn } from "@/lib/utils";
import { bgSurfaceFilter } from "@/shared/lib/surfaceFilter";

function parseCsvParam(v: string | null): string[] {
  return String(v ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

/** No `status` in URL → Flutter-style default; empty param → no status filter. */
function parseStatusFilterFromUrl(raw: string | null): string[] {
  if (raw === null) return ["Ongoing", "Future"];
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

function rowHasGrassProduct(row: MondayProjectServerRow, productId: string): boolean {
  const pid = String(productId ?? "").trim();
  if (!pid) return false;
  const raw = (row as Record<string, unknown>).quantity_required_sprig_sod;
  const parsed = parseJsonMaybe(raw);
  if (!Array.isArray(parsed)) return false;
  return parsed.some((item) => {
    if (!item || typeof item !== "object") return false;
    const rec = item as Record<string, unknown>;
    return String(rec.product_id ?? "").trim() === pid;
  });
}

function rowHasFarmInSubitems(row: MondayProjectServerRow, farmId: string): boolean {
  const fid = String(farmId ?? "").trim();
  if (!fid) return false;
  const raw = (row as Record<string, unknown>).subitems;
  const parsed = parseJsonMaybe(raw);
  if (!Array.isArray(parsed)) return false;
  return parsed.some((item) => {
    if (!item || typeof item !== "object") return false;
    const rec = item as Record<string, unknown>;
    return String(rec.farm_id ?? "").trim() === fid;
  });
}

function parseRowSubitems(raw: unknown): Array<Record<string, unknown>> {
  const parsed = parseJsonMaybe(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
}

function mergeProjectSubitemsWithPlanRows(
  projectRows: Array<Record<string, unknown>>,
  harvestPlanRows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  if (projectRows.length === 0 || harvestPlanRows.length === 0) return projectRows;
  const planByProjectId = new Map<string, Array<Record<string, unknown>>>();
  for (const row of harvestPlanRows) {
    const pid = String(row.project_id ?? "").trim();
    if (!pid) continue;
    const list = planByProjectId.get(pid) ?? [];
    list.push(row);
    planByProjectId.set(pid, list);
  }
  return projectRows.map((row) => {
    const projectId = String(row.project_id ?? "").trim();
    if (!projectId) return row;
    const planRows = planByProjectId.get(projectId) ?? [];
    if (planRows.length === 0) return row;
    const existingSubitems = parseRowSubitems(row.subitems);
    const planIds = new Set(
      planRows
        .map((x) => String(x.id ?? "").trim())
        .filter(Boolean),
    );
    const merged = [
      ...planRows,
      ...existingSubitems.filter((x) => {
        const sid = String(x.id ?? "").trim();
        return !sid || !planIds.has(sid);
      }),
    ];
    return {
      ...row,
      subitems: JSON.stringify(merged),
    };
  });
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

export default function ProjectListPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
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
  const [statusFilterValues, setStatusFilterValues] = useState(() =>
    parseStatusFilterFromUrl(searchParams.get("status")),
  );

  const harvestListFarmFilter = useHarvestingDataStore((s) => s.harvestListFarmFilter);
  const setHarvestListFarmFilter = useHarvestingDataStore((s) => s.setHarvestListFarmFilter);
  const projectsRef = useHarvestingDataStore((s) => s.projects);
  const countriesRef = useHarvestingDataStore((s) => s.countries);
  const farmsRef = useHarvestingDataStore((s) => s.farms);
  const staffsRef = useHarvestingDataStore((s) => s.staffs);
  const productsRef = useHarvestingDataStore((s) => s.products);
  const fetchAllHarvestingReferenceData = useHarvestingDataStore(
    (s) => s.fetchAllHarvestingReferenceData,
  );

  useEffect(() => {
    const parsed = new URLSearchParams(searchParamsKey);
    setSearch(parsed.get("q") ?? "");
    setDebouncedSearch((parsed.get("q") ?? "").trim());
    setCountryFilterIds(parseCsvParam(parsed.get("country")));
    /** Only overwrite global farm filter when URL carries `farm` (parity with Harvest page). Avoid clearing store on `/projects` without farm. */
    if (parsed.has("farm")) {
      setHarvestListFarmFilter(parsed.get("farm") ?? "");
    }
    setGrassFilterIds(parseCsvParam(parsed.get("grass")));
    setStatusFilterValues(parseStatusFilterFromUrl(parsed.get("status")));
    setUrlReady(true);
  }, [searchParamsKey, setHarvestListFarmFilter]);

  const returnTo = useMemo(() => {
    const params = new URLSearchParams();
    const q = debouncedSearch.trim();
    if (q) params.set("q", q);
    if (countryFilterIds.length) params.set("country", countryFilterIds.join(","));
    if (harvestListFarmFilter.trim())
      params.set("farm", harvestListFarmFilter.trim());
    if (grassFilterIds.length) params.set("grass", grassFilterIds.join(","));
    params.set("status", statusFilterValues.join(","));
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }, [
    pathname,
    debouncedSearch,
    countryFilterIds,
    harvestListFarmFilter,
    grassFilterIds,
    statusFilterValues,
  ]);
  const [loading, setLoading] = useState(true);
  const [backgroundLoading, setBackgroundLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<MondayProjectServerRow[]>([]);

  useEffect(() => {
    void fetchAllHarvestingReferenceData();
  }, [fetchAllHarvestingReferenceData]);

  // Debounce search to avoid calling server on every keystroke
  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 400);
    return () => clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    if (!urlReady) return;
    const params = new URLSearchParams();
    const q = debouncedSearch.trim();
    if (q) params.set("q", q);
    if (countryFilterIds.length) params.set("country", countryFilterIds.join(","));
    if (harvestListFarmFilter.trim())
      params.set("farm", harvestListFarmFilter.trim());
    if (grassFilterIds.length) params.set("grass", grassFilterIds.join(","));
    params.set("status", statusFilterValues.join(","));
    const qs = params.toString();
    if (urlSearchParamsEquivalent(qs, searchParamsKey)) return;
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [
    countryFilterIds,
    debouncedSearch,
    grassFilterIds,
    harvestListFarmFilter,
    pathname,
    router,
    searchParamsKey,
    statusFilterValues,
    urlReady,
  ]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        const statusQuery = statusFilterValues
          .map((x) => normalizeProjectStatusLabel(x))
          .filter(Boolean)
          .join(",");
        const quickPerPage = 30;
        const fullPerPage = 100;

        // Fast first paint: request a smaller page size, render immediately.
        const quickRes = await fetchMondayProjectRowsFromServer({
          module: "project",
          search: debouncedSearch || undefined,
          page: 1,
          perPage: quickPerPage,
          status: statusQuery || undefined,
        });
        if (!mounted) return;
        let baseRows = quickRes.rows as unknown as Record<string, unknown>[];
        setRows(sortMondayProjectRows(baseRows));
        setLoading(false);

        // Continue loading the full page size in background, then refresh list.
        void (async () => {
          if (mounted) setBackgroundLoading(true);
          try {
            const fullRes = await fetchMondayProjectRowsFromServer({
              module: "project",
              search: debouncedSearch || undefined,
              page: 1,
              perPage: fullPerPage,
              status: statusQuery || undefined,
            });
            if (!mounted) return;
            const fullRows = fullRes.rows as unknown as Record<string, unknown>[];
            if (fullRows.length > 0) {
              baseRows = fullRows;
              setRows(sortMondayProjectRows(baseRows));
            }

            const allHarvestRows: Array<Record<string, unknown>> = [];
            let page = 1;
            let totalPages = 1;
            const maxPages = 20;
            do {
              const harvestRes = await stsProxyGetHarvestingIndex({
                page,
                per_page: 200,
              });
              allHarvestRows.push(
                ...harvestRes.rows.filter(
                  (x): x is Record<string, unknown> => !!x && typeof x === "object",
                ),
              );
              totalPages = Math.max(1, harvestRes.totalPages);
              page += 1;
            } while (page <= totalPages && page <= maxPages);

            if (!mounted) return;
            const enrichedRows = mergeProjectSubitemsWithPlanRows(baseRows, allHarvestRows);
            setRows(sortMondayProjectRows(enrichedRows));
          } catch {
            // Keep already-rendered base rows if enrichment fails.
          } finally {
            if (mounted) setBackgroundLoading(false);
          }
        })();
      } catch (e) {
        if (!mounted) return;
        setRows([]);
        setError(e instanceof Error ? e.message : "Failed to load projects.");
        setBackgroundLoading(false);
      }
      if (mounted) setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [debouncedSearch, statusFilterValues]);

  /** Same source as header farm picker: `harvestListFarmFilter` (CSV ids). MultiSelect edits the store directly. */
  const farmFilterIds = useMemo(
    () => parseCsvParam(harvestListFarmFilter.trim() || null),
    [harvestListFarmFilter],
  );

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
    const mergedRows = rows.map((data) => {
      const rowId = String(data.row_id ?? data.id ?? "").trim();
      const rowData =
        rows.find((row) => {
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
      const countryOk =
        countryFilterIds.length === 0 ||
        countryFilterIds.includes(String(rec.country_id ?? "").trim()) ||
        (recProjectId ? allowedProjectIdsByCountry.has(recProjectId) : false);
      const farmOk =
        farmFilterIds.length === 0 ||
        farmFilterIds.some((id) =>
          rowHasFarmInSubitems(data as MondayProjectServerRow, id),
        );
      const grassOk =
        grassFilterIds.length === 0 ||
        grassFilterIds.some((id) => rowHasGrassProduct(data as MondayProjectServerRow, id));
      return countryOk && farmOk && grassOk;
    });
  }, [rows, countryFilterIds, farmFilterIds, grassFilterIds]);

  const projectTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of toRecArray(projectsRef)) {
      const id = String(r.id ?? "").trim();
      const label = String(r.title ?? r.name ?? "").trim();
      if (id && label) map.set(id, label);
    }
    return map;
  }, [projectsRef]);

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

  const countryOptions = useMemo(() => {
    const list = toRecArray(countriesRef)
      .map((r) => ({
        id: String(r.id ?? "").trim(),
        name: String(r.country_name ?? r.name ?? r.title ?? "").trim(),
      }))
      .filter((x) => x.id && x.name);
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [countriesRef]);

  const grassOptions = useMemo(() => {
    const list = toRecArray(productsRef)
      .map((r) => ({
        id: String(r.id ?? "").trim(),
        name: String(r.name ?? r.title ?? "").trim(),
      }))
      .filter((x) => x.id && x.name);
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [productsRef]);

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

  const projectCountLabel =
    projects.length >= 100
      ? `${formatNumber(projects.length)}+ projects found`
      : `${formatNumber(projects.length)} project${projects.length !== 1 ? "s" : ""} found`;

  const filterTriggerIcon = (
    <>
      <AlignLeft className="h-3.5 w-3.5 shrink-0" />
      <ArrowDown className="h-3.5 w-3.5 shrink-0" />
    </>
  );

  const multiSelectBaseClass =
    "min-w-[140px] max-w-[180px] rounded-md border border-input text-sm text-foreground hover:bg-btnhover/40";

  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="p-4 lg:p-8 space-y-6">
          {/* Header — Harvesting Portal Projects layout */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-heading font-bold text-foreground">
                Projects
              </h1>
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                    <span>Loading projects…</span>
                  </>
                ) : (
                  projectCountLabel
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => router.push("/projects/import")}
                className="bg-background inline-flex h-10 items-center justify-center gap-2 rounded-md border border-input px-4 text-sm font-medium text-foreground transition-colors"
                type="button"
              >
                <Upload className="h-4 w-4 shrink-0" />
                Import Excel
              </button>
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
                New Project
              </button>
            </div>
          </div>

          {/* Search & filters — inline row like Harvesting Portal */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                placeholder="Search projects…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={cn(
                  "h-10 w-full rounded-md border border-input pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground",
                  bgSurfaceFilter(!!search.trim()),
                )}
                autoComplete="off"
              />
            </div>
            <MultiSelect
              options={countryOptions.map((c) => ({ value: c.id, label: c.name }))}
              values={countryFilterIds}
              onChange={setCountryFilterIds}
              placeholder="All countries"
              className={cn(multiSelectBaseClass, bgSurfaceFilter(countryFilterIds.length > 0))}
              rightIcon={filterTriggerIcon}
            />
            <MultiSelect
              options={farmOptions.map((f) => ({ value: f.id, label: f.name }))}
              values={farmFilterIds}
              onChange={(ids) => setHarvestListFarmFilter(ids.join(","))}
              placeholder="All farms"
              className={cn(multiSelectBaseClass, bgSurfaceFilter(farmFilterIds.length > 0))}
              rightIcon={filterTriggerIcon}
            />
            <MultiSelect
              options={grassOptions.map((g) => ({ value: g.id, label: g.name }))}
              values={grassFilterIds}
              onChange={setGrassFilterIds}
              placeholder="All grasses"
              className={cn(multiSelectBaseClass, bgSurfaceFilter(grassFilterIds.length > 0))}
              rightIcon={filterTriggerIcon}
            />
            <MultiSelect
              options={[
                { value: "Ongoing", label: "Ongoing" },
                { value: "Future", label: "Future" },
                { value: "Done", label: "Done" },
                { value: "Warning", label: "Warning" },
              ]}
              values={statusFilterValues}
              onChange={setStatusFilterValues}
              placeholder="All statuses"
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
                <p className="font-medium text-foreground">No projects found</p>
                <p className="mt-1 text-center text-sm">
                  Try adjusting your filters or add a new project.
                </p>
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
                    onEditProject={() => {
                      const args = buildMondayEditArgs(
                        data as unknown as Record<string, unknown>,
                        rowData,
                      );
                      const projectId = String((data as Record<string, unknown>).project_id ?? "").trim();
                      router.push(
                        `/projects/detail?rowId=${encodeURIComponent(args.rowId ?? "")}&tableId=${encodeURIComponent(args.tableId ?? "")}&projectId=${encodeURIComponent(projectId)}&returnTo=${encodeURIComponent(returnTo)}`,
                      );
                    }}
                  />
                ))}
              </div>
              {backgroundLoading ? (
                <div className="flex items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span>Updating projects…</span>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </DashboardLayout>
    </RequireAuth>
  );
}
