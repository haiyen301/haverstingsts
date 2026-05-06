"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlignLeft, ArrowDown, ArrowLeft, Briefcase, Loader2 } from "lucide-react";

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
import { useAppTranslations } from "@/shared/i18n/useAppTranslations";
import {
  isProjectRecordCompletedRaw,
  parseKpiDeliveryPeriod,
  projectHasSubitemDeliveryInKpiPeriod,
  rowMatchesDashboardActiveProjectsKpi,
} from "@/shared/lib/dashboardKpiProjectFilters";

const ACTIVE_PROJECT_STATUSES = ["Ongoing", "Future", "Warning"];

function parseCsvParam(v: string | null): string[] {
  return String(v ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
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

function ActiveProjectsPageInner() {
  const t = useAppTranslations();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [countryFilterIds, setCountryFilterIds] = useState<string[]>([]);
  const [grassFilterIds, setGrassFilterIds] = useState<string[]>([]);

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

  const [loading, setLoading] = useState(true);
  const [backgroundLoading, setBackgroundLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<MondayProjectServerRow[]>([]);

  const returnTo = pathname;

  useEffect(() => {
    void fetchAllHarvestingReferenceData();
  }, [fetchAllHarvestingReferenceData]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        const statusQuery = ACTIVE_PROJECT_STATUSES.map((x) => normalizeProjectStatusLabel(x))
          .filter(Boolean)
          .join(",");
        const quickPerPage = 30;
        const fullPerPage = 100;

        const quickRes = await fetchMondayProjectRowsFromServer({
          module: "project",
          search: undefined,
          page: 1,
          perPage: quickPerPage,
          status: statusQuery || undefined,
        });
        if (!mounted) return;
        let baseRows = quickRes.rows as unknown as Record<string, unknown>[];
        setRows(sortMondayProjectRows(baseRows));
        setLoading(false);

        void (async () => {
          if (mounted) setBackgroundLoading(true);
          try {
            const fullRes = await fetchMondayProjectRowsFromServer({
              module: "project",
              search: undefined,
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
            // Keep partial rows
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
  }, []);

  const farmFilterIds = useMemo(
    () => parseCsvParam(harvestListFarmFilter.trim() || null),
    [harvestListFarmFilter],
  );

  const selectedFarmIdSet = useMemo(() => new Set(farmFilterIds), [farmFilterIds]);

  const kpiQueryFlag = searchParams.get("kpi");
  const kpiPeriodParam = searchParams.get("period");
  const kpiExcludeNoFarmParam = searchParams.get("excludeNoFarm");
  const dashboardKpiPeriodParsed = parseKpiDeliveryPeriod(kpiPeriodParam);
  const applyDashboardDeliveryKpi = kpiQueryFlag === "1" && dashboardKpiPeriodParsed !== null;
  const dashboardExcludeNoFarm = kpiExcludeNoFarmParam === "1";

  const projects = useMemo(() => {
    const allowedProjectIdsByCountry = new Set<string>();
    if (countryFilterIds.length > 0) {
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

    const baseFiltered = mergedRows.filter(({ data }) => {
      const rec = data as Record<string, unknown>;
      if (isProjectRecordCompletedRaw(rec)) return false;
      const recProjectId = String(rec.project_id ?? "").trim();
      const countryOk =
        countryFilterIds.length === 0 ||
        countryFilterIds.includes(String(rec.country_id ?? "").trim()) ||
        (recProjectId ? allowedProjectIdsByCountry.has(recProjectId) : false);
      const farmOk =
        farmFilterIds.length === 0 ||
        farmFilterIds.some((id) => rowHasFarmInSubitems(data as MondayProjectServerRow, id));
      const grassOk =
        grassFilterIds.length === 0 ||
        grassFilterIds.some((id) => rowHasGrassProduct(data as MondayProjectServerRow, id));
      return countryOk && farmOk && grassOk;
    });

    let list = baseFiltered;

    if (applyDashboardDeliveryKpi && dashboardKpiPeriodParsed) {
      list = baseFiltered.filter(({ data }) =>
        rowMatchesDashboardActiveProjectsKpi(data as MondayProjectServerRow, {
          excludeProjectsWithoutFarm: dashboardExcludeNoFarm,
          selectedFarmIdSet,
          excludeCompleted: true,
          deliveryMatch: (r) => projectHasSubitemDeliveryInKpiPeriod(r, dashboardKpiPeriodParsed),
        }),
      );

      const byProjectKey = new Map<string, (typeof list)[number]>();
      for (const entry of list) {
        const rec = entry.data as Record<string, unknown>;
        const pid = String(rec.project_id ?? rec.id ?? "").trim();
        const rowKey = String(rec.row_id ?? rec.id ?? "").trim();
        const dedupeKey = pid || `row:${rowKey}`;
        if (!dedupeKey || dedupeKey === "row:") continue;
        if (!byProjectKey.has(dedupeKey)) byProjectKey.set(dedupeKey, entry);
      }
      list = Array.from(byProjectKey.values());
    }

    return list;
  }, [
    rows,
    countryFilterIds,
    farmFilterIds,
    grassFilterIds,
    applyDashboardDeliveryKpi,
    dashboardKpiPeriodParsed,
    dashboardExcludeNoFarm,
    selectedFarmIdSet,
  ]);

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

  const filterTriggerIcon = (
    <>
      <AlignLeft className="h-3.5 w-3.5 shrink-0" />
      <ArrowDown className="h-3.5 w-3.5 shrink-0" />
    </>
  );

  const multiSelectBaseClass =
    "min-w-0 w-full rounded-md border border-input text-sm text-foreground hover:bg-btnhover/40";

  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="space-y-6 p-4 lg:p-8">
          <div>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              {t("ActiveProjects.backToDashboard")}
            </Link>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Briefcase className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="font-heading text-2xl font-bold text-foreground">
                {t("Dashboard.kpiActiveProjects")}
              </h1>
              <p className="text-sm text-muted-foreground">
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    {t("Common.loading")}
                  </span>
                ) : (
                  t("ActiveProjects.countActive", { count: projects.length })
                )}
              </p>
            </div>
          </div>

          <div className="glass-card space-y-4 rounded-xl p-5">
            <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
              <MultiSelect
                options={countryOptions.map((c) => ({ value: c.id, label: c.name }))}
                values={countryFilterIds}
                onChange={setCountryFilterIds}
                placeholder={t("ActiveProjects.allCountries")}
                className={cn(multiSelectBaseClass, bgSurfaceFilter(countryFilterIds.length > 0))}
                rightIcon={filterTriggerIcon}
              />
              <MultiSelect
                options={farmOptions.map((f) => ({ value: f.id, label: f.name }))}
                values={farmFilterIds}
                onChange={(ids) => setHarvestListFarmFilter(ids.join(","))}
                placeholder={t("ActiveProjects.allFarms")}
                className={cn(multiSelectBaseClass, bgSurfaceFilter(farmFilterIds.length > 0))}
                rightIcon={filterTriggerIcon}
              />
              <MultiSelect
                options={grassOptions.map((g) => ({ value: g.id, label: g.name }))}
                values={grassFilterIds}
                onChange={setGrassFilterIds}
                placeholder={t("ActiveProjects.allGrass")}
                className={cn(multiSelectBaseClass, bgSurfaceFilter(grassFilterIds.length > 0))}
                rightIcon={filterTriggerIcon}
              />
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            {loading ? null : projects.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {t("ActiveProjects.noMatch")}
              </p>
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
                    <span>{t("ActiveProjects.updatingList")}</span>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </DashboardLayout>
    </RequireAuth>
  );
}

export default function ActiveProjectsPage() {
  return (
    <Suspense
      fallback={
        <RequireAuth>
          <DashboardLayout>
            <div className="flex min-h-[40vh] items-center justify-center p-8 text-sm text-muted-foreground">
              Loading…
            </div>
          </DashboardLayout>
        </RequireAuth>
      }
    >
      <ActiveProjectsPageInner />
    </Suspense>
  );
}
