"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  Download,
  Filter,
  CheckCircle2,
  Clock,
  Calendar,
  CalendarClock,
  CalendarDays,
  List,
} from "lucide-react";
import { useLocale } from "next-intl";

import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import RequireAuth from "@/features/auth/RequireAuth";
import { useSyncedFarmMultiSelect } from "@/shared/hooks/useSyncedFarmMultiSelect";
import { stsProxyGetHarvestingIndex } from "@/shared/api/stsProxyClient";
import { canAccessModule, canViewAllModuleData } from "@/shared/auth/permissions";
import {
  clampFarmIdsToScope,
  farmUserMetaFromSessionUser,
  useFarmUserScope,
} from "@/shared/store/farmUserScope";
import { useAuthUserStore } from "@/shared/store/authUserStore";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import {
  mapRowsToSelectOptions,
  zoneIdToLabel,
} from "@/shared/lib/harvestReferenceData";
import { harvestTypeDisplayLabel } from "@/shared/lib/harvestType";
import { formatNumber } from "@/shared/lib/format/number";
import { MultiSelect } from "@/shared/ui/multi-select";
import { SortableTh } from "@/components/ui/sortable-th";
import { useTableColumnSort } from "@/shared/hooks/useTableColumnSort";
import {
  compareIsoDateStrings,
  compareNumbers,
  compareStrings,
} from "@/shared/lib/tableSort";
import { cn } from "@/lib/utils";
import { bgSurfaceFilter } from "@/shared/lib/surfaceFilter";
import {
  DashboardKpiDateFilter,
  KPI_DATE_PRESET_HARVEST,
} from "@/features/dashboard/DashboardKpiDateFilter";
import { HarvestListCalendarPanel } from "@/features/harvest/HarvestListCalendarPanel";
import { HarvestListExportDialog } from "@/features/harvest/ui/HarvestListExportDialog";
import type { HarvestListExportFilter } from "@/features/harvest/lib/harvestListExport";
import { stashHarvestDuplicateFromApiRow } from "@/features/harvesting/lib/harvestDuplicateDraft";
import { useGrassFilterByFarm } from "@/shared/hooks/useGrassFilterByFarm";
import {
  type KpiDatePreset,
  type KpiDeliveryDateFilter,
  kpiDateRangeFromFilter,
} from "@/shared/lib/dashboardKpiProjectFilters";

const PER_PAGE = 30;
const HARVEST_DATE_FILTER_BASELINE: KpiDatePreset = "all";

type HarvestListViewMode = "list" | "calendar";

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

/** Pass-through for `/api/harvesting` (server still scopes by DB `users_meta`; useful for proxies/logging). */
function farmUserMetaForHarvestApi(
  user: Parameters<typeof farmUserMetaFromSessionUser>[0],
): string | undefined {
  return farmUserMetaFromSessionUser(user);
}

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

/** Text row actions (desktop: hover overlay; mobile: always visible). */
function HarvestListRowQuickActions({
  t,
  showViewProject,
  showEdit,
  showDuplicate,
  buttonClassName,
  className,
  onViewDetail,
  onViewProject,
  onEdit,
  onDuplicate,
}: {
  t: ReturnType<typeof useTranslations<"Harvest">>;
  showViewProject: boolean;
  showEdit: boolean;
  showDuplicate: boolean;
  buttonClassName?: string;
  className?: string;
  onViewDetail: (ev: React.MouseEvent) => void;
  onViewProject?: (ev: React.MouseEvent) => void;
  onEdit?: (ev: React.MouseEvent) => void;
  onDuplicate?: (ev: React.MouseEvent) => void;
}) {
  const btn =
    buttonClassName ??
    "inline-flex shrink-0 items-center whitespace-nowrap rounded-md border border-border bg-background/95 px-2.5 py-1 text-xs font-medium text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <span
      className={cn(
        "harvest-row-actions pointer-events-auto inline-flex flex-nowrap items-center gap-1",
        className,
      )}
      onClick={(ev) => ev.stopPropagation()}
    >
      <button type="button" className={btn} onClick={onViewDetail}>
        {t("rowActionsViewDetail")}
      </button>
      {showViewProject && onViewProject ? (
        <button type="button" className={btn} onClick={onViewProject}>
          {t("projectOpenDetailHint")}
        </button>
      ) : null}
      {showEdit && onEdit ? (
        <button type="button" className={btn} onClick={onEdit}>
          {t("rowActionsEditHarvest")}
        </button>
      ) : null}
      {showDuplicate && onDuplicate ? (
        <button type="button" className={btn} onClick={onDuplicate}>
          {t("rowActionsDuplicate")}
        </button>
      ) : null}
    </span>
  );
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

function formatHarvestListDisplayDate(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export type HarvestListRow = {
  id: string;
  estimatedDate: string;
  actualDate: string;
  deliveryDate: string;
  portArrivalDate: string;
  date: string;
  projectId: string;
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

type HarvestListDesktopTableRowProps = {
  harvest: HarvestListRow;
  t: ReturnType<typeof useTranslations<"Harvest">>;
  router: { push: (href: string) => void };
  returnTo: string;
  zoneLabel: (zone: string) => string | undefined;
  canManageExistingHarvest: boolean;
  canCreateHarvest: boolean;
  duplicateHarvest: (id: string) => void | Promise<void>;
  harvestDetailHref: (id: string) => string;
  harvestEditHref: (id: string) => string;
};

/** Full-row hover overlay for quick actions (width tracks `<tr>` via ResizeObserver). */
function HarvestListDesktopTableRow({
  harvest,
  t,
  router,
  returnTo,
  zoneLabel,
  canManageExistingHarvest,
  canCreateHarvest,
  duplicateHarvest,
  harvestDetailHref,
  harvestEditHref,
}: HarvestListDesktopTableRowProps) {
  const trRef = useRef<HTMLTableRowElement>(null);
  const [rowWidthPx, setRowWidthPx] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const sync = () => {
      setRowWidthPx(Math.round(tr.getBoundingClientRect().width));
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(tr);
    return () => ro.disconnect();
  }, []);

  return (
    <tr
      ref={trRef}
      onClick={() => router.push(harvestDetailHref(harvest.id))}
      className="group relative cursor-pointer border-b border-border/50 transition-colors hover:bg-muted/20 [&_.harvest-row-content]:transition-opacity [&_.harvest-row-content]:duration-200 hover:[&_.harvest-row-content]:opacity-35 group-focus-within:[&_.harvest-row-content]:opacity-35 [&:has(.harvest-row-actions:hover)_.harvest-row-content]:opacity-100 [&:has(.harvest-row-actions:focus-within)_.harvest-row-content]:opacity-100"
    >
      <td className="relative z-0 overflow-visible py-3 pl-4 pr-2 font-mono text-xs group-hover:z-30 group-focus-within:z-30">
        <div className="harvest-row-content">
          <span className="font-medium text-foreground">H{harvest.id}</span>
        </div>
        <span
          className="harvest-row-overlay pointer-events-none absolute left-0 top-0 bottom-0 z-20 flex min-w-0 items-center justify-center overflow-x-auto overflow-y-visible opacity-0 invisible transition-[opacity,visibility] duration-150 ease-out group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
          style={
            rowWidthPx != null
              ? { width: rowWidthPx, maxWidth: rowWidthPx }
              : undefined
          }
        >
          <HarvestListRowQuickActions
            t={t}
            showViewProject={Boolean(harvest.projectId)}
            showEdit={canManageExistingHarvest}
            showDuplicate={canCreateHarvest}
            onViewDetail={(ev) => {
              ev.stopPropagation();
              router.push(harvestDetailHref(harvest.id));
            }}
            onViewProject={
              harvest.projectId
                ? (ev) => {
                    ev.stopPropagation();
                    router.push(
                      `/projects/detail?projectId=${encodeURIComponent(harvest.projectId)}&returnTo=${encodeURIComponent(returnTo)}`,
                    );
                  }
                : undefined
            }
            onEdit={
              canManageExistingHarvest
                ? (ev) => {
                    ev.stopPropagation();
                    router.push(harvestEditHref(harvest.id));
                  }
                : undefined
            }
            onDuplicate={
              canCreateHarvest
                ? (ev) => {
                    ev.stopPropagation();
                    void duplicateHarvest(harvest.id);
                  }
                : undefined
            }
          />
        </span>
      </td>
      <td className="relative z-0 px-4 py-3 text-xs font-medium text-foreground">
        <div className="harvest-row-content text-left">
          {harvest.project ? harvest.project : "—"}
        </div>
      </td>
      <td className="relative z-0 px-4 py-3 text-xs text-muted-foreground">
        <div className="harvest-row-content">
          {harvest.estimatedDate
            ? new Date(harvest.estimatedDate).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            : "—"}
        </div>
      </td>
      <td className="relative z-0 px-4 py-3 text-xs text-muted-foreground">
        <div className="harvest-row-content">
          {harvest.actualDate
            ? new Date(harvest.actualDate).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            : "—"}
        </div>
      </td>
      <td className="relative z-0 px-4 py-3 text-xs text-muted-foreground">
        <div className="harvest-row-content">{harvest.farm || "—"}</div>
      </td>
      <td className="relative z-0 px-4 py-3 text-xs text-muted-foreground">
        <div className="harvest-row-content">{harvest.grass || "—"}</div>
      </td>
      <td className="relative z-0 px-4 py-3 text-xs text-muted-foreground">
        <div className="harvest-row-content">
          {harvest.zone ? zoneLabel(harvest.zone) || harvest.zone : "—"}
        </div>
      </td>
      <td className="relative z-0 hidden px-4 py-3 text-xs text-muted-foreground xl:table-cell">
        <div className="harvest-row-content">{harvest.harvestType || "—"}</div>
      </td>
      <td className="relative z-0 hidden px-4 py-3 text-right text-xs text-muted-foreground 2xl:table-cell">
        <div className="harvest-row-content">
          {harvest.harvestedArea > 0 ? harvest.harvestedArea.toLocaleString() : "—"}
        </div>
      </td>
      <td className="relative z-0 whitespace-nowrap px-4 py-3 text-right text-xs font-medium text-foreground">
        <div className="harvest-row-content">{harvest.qtyLabel}</div>
      </td>
      <td className="relative z-0 hidden px-4 py-3 text-right text-xs text-muted-foreground 2xl:table-cell">
        <div className="harvest-row-content">
          {harvest.kgPerM2 > 0 ? harvest.kgPerM2.toFixed(1) : "—"}
        </div>
      </td>
      <td className="relative z-0 hidden px-4 py-3 text-xs text-muted-foreground xl:table-cell">
        <div className="harvest-row-content">
          {formatHarvestListDisplayDate(harvest.deliveryDate)}
        </div>
      </td>
      <td className="relative z-0 hidden px-4 py-3 text-xs text-muted-foreground xl:table-cell">
        <div className="harvest-row-content">
          {formatHarvestListDisplayDate(harvest.portArrivalDate)}
        </div>
      </td>
      <td className="relative z-0 hidden px-4 py-3 font-mono text-xs text-muted-foreground xl:table-cell">
        <div className="harvest-row-content">{harvest.doSoNumber || "—"}</div>
      </td>
      <td className="relative z-0 px-4 py-3">
        <div className="harvest-row-content">
          <HarvestStatusCell status={harvest.status} t={t} />
        </div>
      </td>
    </tr>
  );
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

const STRICT_YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Dashboard deep-link `deliveryFrom` / `deliveryTo` — strict YYYY-MM-DD only. */
function parseUrlDeliveryYmd(v: string | null): string {
  const s = String(v ?? "").trim().slice(0, 10);
  return STRICT_YMD.test(s) ? s : "";
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
  const quantityRaw = Number(r.quantity);
  const quantity = Number.isFinite(quantityRaw) ? quantityRaw : 0;
  const q = quantity;
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
  const qtyUom = uom;
  return {
    id: String(id),
    estimatedDate: isValidHarvestDateString(r.estimated_harvest_date)
      ? String(r.estimated_harvest_date).trim().slice(0, 10)
      : "",
    actualDate: isValidHarvestDateString(r.actual_harvest_date)
      ? String(r.actual_harvest_date).trim().slice(0, 10)
      : "",
    deliveryDate: isValidHarvestDateString(r.delivery_harvest_date)
      ? String(r.delivery_harvest_date).trim().slice(0, 10)
      : "",
    portArrivalDate: isValidHarvestDateString(r.shipment_required_date)
      ? String(r.shipment_required_date).trim().slice(0, 10)
      : "",
    date: dateStr,
    projectId: String(r.project_id ?? "").trim(),
    project: String(r.project_name ?? ""),
    farm: String(r.farm_name ?? ""),
    grass: String(r.grass_name ?? ""),
    zone: String(r.zone ?? ""),
    harvestType: harvestTypeDisplayLabel(r.harvest_type ?? r.load_type ?? ""),
    harvestedArea,
    kgPerM2,
    doSoNumber: String(r.do_so_number ?? ""),
    qty: q,
    status: deriveHarvestPortalStatus(r),
    qtyLabel: qtyUom ? `${q.toLocaleString()} ${qtyUom}` : q.toLocaleString(),
  };
}

export default function HarvestListPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locale = useLocale();
  const t = useTranslations("Harvest");
  const user = useAuthUserStore((s) => s.user);
  const canCreateHarvest = canAccessModule(user, "harvests", "create");
  const canExportHarvest = canAccessModule(user, "harvests", "export");
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const canEditHarvest = canAccessModule(user, "harvests", "edit");
  const canDeleteHarvest = canAccessModule(user, "harvests", "delete");
  const canManageExistingHarvest = canEditHarvest || canDeleteHarvest;
  const canImportHarvest = canAccessModule(user, "harvests", "import");
  const canViewAllHarvestData = canViewAllModuleData(user, "harvests");
  const userId = user?.id;
  const farmUserMeta = useMemo(
    () => (canViewAllHarvestData ? undefined : farmUserMetaForHarvestApi(user)),
    [user, canViewAllHarvestData],
  );
  const projects = useHarvestingDataStore((s) => s.projects);
  const allProjects = useHarvestingDataStore((s) => s.allProjects);
  const grasses = useHarvestingDataStore((s) => s.grasses);
  const zoneConfigurations = useHarvestingDataStore((s) => s.zoneConfigurations);
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
  const { scopeIds, scopeKey: farmScopeKey } = useFarmUserScope("harvests");
  const {
    selectedFarmIds: farmFilterIds,
    setSelectedFarmIds,
    farmOptions,
  } = useSyncedFarmMultiSelect("harvests");
  const setHarvestListFarmFilterDirect = useHarvestingDataStore(
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
  const [harvestDateFilter, setHarvestDateFilter] = useState<KpiDeliveryDateFilter>({
    preset: HARVEST_DATE_FILTER_BASELINE,
  });
  const [urlReady, setUrlReady] = useState(false);
  const [viewMode, setViewMode] = useState<HarvestListViewMode>("list");
  const [exportOpen, setExportOpen] = useState(false);
  const resumeGoogleSheetExport =
    (searchParams.get("googleSheetExport") ?? "").trim() === "resume";
  const googleSheetExportError = (searchParams.get("googleSheetError") ?? "").trim();
  const searchParamsKey = searchParams.toString();
  const deliveryHarvestRange = useMemo(
    () => kpiDateRangeFromFilter(harvestDateFilter),
    [harvestDateFilter],
  );
  const hasActiveDateFilter = harvestDateFilter.preset !== HARVEST_DATE_FILTER_BASELINE;
  const deliveryHarvestFrom = hasActiveDateFilter ? deliveryHarvestRange.start : "";
  const deliveryHarvestTo = hasActiveDateFilter ? deliveryHarvestRange.end : "";

  useLayoutEffect(() => {
    const parsed = new URLSearchParams(searchParamsKey);
    const q = parsed.get("q") ?? "";
    const farm = parsed.get("farm") ?? "";
    const grass = parsed.get("grass") ?? "";
    const project = parsed.get("project") ?? "";
    const status = parsed.get("status") ?? "";
    const p = parsePageParam(parsed.get("page"));
    const store = useHarvestingDataStore.getState();
    if (q !== store.harvestListSearch) setHarvestListSearch(q);
    /** Only overwrite global farm filter when URL carries `farm` (parity with Projects page). */
    if (parsed.has("farm")) {
      const nextFarmCsv = toCsvFilter(
        clampFarmIdsToScope(parseCsvFilter(farm), scopeIds),
      );
      if (nextFarmCsv !== store.harvestListFarmFilter) {
        setHarvestListFarmFilterDirect(nextFarmCsv);
      }
    }
    if (grass !== store.harvestListGrassFilter) setHarvestListGrassFilter(grass);
    if (project !== store.harvestListProjectFilter) {
      setHarvestListProjectFilter(project);
    }
    if (status !== store.harvestListStatusFilter) setHarvestListStatusFilter(status);
    const deliveryFrom = parseUrlDeliveryYmd(parsed.get("deliveryFrom"));
    const deliveryTo = parseUrlDeliveryYmd(parsed.get("deliveryTo"));
    if (deliveryFrom && deliveryTo) {
      setHarvestDateFilter({
        preset: "custom",
        customFrom: deliveryFrom,
        customTo: deliveryTo,
      });
    } else {
      setHarvestDateFilter({ preset: HARVEST_DATE_FILTER_BASELINE });
    }
    setPage(p);
    setDebouncedSearch(q.trim());
    setUrlReady(true);
  }, [
    farmScopeKey,
    searchParamsKey,
    setHarvestListFarmFilterDirect,
    setHarvestListGrassFilter,
    setHarvestListProjectFilter,
    setHarvestListSearch,
    setHarvestListStatusFilter,
    scopeIds,
  ]);

  const clearGoogleSheetExportQuery = useCallback(() => {
    const params = new URLSearchParams(searchParamsKey);
    params.delete("googleSheetExport");
    params.delete("googleSheetError");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router, searchParamsKey]);

  useEffect(() => {
    if (resumeGoogleSheetExport) {
      setExportOpen(true);
    }
  }, [resumeGoogleSheetExport]);

  const exportFilter = useMemo<HarvestListExportFilter>(
    () => ({
      search: debouncedSearch,
      farmIds: harvestListFarmFilter,
      grassIds: harvestListGrassFilter,
      projectIds: harvestListProjectFilter,
      statusValues: harvestListStatusFilter,
      deliveryHarvestFrom,
      deliveryHarvestTo,
      userId,
      farmUserMeta,
    }),
    [
      debouncedSearch,
      deliveryHarvestFrom,
      deliveryHarvestTo,
      farmUserMeta,
      harvestListFarmFilter,
      harvestListGrassFilter,
      harvestListProjectFilter,
      harvestListStatusFilter,
      userId,
    ],
  );

  const exportResolveContext = useMemo(
    () => ({
      projects: allProjects.length > 0 ? allProjects : projects,
      grasses,
      locale,
    }),
    [allProjects, grasses, locale, projects],
  );

  const returnTo = useMemo(() => {
    const params = new URLSearchParams();
    const q = harvestListSearch.trim();
    if (q) params.set("q", q);
    if (harvestListFarmFilter.trim()) params.set("farm", harvestListFarmFilter.trim());
    if (harvestListGrassFilter.trim())
      params.set("grass", harvestListGrassFilter.trim());
    if (harvestListProjectFilter.trim()) params.set("project", harvestListProjectFilter.trim());
    if (harvestListStatusFilter.trim()) params.set("status", harvestListStatusFilter.trim());
    if (deliveryHarvestFrom) params.set("deliveryFrom", deliveryHarvestFrom);
    if (deliveryHarvestTo) params.set("deliveryTo", deliveryHarvestTo);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    const base = pathname || "/harvest";
    return qs ? `${base}?${qs}` : base;
  }, [
    deliveryHarvestFrom,
    deliveryHarvestTo,
    harvestListFarmFilter,
    harvestListGrassFilter,
    harvestListProjectFilter,
    harvestListSearch,
    harvestListStatusFilter,
    page,
    pathname,
  ]);

  const harvestDetailHref = useCallback(
    (id: string) =>
      `/harvest/detail?id=${encodeURIComponent(id)}&returnTo=${encodeURIComponent(returnTo)}`,
    [returnTo],
  );

  const harvestEditHref = useCallback(
    (id: string) =>
      `/harvest/new?id=${encodeURIComponent(id)}&returnTo=${encodeURIComponent(returnTo)}`,
    [returnTo],
  );

  const duplicateHarvest = useCallback(
    async (harvestId: string) => {
      if (!canCreateHarvest) return;
      setDuplicateError(null);
      try {
        const params: Record<string, string | number | undefined> = {
          id: harvestId,
          page: 1,
          per_page: 1,
          user_id: userId,
        };
        if (farmUserMeta) params.farm_user_id = farmUserMeta;
        const res = await stsProxyGetHarvestingIndex(params);
        const raw = res.rows[0];
        if (!raw || typeof raw !== "object") {
          setDuplicateError(t("duplicateFailed"));
          return;
        }
        stashHarvestDuplicateFromApiRow(raw as Record<string, unknown>);
        router.push(
          `/harvest/new?returnTo=${encodeURIComponent(returnTo)}`,
        );
      } catch {
        setDuplicateError(t("duplicateFailed"));
      }
    },
    [canCreateHarvest, farmUserMeta, returnTo, router, t, userId],
  );

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
    if (deliveryHarvestFrom) params.set("deliveryFrom", deliveryHarvestFrom);
    if (deliveryHarvestTo) params.set("deliveryTo", deliveryHarvestTo);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    if (urlSearchParamsEquivalent(qs, searchParamsKey)) return;
    const base = pathname || "/harvest";
    router.replace(qs ? `${base}?${qs}` : base, { scroll: false });
  }, [
    deliveryHarvestFrom,
    deliveryHarvestTo,
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

  const projectOptions = useMemo(
    () => mapRowsToSelectOptions(projects as unknown[], "title"),
    [projects],
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
      if (farmUserMeta) params.farm_user_id = farmUserMeta;
      if (debouncedSearch) params.search = debouncedSearch;
      if (harvestListFarmFilter) params.farm_id = harvestListFarmFilter;
      if (harvestListGrassFilter.trim())
        params.product_id = harvestListGrassFilter.trim();
      if (harvestListProjectFilter) params.project_id = harvestListProjectFilter;
      if (harvestListStatusFilter) params.harvest_status = harvestListStatusFilter;
      if (deliveryHarvestFrom && deliveryHarvestTo) {
        // Backend matches any harvest date column in range (estimated/actual/delivery/shipment/do_so).
        params.delivery_harvest_date_from = deliveryHarvestFrom;
        params.delivery_harvest_date_to = deliveryHarvestTo;
      }

      const res = await stsProxyGetHarvestingIndex(params);
      const normalized = res.rows
        .map(normalizeHarvestRow)
        .filter((x): x is HarvestListRow => x !== null);
      setRows(normalized);
      setTotalPages(res.totalPages);
      setDuplicateError(null);
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
    farmUserMeta,
    deliveryHarvestFrom,
    deliveryHarvestTo,
  ]);

  const loadStatusCardTotals = useCallback(async () => {
    try {
      const commonParams: Record<string, string | number | undefined> = {
        page: 1,
        per_page: 1,
        user_id: userId,
      };
      if (farmUserMeta) commonParams.farm_user_id = farmUserMeta;
      if (debouncedSearch) commonParams.search = debouncedSearch;
      if (harvestListFarmFilter) commonParams.farm_id = harvestListFarmFilter;
      if (harvestListGrassFilter.trim())
        commonParams.product_id = harvestListGrassFilter.trim();
      if (harvestListProjectFilter) commonParams.project_id = harvestListProjectFilter;
      if (deliveryHarvestFrom && deliveryHarvestTo) {
        commonParams.delivery_harvest_date_from = deliveryHarvestFrom;
        commonParams.delivery_harvest_date_to = deliveryHarvestTo;
      }

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
    farmUserMeta,
    deliveryHarvestFrom,
    deliveryHarvestTo,
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

  const handleFarmFilterChange = (farmIds: string[]) => {
    setSelectedFarmIds(farmIds);
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

  const grassLabelByProductId = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of grasses) {
      if (!g || typeof g !== "object") continue;
      const rec = g as Record<string, unknown>;
      const id = String(rec.id ?? "").trim();
      if (!id) continue;
      const label = String(rec.title ?? rec.name ?? "").trim();
      if (label) m.set(id, label);
    }
    return m;
  }, [grasses]);

  const { grassFilterOptions } = useGrassFilterByFarm({
    grasses: grasses as unknown[],
    zoneConfigs: zoneConfigurations,
    selectedFarmIds: farmFilterIds,
    selectedGrassIds: grassSelectValues,
    onSelectedGrassIdsChange: (ids) => setHarvestListGrassFilter(toCsvFilter(ids)),
    catalogMode: "all",
  });

  const hasActiveFilters =
    harvestListSearch.trim() !== "" ||
    harvestListFarmFilter.trim() !== "" ||
    harvestListGrassFilter.trim() !== "" ||
    harvestListProjectFilter.trim() !== "" ||
    harvestListStatusFilter.trim() !== "" ||
    hasActiveDateFilter;

  const clearAllFilters = () => {
    setHarvestListSearch("");
    setSelectedFarmIds([]);
    setHarvestListGrassFilter("");
    setHarvestListProjectFilter("");
    setHarvestListStatusFilter("");
    setHarvestDateFilter({ preset: HARVEST_DATE_FILTER_BASELINE });
    setPage(1);
  };

  const handleHarvestDateFilterChange = (next: KpiDeliveryDateFilter) => {
    setHarvestDateFilter(next);
    setPage(1);
  };

  const statusIsOnly = (value: HarvestPortalStatus) =>
    statusFilterValues.length === 1 && statusFilterValues[0] === value;

  const isCalendarView = viewMode === "calendar";

  const filterTriggerIcon = (
    <>
      <AlignLeft className="h-3.5 w-3.5 shrink-0" />
      <ArrowDown className="h-3.5 w-3.5 shrink-0" />
    </>
  );

  const multiSelectBaseClass =
    "shrink-0 min-w-[140px] max-w-[200px] rounded-md border border-input text-sm hover:bg-btnhover/40";

  return (
    <RequireAuth>
      <DashboardLayout
        defaultSidebarCollapsed={isCalendarView}
        hideAppHeaderWhenSidebarCollapsed={isCalendarView}
        flushMainPadding={isCalendarView}
      >
        <div
          className={cn(
            "dashboard-harvesting-skin min-w-0 flex-1",
            isCalendarView
              ? "sts-hsc-viewport-fill sts-hsc-viewport-fill--mobile-page-scroll sts-hsc-viewport-fill--harvest-list-scroll flex min-h-0 flex-col overflow-visible"
              : "min-h-full p-4 lg:p-8",
          )}
        >
          <div
            className={cn(
              isCalendarView
                ? "sts-hsc-harvest-list-calendar-page flex flex-col gap-2 overflow-visible px-2 py-2 sm:gap-2.5 sm:px-3 sm:py-2.5"
                : "space-y-6",
            )}
          >
            {!isCalendarView ? (
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
                {canExportHarvest ? (
                  <button
                    onClick={() => setExportOpen(true)}
                    className="flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/80"
                    type="button"
                  >
                    <Download className="h-4 w-4" />
                    {t("exportData")}
                  </button>
                ) : null}
                {canImportHarvest ? (
                  <button
                    onClick={() => router.push("/harvest/import")}
                    className="flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/80"
                    type="button"
                  >
                    <Upload className="h-4 w-4" />
                    {t("importExcel")}
                  </button>
                ) : null}
                {canCreateHarvest ? (
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
                ) : null}
              </div>
            </div>
            ) : null}

            {googleSheetExportError ? (
              <p className="text-sm text-destructive">{googleSheetExportError}</p>
            ) : null}

            {!isCalendarView ? (
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
            ) : null}

            <div
              className={cn(
                "glass-card shrink-0 rounded-xl",
                isCalendarView ? "p-2 sm:p-2.5" : "p-4",
              )}
            >
              <div className="flex items-center gap-3 overflow-x-auto overscroll-x-contain pb-0.5 [scrollbar-width:thin]">
                <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="relative w-[min(100%,280px)] shrink-0 sm:w-[240px]">
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
                      "w-full rounded-lg border border-input py-2.5 pl-10 pr-4 text-sm focus-visible:ring-2 focus-visible:ring-ring",
                      bgSurfaceFilter(!!harvestListSearch.trim()),
                    )}
                    autoComplete="off"
                  />
                </div>
                <MultiSelect
                  options={farmOptions.map((f) => ({ value: f.id, label: f.label }))}
                  values={farmFilterIds}
                  onChange={handleFarmFilterChange}
                  placeholder={t("allFarms")}
                  showAllOption
                  disabled={refLoading}
                  className={cn(multiSelectBaseClass, bgSurfaceFilter(farmFilterIds.length > 0))}
                  rightIcon={filterTriggerIcon}
                />
                <MultiSelect
                  options={grassFilterOptions}
                  values={grassSelectValues}
                  onChange={handleGrassFilterChange}
                  placeholder={t("allGrassTypes", {
                    count: grassFilterOptions.length,
                  })}
                  showAllOption
                  disabled={refLoading}
                  className={cn(
                    multiSelectBaseClass,
                    "min-w-[160px] max-w-[220px]",
                    bgSurfaceFilter(grassSelectValues.length > 0),
                  )}
                  rightIcon={filterTriggerIcon}
                />
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
                  showAllOption
                  className={cn(
                    multiSelectBaseClass,
                    "min-w-[160px] max-w-[220px]",
                    bgSurfaceFilter(statusSelectValues.length > 0),
                  )}
                  rightIcon={filterTriggerIcon}
                />
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
                  showAllOption
                  className={cn(
                    multiSelectBaseClass,
                    "min-w-[160px] max-w-[220px]",
                    bgSurfaceFilter(projectSelectValues.length > 0),
                  )}
                  rightIcon={filterTriggerIcon}
                />
                <DashboardKpiDateFilter
                  value={harvestDateFilter}
                  onChange={handleHarvestDateFilterChange}
                  presets={KPI_DATE_PRESET_HARVEST}
                  baselinePreset={HARVEST_DATE_FILTER_BASELINE}
                  className="shrink-0"
                />
                {hasActiveFilters ? (
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {t("clearAll")}
                  </button>
                ) : null}
              </div>
            </div>

            <div
              className={cn(
                "flex flex-wrap items-center justify-between gap-3",
                isCalendarView && "shrink-0",
              )}
            >
              <div
                className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5"
                role="group"
                aria-label={t("viewModeLabel")}
              >
                <button
                  type="button"
                  onClick={() => setViewMode("list")}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                    viewMode === "list"
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  aria-pressed={viewMode === "list"}
                >
                  <List className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {t("viewList")}
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("calendar")}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                    viewMode === "calendar"
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  aria-pressed={viewMode === "calendar"}
                >
                  <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {t("viewCalendar")}
                </button>
              </div>
            </div>

            {listError ? (
              <p className="text-sm text-destructive" role="alert">
                {listError}
              </p>
            ) : null}
            {duplicateError ? (
              <p className="text-sm text-destructive" role="alert">
                {duplicateError}
              </p>
            ) : null}

            {viewMode === "calendar" ? (
              <HarvestListCalendarPanel
                fillViewport
                className="min-h-0 flex-none"
                detailHref={harvestDetailHref}
                farmFilterIds={farmFilterIds}
                farmOptions={farmOptions}
                grassSelectValues={grassSelectValues}
                grassLabelByProductId={grassLabelByProductId}
                statusSelectValues={statusSelectValues}
                projectSelectValues={projectSelectValues}
                debouncedSearch={debouncedSearch}
              />
            ) : null}

            {viewMode === "list" && totalPages > 1 ? (
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

            {viewMode === "list" ? (
            <div className="overflow-x-auto overflow-y-visible rounded-xl lg:glass-card">
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
                          <th
                            className="hidden xl:table-cell px-4 py-3 text-left text-xs font-medium text-muted-foreground"
                            title={t("portArrivalTitle")}
                          >
                            {t("portArrivalShort")}
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
                          <HarvestListDesktopTableRow
                            key={harvest.id}
                            harvest={harvest}
                            t={t}
                            router={router}
                            returnTo={returnTo}
                            zoneLabel={zoneLabel}
                            canManageExistingHarvest={canManageExistingHarvest}
                            canCreateHarvest={canCreateHarvest}
                            duplicateHarvest={duplicateHarvest}
                            harvestDetailHref={harvestDetailHref}
                            harvestEditHref={harvestEditHref}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-col gap-3 lg:hidden">
                    {sortedRows.map((harvest) => (
                      <div
                        key={harvest.id}
                        className="glass-card cursor-pointer rounded-xl p-4 transition-colors hover:bg-muted/20"
                        onClick={() => router.push(harvestDetailHref(harvest.id))}
                      >
                        <div className="mb-3 flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="mb-1 font-medium text-foreground">
                              {harvest.project ? harvest.project : "—"}
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
                          <div className="flex shrink-0 flex-col items-end gap-2">
                            <span className="rounded-full border border-border bg-background px-2.5 py-1 font-mono text-[11px] font-medium text-foreground">
                              H{harvest.id}
                            </span>
                            <HarvestStatusCell status={harvest.status} t={t} />
                          </div>
                        </div>
                        <div
                          className="mb-3 flex flex-nowrap items-center justify-center gap-2 overflow-x-auto pb-1"
                          onClick={(ev) => ev.stopPropagation()}
                        >
                          <HarvestListRowQuickActions
                            t={t}
                            showViewProject={Boolean(harvest.projectId)}
                            showEdit={canManageExistingHarvest}
                            showDuplicate={canCreateHarvest}
                            onViewDetail={(ev) => {
                              ev.stopPropagation();
                              router.push(harvestDetailHref(harvest.id));
                            }}
                            onViewProject={
                              harvest.projectId
                                ? (ev) => {
                                    ev.stopPropagation();
                                    router.push(
                                      `/projects/detail?projectId=${encodeURIComponent(harvest.projectId)}&returnTo=${encodeURIComponent(returnTo)}`,
                                    );
                                  }
                                : undefined
                            }
                            onEdit={
                              canManageExistingHarvest
                                ? (ev) => {
                                    ev.stopPropagation();
                                    router.push(harvestEditHref(harvest.id));
                                  }
                                : undefined
                            }
                            onDuplicate={
                              canCreateHarvest
                                ? (ev) => {
                                    ev.stopPropagation();
                                    void duplicateHarvest(harvest.id);
                                  }
                                : undefined
                            }
                          />
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
            ) : null}
          </div>
        </div>
        {canExportHarvest ? (
          <HarvestListExportDialog
            open={exportOpen}
            onClose={() => setExportOpen(false)}
            filter={exportFilter}
            resolveContext={exportResolveContext}
            resumeGoogleSheetExport={resumeGoogleSheetExport}
            onResumeHandled={clearGoogleSheetExportQuery}
          />
        ) : null}
      </DashboardLayout>
    </RequireAuth>
  );
}
