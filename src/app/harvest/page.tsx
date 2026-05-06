"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Search,
  Plus,
  ChevronLeft,
  ChevronRight,
  AlignLeft,
  ArrowDown,
  Upload,
  Filter,
  CheckCircle2,
  Clock,
  Calendar,
  CalendarClock,
} from "lucide-react";

import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import RequireAuth from "@/features/auth/RequireAuth";
import { stsProxyGetHarvestingIndex } from "@/shared/api/stsProxyClient";
import { useAuthUserStore } from "@/shared/store/authUserStore";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import {
  mapRowsToSelectOptions,
  zoneIdToLabel,
} from "@/shared/lib/harvestReferenceData";
import { formatNumber } from "@/shared/lib/format/number";
import { MultiSelect } from "@/components/ui/multi-select";
import { SortableTh } from "@/components/ui/sortable-th";
import { useTableColumnSort } from "@/shared/hooks/useTableColumnSort";
import {
  compareIsoDateStrings,
  compareNumbers,
  compareStrings,
} from "@/shared/lib/tableSort";
import { cn } from "@/lib/utils";
import { bgSurfaceFilter } from "@/shared/lib/surfaceFilter";

const PER_PAGE = 30;

function isValidHarvestDateString(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s || s === "0000-00-00") return false;
  return true;
}

/** Same lifecycle rule as Harvesting Portal `deriveHarvestStatus`: delivery → harvested → scheduled → planned. */
export type HarvestPortalStatus =
  | "planned"
  | "scheduled"
  | "harvested"
  | "delivered";

const PORTAL_STATUS_ORDER: HarvestPortalStatus[] = [
  "planned",
  "scheduled",
  "harvested",
  "delivered",
];

const PORTAL_STATUS_RANK: Record<HarvestPortalStatus, number> = {
  planned: 0,
  scheduled: 1,
  harvested: 2,
  delivered: 3,
};

function deriveHarvestPortalStatus(
  r: Record<string, unknown>,
): HarvestPortalStatus {
  if (isValidHarvestDateString(r.delivery_harvest_date)) return "delivered";
  if (isValidHarvestDateString(r.actual_harvest_date)) return "harvested";
  if (isValidHarvestDateString(r.estimated_harvest_date)) return "scheduled";
  return "planned";
}

/** UI labels for portal-style status values (`harvest_status` API filter). */
function harvestStatusDisplayLabel(
  status: string,
  t: ReturnType<typeof useTranslations<"Harvest">>,
): string {
  const lower = status.toLowerCase();
  if (lower === "planned") return t("harvestStatus_planned");
  if (lower === "scheduled") return t("harvestStatus_scheduled");
  if (lower === "harvested") return t("harvestStatus_harvested");
  if (lower === "delivered") return t("harvestStatus_delivered");
  return status;
}

/** Harvesting Portal–style status: icon + semantic color. */
function HarvestStatusCell({
  status,
  t,
}: {
  status: string;
  t: ReturnType<typeof useTranslations<"Harvest">>;
}) {
  const lower = status.toLowerCase();
  const label = harvestStatusDisplayLabel(status, t);

  const wrap = (tone: string, Icon: typeof Clock) => (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium ${tone}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {label}
    </span>
  );

  if (lower === "delivered") {
    return wrap("text-primary", CheckCircle2);
  }
  if (lower === "harvested") {
    return wrap("text-warning", Clock);
  }
  if (lower === "scheduled") {
    return wrap("text-accent", Calendar);
  }
  return wrap("text-info", CalendarClock);
}

/**
 * Display date: prefer actual harvest date; if missing or invalid, use estimated.
 */
function pickHarvestDisplayDate(r: Record<string, unknown>): string {
  const actual = r.actual_harvest_date;
  const est = r.estimated_harvest_date;
  if (isValidHarvestDateString(actual)) return actual.trim().slice(0, 10);
  if (isValidHarvestDateString(est)) return est.trim().slice(0, 10);
  return "";
}

export type HarvestListRow = {
  id: string;
  customer: string;
  estimatedDate: string;
  actualDate: string;
  deliveryDate: string;
  date: string;
  project: string;
  farm: string;
  grass: string;
  zone: string;
  harvestType: string;
  harvestedArea: number;
  kgPerM2: number;
  doSoNumber: string;
  qty: number;
  /** Portal lifecycle status (delivery → actual → estimate). */
  status: HarvestPortalStatus;
  qtyLabel: string;
};

function sumHarvestQty(list: HarvestListRow[]): number {
  return list.reduce((s, r) => s + r.qty, 0);
}

function parseApiNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function parseCsvFilter(value: string): string[] {
  return String(value ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function toCsvFilter(values: string[]): string {
  return Array.from(new Set(values.map((x) => String(x).trim()).filter(Boolean))).join(",");
}

function parsePageParam(v: string | null): number {
  const n = parseInt(String(v ?? "").trim(), 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
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

type HarvestSortKey =
  | "id"
  | "date"
  | "project"
  | "farm"
  | "grass"
  | "zone"
  | "qty"
  | "status";

function normalizeHarvestRow(raw: unknown): HarvestListRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = r.id;
  if (id === undefined || id === null) return null;
  const dateStr = pickHarvestDisplayDate(r);
  const qty = Number(r.quantity);
  const q = Number.isFinite(qty) ? qty : 0;
  const harvestedAreaRaw = Number(r.harvested_area);
  const harvestedArea = Number.isFinite(harvestedAreaRaw) ? harvestedAreaRaw : 0;
  const kgPerM2Raw = Number(r.kg_per_m2);
  const kgPerM2 =
    Number.isFinite(kgPerM2Raw) && kgPerM2Raw > 0
      ? kgPerM2Raw
      : harvestedArea > 0
        ? q / harvestedArea
        : 0;
  const uom = String(r.uom ?? "").trim();
  return {
    id: String(id),
    customer: String(r.customer_name ?? r.customer ?? ""),
    estimatedDate: isValidHarvestDateString(r.estimated_harvest_date)
      ? String(r.estimated_harvest_date).trim().slice(0, 10)
      : "",
    actualDate: isValidHarvestDateString(r.actual_harvest_date)
      ? String(r.actual_harvest_date).trim().slice(0, 10)
      : "",
    deliveryDate: isValidHarvestDateString(r.delivery_harvest_date)
      ? String(r.delivery_harvest_date).trim().slice(0, 10)
      : "",
    date: dateStr,
    project: String(r.project_name ?? ""),
    farm: String(r.farm_name ?? ""),
    grass: String(r.grass_name ?? ""),
    zone: String(r.zone ?? ""),
    harvestType: String(r.harvest_type ?? r.load_type ?? ""),
    harvestedArea,
    kgPerM2,
    doSoNumber: String(r.do_so_number ?? ""),
    qty: q,
    status: deriveHarvestPortalStatus(r),
    qtyLabel: uom ? `${q.toLocaleString()} ${uom}` : q.toLocaleString(),
  };
}

export default function HarvestListPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("Harvest");
  const userId = useAuthUserStore((s) => s.user?.id);
  const farms = useHarvestingDataStore((s) => s.farms);
  const projects = useHarvestingDataStore((s) => s.projects);
  const grasses = useHarvestingDataStore((s) => s.grasses);
  const farmZones = useHarvestingDataStore((s) => s.farmZones);
  const refLoading = useHarvestingDataStore((s) => s.loading);
  const fetchAllHarvestingReferenceData = useHarvestingDataStore(
    (s) => s.fetchAllHarvestingReferenceData,
  );

  const harvestListSearch = useHarvestingDataStore((s) => s.harvestListSearch);
  const setHarvestListSearch = useHarvestingDataStore(
    (s) => s.setHarvestListSearch,
  );
  const harvestListFarmFilter = useHarvestingDataStore(
    (s) => s.harvestListFarmFilter,
  );
  const setHarvestListFarmFilter = useHarvestingDataStore(
    (s) => s.setHarvestListFarmFilter,
  );
  const harvestListProjectFilter = useHarvestingDataStore(
    (s) => s.harvestListProjectFilter,
  );
  const setHarvestListProjectFilter = useHarvestingDataStore(
    (s) => s.setHarvestListProjectFilter,
  );
  const harvestListGrassFilter = useHarvestingDataStore(
    (s) => s.harvestListGrassFilter,
  );
  const setHarvestListGrassFilter = useHarvestingDataStore(
    (s) => s.setHarvestListGrassFilter,
  );
  const harvestListStatusFilter = useHarvestingDataStore(
    (s) => s.harvestListStatusFilter,
  );
  const setHarvestListStatusFilter = useHarvestingDataStore(
    (s) => s.setHarvestListStatusFilter,
  );

  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [rows, setRows] = useState<HarvestListRow[]>([]);
  const [statusCardTotals, setStatusCardTotals] = useState<
    Record<HarvestPortalStatus, { count: number; kg: number }>
  >({
    planned: { count: 0, kg: 0 },
    scheduled: { count: 0, kg: 0 },
    harvested: { count: 0, kg: 0 },
    delivered: { count: 0, kg: 0 },
  });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState<number | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [urlReady, setUrlReady] = useState(false);
  const searchParamsKey = searchParams.toString();

  useLayoutEffect(() => {
    const parsed = new URLSearchParams(searchParamsKey);
    const q = parsed.get("q") ?? "";
    const farm = parsed.get("farm") ?? "";
    const grass = parsed.get("grass") ?? "";
    const project = parsed.get("project") ?? "";
    const status = parsed.get("status") ?? "";
    const p = parsePageParam(parsed.get("page"));
    setHarvestListSearch(q);
    setHarvestListFarmFilter(farm);
    setHarvestListGrassFilter(grass);
    setHarvestListProjectFilter(project);
    setHarvestListStatusFilter(status);
    setPage(p);
    setDebouncedSearch(q.trim());
    setUrlReady(true);
  }, [
    searchParamsKey,
    setHarvestListFarmFilter,
    setHarvestListGrassFilter,
    setHarvestListProjectFilter,
    setHarvestListSearch,
    setHarvestListStatusFilter,
  ]);

  const returnTo = useMemo(() => {
    const params = new URLSearchParams();
    const q = harvestListSearch.trim();
    if (q) params.set("q", q);
    if (harvestListFarmFilter.trim()) params.set("farm", harvestListFarmFilter.trim());
    if (harvestListGrassFilter.trim())
      params.set("grass", harvestListGrassFilter.trim());
    if (harvestListProjectFilter.trim()) params.set("project", harvestListProjectFilter.trim());
    if (harvestListStatusFilter.trim()) params.set("status", harvestListStatusFilter.trim());
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    const base = pathname || "/harvest";
    return qs ? `${base}?${qs}` : base;
  }, [
    harvestListFarmFilter,
    harvestListGrassFilter,
    harvestListProjectFilter,
    harvestListSearch,
    harvestListStatusFilter,
    page,
    pathname,
  ]);

  useEffect(() => {
    if (!urlReady) return;
    const params = new URLSearchParams();
    const q = harvestListSearch.trim();
    if (q) params.set("q", q);
    if (harvestListFarmFilter.trim()) params.set("farm", harvestListFarmFilter.trim());
    if (harvestListGrassFilter.trim())
      params.set("grass", harvestListGrassFilter.trim());
    if (harvestListProjectFilter.trim()) params.set("project", harvestListProjectFilter.trim());
    if (harvestListStatusFilter.trim()) params.set("status", harvestListStatusFilter.trim());
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    if (urlSearchParamsEquivalent(qs, searchParamsKey)) return;
    const base = pathname || "/harvest";
    router.replace(qs ? `${base}?${qs}` : base, { scroll: false });
  }, [
    harvestListFarmFilter,
    harvestListGrassFilter,
    harvestListProjectFilter,
    harvestListSearch,
    harvestListStatusFilter,
    page,
    pathname,
    router,
    searchParamsKey,
    urlReady,
  ]);

  const { sortKey, sortDir, onSort } = useTableColumnSort<HarvestSortKey>(
    "id",
    "desc",
  );

  const sortedRows = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      switch (sortKey) {
        case "id":
          return compareNumbers(Number(a.id), Number(b.id), sortDir);
        case "date":
          return compareIsoDateStrings(a.date, b.date, sortDir);
        case "project":
          return compareStrings(a.project, b.project, sortDir);
        case "farm":
          return compareStrings(a.farm, b.farm, sortDir);
        case "grass":
          return compareStrings(a.grass, b.grass, sortDir);
        case "zone":
          return compareStrings(a.zone, b.zone, sortDir);
        case "qty":
          return compareNumbers(a.qty, b.qty, sortDir);
        case "status":
          return compareNumbers(
            PORTAL_STATUS_RANK[a.status],
            PORTAL_STATUS_RANK[b.status],
            sortDir,
          );
        default:
          return 0;
      }
    });
    return list;
  }, [rows, sortKey, sortDir]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(harvestListSearch.trim()), 400);
    return () => clearTimeout(t);
  }, [harvestListSearch]);

  useEffect(() => {
    void fetchAllHarvestingReferenceData();
  }, [fetchAllHarvestingReferenceData]);

  const farmOptions = useMemo(
    () => mapRowsToSelectOptions(farms as unknown[], "name"),
    [farms],
  );
  const projectOptions = useMemo(
    () => mapRowsToSelectOptions(projects as unknown[], "title"),
    [projects],
  );
  const grassOptions = useMemo(
    () => mapRowsToSelectOptions(grasses as unknown[], "title"),
    [grasses],
  );

  const loadList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const params: Record<string, string | number | undefined> = {
        page,
        per_page: PER_PAGE,
        user_id: userId,
      };
      if (debouncedSearch) params.search = debouncedSearch;
      if (harvestListFarmFilter) params.farm_id = harvestListFarmFilter;
      if (harvestListGrassFilter.trim())
        params.product_id = harvestListGrassFilter.trim();
      if (harvestListProjectFilter) params.project_id = harvestListProjectFilter;
      if (harvestListStatusFilter) params.harvest_status = harvestListStatusFilter;

      const res = await stsProxyGetHarvestingIndex(params);
      const normalized = res.rows
        .map(normalizeHarvestRow)
        .filter((x): x is HarvestListRow => x !== null);
      setRows(normalized);
      setTotalPages(res.totalPages);
      setTotalRecords(
        res.totalRecords != null
          ? res.totalRecords
          : res.totalPages === 1
            ? normalized.length
            : page === res.totalPages
              ? (res.totalPages - 1) * PER_PAGE + normalized.length
              : null,
      );
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : t("loadError");
      setListError(msg);
      setRows([]);
      setTotalRecords(null);
    } finally {
      setListLoading(false);
    }
  }, [
    page,
    debouncedSearch,
    harvestListFarmFilter,
    harvestListGrassFilter,
    harvestListProjectFilter,
    harvestListStatusFilter,
    userId,
  ]);

  const loadStatusCardTotals = useCallback(async () => {
    try {
      const commonParams: Record<string, string | number | undefined> = {
        page: 1,
        per_page: 1,
        user_id: userId,
      };
      if (debouncedSearch) commonParams.search = debouncedSearch;
      if (harvestListFarmFilter) commonParams.farm_id = harvestListFarmFilter;
      if (harvestListGrassFilter.trim())
        commonParams.product_id = harvestListGrassFilter.trim();
      if (harvestListProjectFilter) commonParams.project_id = harvestListProjectFilter;

      const responses = await Promise.all(
        PORTAL_STATUS_ORDER.map(async (status) => {
          const res = await stsProxyGetHarvestingIndex({
            ...commonParams,
            harvest_status: status,
          });
          return {
            status,
            count: res.totalRecords ?? 0,
            kg: parseApiNumber(res.totalKg),
          };
        }),
      );

      setStatusCardTotals({
        planned: responses.find((x) => x.status === "planned") ?? {
          count: 0,
          kg: 0,
        },
        scheduled: responses.find((x) => x.status === "scheduled") ?? {
          count: 0,
          kg: 0,
        },
        harvested: responses.find((x) => x.status === "harvested") ?? {
          count: 0,
          kg: 0,
        },
        delivered: responses.find((x) => x.status === "delivered") ?? {
          count: 0,
          kg: 0,
        },
      });
    } catch {
      setStatusCardTotals({
        planned: { count: 0, kg: 0 },
        scheduled: { count: 0, kg: 0 },
        harvested: { count: 0, kg: 0 },
        delivered: { count: 0, kg: 0 },
      });
    }
  }, [
    debouncedSearch,
    harvestListFarmFilter,
    harvestListGrassFilter,
    harvestListProjectFilter,
    userId,
  ]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    void loadStatusCardTotals();
  }, [loadStatusCardTotals]);

  const zoneLabel = useCallback(
    (zoneId: string) => zoneIdToLabel(zoneId, farmZones),
    [farmZones],
  );
  const pageStart = rows.length > 0 ? (page - 1) * PER_PAGE + 1 : 0;
  const pageEnd = rows.length > 0 ? pageStart + rows.length - 1 : 0;
  const approxTotalLabel = formatNumber(totalPages * PER_PAGE);
  const totalForRangeLabel =
    totalRecords != null
      ? formatNumber(totalRecords)
      : `${approxTotalLabel}+`;

  const rowsByPortalStatus = useMemo(() => {
    const m: Record<HarvestPortalStatus, HarvestListRow[]> = {
      planned: [],
      scheduled: [],
      harvested: [],
      delivered: [],
    };
    for (const r of rows) {
      m[r.status].push(r);
    }
    return m;
  }, [rows]);

  const statusFilterValues = parseCsvFilter(harvestListStatusFilter);

  const toggleHarvestPortalStatusCard = (v: HarvestPortalStatus) => {
    const only =
      statusFilterValues.length === 1 && statusFilterValues[0] === v;
    setHarvestListStatusFilter(only ? "" : v);
    setHarvestListProjectFilter("");
    setPage(1);
  };

  const farmFilterIds = parseCsvFilter(harvestListFarmFilter);
  const handleFarmPillChange = (farmId: string | null) => {
    if (!farmId) {
      setHarvestListFarmFilter("");
      setHarvestListGrassFilter("");
      setHarvestListProjectFilter("");
      setHarvestListStatusFilter("");
      setPage(1);
      return;
    }
    const next = new Set(farmFilterIds);
    if (next.has(farmId)) next.delete(farmId);
    else next.add(farmId);
    setHarvestListFarmFilter(toCsvFilter(Array.from(next)));
    setHarvestListGrassFilter("");
    setHarvestListProjectFilter("");
    setHarvestListStatusFilter("");
    setPage(1);
  };

  const handleGrassFilterChange = (grassIds: string[]) => {
    setHarvestListGrassFilter(toCsvFilter(grassIds));
    setHarvestListProjectFilter("");
    setHarvestListStatusFilter("");
    setPage(1);
  };

  const handleStatusSelectChange = (statuses: string[]) => {
    setHarvestListStatusFilter(toCsvFilter(statuses));
    setHarvestListProjectFilter("");
    setPage(1);
  };

  const handleProjectSelectChange = (projectIds: string[]) => {
    setHarvestListProjectFilter(toCsvFilter(projectIds));
    setPage(1);
  };

  const grassSelectValues = parseCsvFilter(harvestListGrassFilter);
  const statusSelectValues = parseCsvFilter(harvestListStatusFilter);
  const projectSelectValues = parseCsvFilter(harvestListProjectFilter);

  const hasActiveFilters =
    harvestListSearch.trim() !== "" ||
    harvestListFarmFilter.trim() !== "" ||
    harvestListGrassFilter.trim() !== "" ||
    harvestListProjectFilter.trim() !== "" ||
    harvestListStatusFilter.trim() !== "";

  const clearAllFilters = () => {
    setHarvestListSearch("");
    setHarvestListFarmFilter("");
    setHarvestListGrassFilter("");
    setHarvestListProjectFilter("");
    setHarvestListStatusFilter("");
    setPage(1);
  };

  const statusIsOnly = (value: HarvestPortalStatus) =>
    statusFilterValues.length === 1 && statusFilterValues[0] === value;

  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="dashboard-harvesting-skin min-h-full min-w-0 flex-1 p-4 lg:p-8">
          <div className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-heading text-2xl font-bold text-foreground">
                  {t("title")}
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {listLoading
                    ? "…"
                    : totalRecords != null
                      ? t("recordsCount", { count: formatNumber(totalRecords) })
                      : t("recordsCountPlus", {
                          count: formatNumber((page - 1) * PER_PAGE + rows.length),
                        })}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => router.push("/harvest/import")}
                  className="flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/80"
                  type="button"
                >
                  <Upload className="h-4 w-4" />
                  {t("importExcel")}
                </button>
                <button
                  onClick={() =>
                    router.push(
                      `/harvest/new?returnTo=${encodeURIComponent(returnTo)}`,
                    )
                  }
                  className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  type="button"
                >
                  <Plus className="h-4 w-4" />
                  {t("newHarvest")}
                </button>
              </div>
            </div>
            
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleFarmPillChange(null)}
                disabled={refLoading}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  farmFilterIds.length === 0
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {t("allFarms")}
              </button>
              {farmOptions.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => handleFarmPillChange(o.id)}
                  disabled={refLoading}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    farmFilterIds.includes(o.id)
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {o.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <button
                type="button"
                onClick={() => toggleHarvestPortalStatusCard("planned")}
                className={`glass-card rounded-xl p-3 text-center transition-all hover:scale-[1.02] hover:shadow-md cursor-pointer ${
                  statusIsOnly("planned") ? "ring-2 ring-info" : ""
                }`}
                aria-pressed={statusIsOnly("planned")}
                title={t("titlePlannedCard")}
              >
                <p className="text-xs text-muted-foreground">
                  {t("harvestStatus_planned")}
                </p>
                <p className="text-lg font-bold text-info">
                  {statusCardTotals.planned.count.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("kgValue", {
                    value: statusCardTotals.planned.kg.toLocaleString(),
                  })}
                </p>
              </button>
              <button
                type="button"
                onClick={() => toggleHarvestPortalStatusCard("scheduled")}
                className={`glass-card rounded-xl p-3 text-center transition-all hover:scale-[1.02] hover:shadow-md cursor-pointer ${
                  statusIsOnly("scheduled") ? "ring-2 ring-accent" : ""
                }`}
                aria-pressed={statusIsOnly("scheduled")}
                title={t("titleScheduledCard")}
              >
                <p className="text-xs text-muted-foreground">
                  {t("harvestStatus_scheduled")}
                </p>
                <p className="text-lg font-bold text-accent">
                  {statusCardTotals.scheduled.count.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("kgValue", {
                    value: statusCardTotals.scheduled.kg.toLocaleString(),
                  })}
                </p>
              </button>
              <button
                type="button"
                onClick={() => toggleHarvestPortalStatusCard("harvested")}
                className={`glass-card rounded-xl p-3 text-center transition-all hover:scale-[1.02] hover:shadow-md cursor-pointer ${
                  statusIsOnly("harvested") ? "ring-2 ring-warning" : ""
                }`}
                aria-pressed={statusIsOnly("harvested")}
                title={t("titleHarvestedCard")}
              >
                <p className="text-xs text-muted-foreground">
                  {t("harvestStatus_harvested")}
                </p>
                <p className="text-lg font-bold text-warning">
                  {statusCardTotals.harvested.count.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("kgValue", {
                    value: statusCardTotals.harvested.kg.toLocaleString(),
                  })}
                </p>
              </button>
              <button
                type="button"
                onClick={() => toggleHarvestPortalStatusCard("delivered")}
                className={`glass-card rounded-xl p-3 text-center transition-all hover:scale-[1.02] hover:shadow-md cursor-pointer ${
                  statusIsOnly("delivered") ? "ring-2 ring-primary" : ""
                }`}
                aria-pressed={statusIsOnly("delivered")}
                title={t("titleDeliveredCard")}
              >
                <p className="text-xs text-muted-foreground">
                  {t("harvestStatus_delivered")}
                </p>
                <p className="text-lg font-bold text-primary">
                  {statusCardTotals.delivered.count.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("kgValue", {
                    value: statusCardTotals.delivered.kg.toLocaleString(),
                  })}
                </p>
              </button>
            </div>

           

            <div className="glass-card rounded-xl p-4">
              <div className="flex flex-wrap items-center gap-3">
                <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="relative w-full min-w-0 md:w-auto md:min-w-[280px] md:flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder={t("searchPlaceholder")}
                    value={harvestListSearch}
                    onChange={(e) => {
                      setHarvestListSearch(e.target.value);
                      setPage(1);
                    }}
                    className={cn(
                      "w-full rounded-lg border border-input py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring",
                      bgSurfaceFilter(!!harvestListSearch.trim()),
                    )}
                    autoComplete="off"
                  />
                </div>
                <div className="flex w-full min-w-0 items-center gap-1 sm:w-auto">
                  <MultiSelect
                    options={grassOptions.map((g) => ({
                      value: g.id,
                      label: g.label,
                    }))}
                    values={grassSelectValues}
                    onChange={handleGrassFilterChange}
                    placeholder={t("allGrassTypes", { count: grassOptions.length })}
                    disabled={refLoading}
                    className={cn(
                      "rounded-md border border-input min-w-[220px]",
                      bgSurfaceFilter(grassSelectValues.length > 0),
                    )}
                    rightIcon={
                      <>
                        <AlignLeft className="h-3.5 w-3.5" />
                        <ArrowDown className="h-3.5 w-3.5" />
                      </>
                    }
                  />
                </div>
                <div className="flex w-full min-w-0 items-center gap-1 sm:w-auto">
                  <MultiSelect
                    options={PORTAL_STATUS_ORDER.map((s) => ({
                      value: s,
                      label: harvestStatusDisplayLabel(s, t),
                    }))}
                    values={statusSelectValues}
                    onChange={handleStatusSelectChange}
                    disabled={PORTAL_STATUS_ORDER.length === 0}
                    placeholder={t("allStatuses", {
                      count: PORTAL_STATUS_ORDER.length,
                    })}
                    className={cn(
                      "rounded-md border border-input min-w-[220px]",
                      bgSurfaceFilter(statusSelectValues.length > 0),
                    )}
                    rightIcon={
                      <>
                        <AlignLeft className="h-3.5 w-3.5" />
                        <ArrowDown className="h-3.5 w-3.5" />
                      </>
                    }
                  />
                </div>
                <div className="flex w-full min-w-0 items-center gap-1 sm:w-auto">
                  <MultiSelect
                    options={projectOptions.map((p) => ({
                      value: p.id,
                      label: p.label,
                    }))}
                    values={projectSelectValues}
                    onChange={handleProjectSelectChange}
                    disabled={refLoading || projectOptions.length === 0}
                    placeholder={t("allProjectsCount", {
                      count: projectOptions.length,
                    })}
                    className={cn(
                      "rounded-md border border-input min-w-[220px]",
                      bgSurfaceFilter(projectSelectValues.length > 0),
                    )}
                    rightIcon={
                      <>
                        <AlignLeft className="h-3.5 w-3.5" />
                        <ArrowDown className="h-3.5 w-3.5" />
                      </>
                    }
                  />
                </div>
                {hasActiveFilters ? (
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {t("clearAll")}
                  </button>
                ) : null}
              </div>
            </div>

            {listError ? (
              <p className="text-sm text-destructive" role="alert">
                {listError}
              </p>
            ) : null}

            {totalPages > 1 ? (
              <div className="flex items-center justify-between">
                <p className="text-sm text-foreground">
                  {t("rangeOfTotal", {
                    start: pageStart,
                    end: pageEnd,
                    total: totalForRangeLabel,
                  })}
                </p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={listLoading || page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-muted/50 text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label={t("prevPageAria")}
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    disabled={listLoading || page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-muted/50 text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label={t("nextPageAria")}
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </div>
              </div>
            ) : null}

            <div className="glass-card overflow-hidden rounded-xl">
              {listLoading ? (
                <p className="p-6 text-sm text-muted-foreground">
                  {t("loadingEllipsis")}
                </p>
              ) : rows.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">
                  {t("empty")}
                </p>
              ) : (
                <>
                  <div className="hidden overflow-x-auto lg:block">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/50">
                          <th className="py-3 pl-4 pr-2 text-left text-xs font-medium text-muted-foreground">
                            {t("id")}
                          </th>
                          <th className="hidden xl:table-cell px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                            {t("customer")}
                          </th>
                          <SortableTh
                            label={t("project")}
                            columnKey="project"
                            activeKey={sortKey}
                            direction={sortDir}
                            onSort={onSort}
                            className="py-3 px-4"
                          />
                          <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                            {t("estDate")}
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                            {t("harvestDate")}
                          </th>
                          <SortableTh
                            label={t("farm")}
                            columnKey="farm"
                            activeKey={sortKey}
                            direction={sortDir}
                            onSort={onSort}
                            className="py-3 px-4"
                          />
                          <SortableTh
                            label={t("grass")}
                            columnKey="grass"
                            activeKey={sortKey}
                            direction={sortDir}
                            onSort={onSort}
                            className="py-3 px-4"
                          />
                          <SortableTh
                            label={t("zone")}
                            columnKey="zone"
                            activeKey={sortKey}
                            direction={sortDir}
                            onSort={onSort}
                            className="py-3 px-4"
                          />
                          <th className="hidden xl:table-cell px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                            {t("type")}
                          </th>
                          <th className="hidden 2xl:table-cell px-4 py-3 text-right text-xs font-medium text-muted-foreground">
                            {t("areaM2")}
                          </th>
                          <SortableTh
                            label={t("qty")}
                            columnKey="qty"
                            activeKey={sortKey}
                            direction={sortDir}
                            onSort={onSort}
                            align="right"
                            className="py-3 pl-4 pr-4"
                          />
                          <th className="hidden 2xl:table-cell px-4 py-3 text-right text-xs font-medium text-muted-foreground">
                            {t("kgPerM2")}
                          </th>
                          <th className="hidden xl:table-cell px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                            {t("delivery")}
                          </th>
                          <th className="hidden xl:table-cell px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                            {t("doSo")}
                          </th>
                          <SortableTh
                            label={t("status")}
                            columnKey="status"
                            activeKey={sortKey}
                            direction={sortDir}
                            onSort={onSort}
                            className="py-3 pl-4 pr-4"
                          />
                        </tr>
                      </thead>
                      <tbody>
                        {sortedRows.map((harvest) => (
                          <tr
                            key={harvest.id}
                            onClick={() =>
                              router.push(
                                `/harvest/detail?id=${encodeURIComponent(harvest.id)}&returnTo=${encodeURIComponent(returnTo)}`,
                              )
                            }
                            className="cursor-pointer border-b border-border/50 transition-colors hover:bg-muted/20"
                          >
                            <td className="py-3 pl-4 pr-2 font-mono text-xs text-muted-foreground">
                              H{harvest.id}
                            </td>
                            <td className="hidden xl:table-cell px-4 py-3 text-xs text-muted-foreground">
                              {harvest.customer || "—"}
                            </td>
                            <td className="px-4 py-3 text-xs font-medium text-foreground">
                              {harvest.project ? (
                                <button
                                  type="button"
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    router.push(
                                      `/harvest/new?id=${encodeURIComponent(harvest.id)}&returnTo=${encodeURIComponent(returnTo)}`,
                                    );
                                  }}
                                  className="text-left text-primary hover:underline"
                                >
                                  {harvest.project}
                                </button>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">
                              {harvest.estimatedDate
                                ? new Date(harvest.estimatedDate).toLocaleDateString(
                                    "en-US",
                                    {
                                      month: "short",
                                      day: "numeric",
                                      year: "numeric",
                                    },
                                  )
                                : "—"}
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">
                              {harvest.actualDate
                                ? new Date(harvest.actualDate).toLocaleDateString(
                                    "en-US",
                                    {
                                      month: "short",
                                      day: "numeric",
                                      year: "numeric",
                                    },
                                  )
                                : "—"}
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">
                              {harvest.farm || "—"}
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">
                              {harvest.grass || "—"}
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">
                              {harvest.zone
                                ? zoneLabel(harvest.zone) || harvest.zone
                                : "—"}
                            </td>
                            <td className="hidden xl:table-cell px-4 py-3 text-xs text-muted-foreground">
                              {harvest.harvestType || "—"}
                            </td>
                            <td className="hidden 2xl:table-cell px-4 py-3 text-right text-xs text-muted-foreground">
                              {harvest.harvestedArea > 0
                                ? harvest.harvestedArea.toLocaleString()
                                : "—"}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right text-xs font-medium text-foreground">
                              {harvest.qtyLabel}
                            </td>
                            <td className="hidden 2xl:table-cell px-4 py-3 text-right text-xs text-muted-foreground">
                              {harvest.kgPerM2 > 0 ? harvest.kgPerM2.toFixed(1) : "—"}
                            </td>
                            <td className="hidden xl:table-cell px-4 py-3 text-xs text-muted-foreground">
                              {harvest.deliveryDate
                                ? new Date(harvest.deliveryDate).toLocaleDateString(
                                    "en-US",
                                    {
                                      month: "short",
                                      day: "numeric",
                                      year: "numeric",
                                    },
                                  )
                                : "—"}
                            </td>
                            <td className="hidden xl:table-cell px-4 py-3 font-mono text-xs text-muted-foreground">
                              {harvest.doSoNumber || "—"}
                            </td>
                            <td className="px-4 py-3">
                              <HarvestStatusCell status={harvest.status} t={t} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="divide-y divide-border/50 lg:hidden">
                    {sortedRows.map((harvest) => (
                      <div
                        key={harvest.id}
                        className="cursor-pointer p-4 transition-colors hover:bg-muted/20"
                        onClick={() =>
                          router.push(
                            `/harvest/detail?id=${encodeURIComponent(harvest.id)}&returnTo=${encodeURIComponent(returnTo)}`,
                          )
                        }
                      >
                        <div className="mb-3 flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="mb-1 font-medium text-foreground">
                              {harvest.project ? (
                                <button
                                  type="button"
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    router.push(
                                      `/harvest/new?id=${encodeURIComponent(harvest.id)}&returnTo=${encodeURIComponent(returnTo)}`,
                                    );
                                  }}
                                  className="text-left text-primary hover:underline"
                                >
                                  {harvest.project}
                                </button>
                              ) : (
                                "—"
                              )}
                            </h3>
                            <p className="text-sm text-muted-foreground">
                              {harvest.date
                                ? new Date(harvest.date).toLocaleDateString(
                                    "en-US",
                                    {
                                      month: "short",
                                      day: "numeric",
                                      year: "numeric",
                                    },
                                  )
                                : "—"}
                            </p>
                          </div>
                          <HarvestStatusCell status={harvest.status} t={t} />
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <span className="text-muted-foreground">{t("farmLabel")}</span>
                            <div className="text-foreground">
                              {harvest.farm || "—"}
                            </div>
                          </div>
                          <div>
                            <span className="text-muted-foreground">{t("zoneLabel")}</span>
                            <div className="text-foreground">
                              {harvest.zone
                                ? zoneLabel(harvest.zone) || harvest.zone
                                : "—"}
                            </div>
                          </div>
                          <div>
                            <span className="text-muted-foreground">{t("grassLabel")}</span>
                            <div className="text-foreground">
                              {harvest.grass || "—"}
                            </div>
                          </div>
                          <div>
                            <span className="text-muted-foreground">
                              {t("quantityLabel")}
                            </span>
                            <div className="text-foreground">
                              {harvest.qtyLabel}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </DashboardLayout>
    </RequireAuth>
  );
}
