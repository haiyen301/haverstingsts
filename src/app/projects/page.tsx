"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlignLeft, ArrowDown, Plus, Search, Upload } from "lucide-react";

import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import RequireAuth from "@/features/auth/RequireAuth";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  fetchMondayProjectRowsFromServer,
  type MondayDynamicRowLike,
  type MondayProjectServerRow,
  type ProjectStatus,
} from "@/entities/projects";
import {
  ProjectListItem,
  buildMondayEditArgs,
  mergeMondayDisplayData,
  resolveMondayCardStatusForListFilter,
  sortMondayProjectRows,
} from "@/features/project";
import { parseJsonMaybe } from "@/shared/lib/parseJsonMaybe";
import { resolveStaffAvatarImageUrl } from "@/features/project/lib/staffAvatarUrl";

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
  const returnTo = useMemo(() => {
    const query = searchParams.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [countryFilterIds, setCountryFilterIds] = useState<string[]>([]);
  const [grassFilterIds, setGrassFilterIds] = useState<string[]>([]);
  const [statusFilterValues, setStatusFilterValues] = useState<string[]>([
    "Ongoing",
    "Future",
  ]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<MondayProjectServerRow[]>([]);
  const projectsRef = useHarvestingDataStore((s) => s.projects);
  const countriesRef = useHarvestingDataStore((s) => s.countries);
  const staffsRef = useHarvestingDataStore((s) => s.staffs);
  const productsRef = useHarvestingDataStore((s) => s.products);
  const fetchAllHarvestingReferenceData = useHarvestingDataStore(
    (s) => s.fetchAllHarvestingReferenceData,
  );

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
    let mounted = true;
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        const statusQuery = statusFilterValues
          .map((x) => normalizeProjectStatusLabel(x))
          .filter(Boolean)
          .join(",");
        const res = await fetchMondayProjectRowsFromServer({
          module: "project",
          search: debouncedSearch || undefined,
          page: 1,
          perPage: 100,
          status: statusQuery || undefined,
        });
        if (!mounted) return;
        const rawRows = res.rows as unknown as Record<string, unknown>[];
        setRows(sortMondayProjectRows(rawRows));
      } catch (e) {
        if (!mounted) return;
        setRows([]);
        setError(e instanceof Error ? e.message : "Failed to load projects.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [debouncedSearch, statusFilterValues]);

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
        rows.find((row) => String(row.row_id ?? row.id ?? "").trim() === rowId) ??
        null;

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
      const grassOk =
        grassFilterIds.length === 0 ||
        grassFilterIds.some((id) => rowHasGrassProduct(data as MondayProjectServerRow, id));
      return countryOk && grassOk;
    });
  }, [rows, countryFilterIds, grassFilterIds]);

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

  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="p-4 lg:p-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
            <h1 className="text-2xl lg:text-3xl font-semibold text-gray-900">
              Projects
            </h1>
            <div className="flex items-center gap-2">
              <button
                onClick={() => router.push("/projects/import")}
                className="flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                type="button"
              >
                <Upload className="w-5 h-5" />
                Import Excel
              </button>
              <button
                onClick={() =>
                  router.push(
                    `/projects/new?returnTo=${encodeURIComponent(returnTo)}`,
                  )
                }
                className="flex items-center justify-center gap-2 px-4 py-2 bg-button-primary text-white rounded-lg hover:bg-[#196A40] transition-colors"
                type="button"
              >
                <Plus className="w-5 h-5" />
                New Project
              </button>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6 space-y-4">
            <div className="relative">
              <input
                type="search"
                placeholder="Searching name of project, grass, country,..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-full border border-gray-300 pl-4 pr-12 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent"
                autoComplete="off"
              />
              <Search className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">

              <div className="flex w-full items-center gap-1">
                <MultiSelect
                  options={countryOptions.map((c) => ({ value: c.id, label: c.name }))}
                  values={countryFilterIds}
                  onChange={setCountryFilterIds}
                  placeholder="All countries"
                  rightIcon={
                    <>
                      <AlignLeft className="h-3.5 w-3.5" />
                      <ArrowDown className="h-3.5 w-3.5" />
                    </>
                  }
                />
              </div>

              <div className="flex w-full items-center gap-1">
                <MultiSelect
                  options={grassOptions.map((g) => ({ value: g.id, label: g.name }))}
                  values={grassFilterIds}
                  onChange={setGrassFilterIds}
                  placeholder="All grass"
                  rightIcon={
                    <>
                      <AlignLeft className="h-3.5 w-3.5" />
                      <ArrowDown className="h-3.5 w-3.5" />
                    </>
                  }
                />
              </div>

              <div className="flex w-full items-center gap-1">
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
                  rightIcon={
                    <>
                      <AlignLeft className="h-3.5 w-3.5" />
                      <ArrowDown className="h-3.5 w-3.5" />
                    </>
                  }
                />
              </div>

            </div>
          </div>



          {/* 2 columns per row using grid */}
          {error ? (
            <p className="text-sm text-red-600 mb-3">{error}</p>
          ) : null}
          {loading ? (
            <p className="text-sm text-gray-600">Loading projects...</p>
          ) : projects.length === 0 ? (
            <p className="text-sm text-gray-600">No projects found.</p>
          ) : (
            <div className="grid grid-cols-1 gap-6 min-[1300px]:grid-cols-2">
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
                    router.push(
                      `/projects/detail?rowId=${encodeURIComponent(args.rowId ?? "")}&tableId=${encodeURIComponent(args.tableId ?? "")}`,
                    );
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </DashboardLayout>
    </RequireAuth>
  );
}
