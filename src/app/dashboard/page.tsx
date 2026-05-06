"use client";

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import {
  BarChart,
  Bar,
  ComposedChart,
  PieChart,
  Pie,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Legend,
} from "recharts";
import {
  ArrowDownRight,
  ArrowUpRight,
  Briefcase,
  Eye,
  EyeOff,
  Package,
  Truck,
  TrendingUp,
} from "lucide-react";

import RequireAuth from "@/features/auth/RequireAuth";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { fetchMondayProjectRowsFromServer, type MondayProjectServerRow } from "@/entities/projects";
import { sortMondayProjectRows } from "@/features/project";
import { stsProxyGetHarvestingIndex } from "@/shared/api/stsProxyClient";
import { parseQuantityRequiredRows, parseSubitems } from "@/shared/lib/parseJsonMaybe";
import { useAppTranslations } from "@/shared/i18n/useAppTranslations";
import { SortableTh } from "@/components/ui/sortable-th";
import { useTableColumnSort } from "@/shared/hooks/useTableColumnSort";
import {
  compareNumbers,
  compareStrings,
  compareIsoDateStrings,
} from "@/shared/lib/tableSort";
import { FarmCountryFlag } from "./FarmCountryFlag";
import {
  dateToLocalYmd,
  isDeliveryYmdInKpiPeriod,
  normalizeDateFieldToYmd,
  normalizeDeliveryHarvestYmd,
  periodStartYmd,
  priorKpiPeriodWindowYmd,
  projectHasSubitemDeliveryInKpiPeriod,
  projectHasSubitemDeliveryInYmdRange,
  projectRowHasFarmAssigned,
  rowMatchesDashboardActiveProjectsKpi,
  todayYmd,
  type KpiDeliveryPeriod,
} from "@/shared/lib/dashboardKpiProjectFilters";

type RecentDeliveriesSortKey =
  | "deliveryYmd"
  | "projectLabel"
  | "grassLabel"
  | "harvestKey"
  | "qty";

/**
 * Harvesting Portal `DashboardChartsGrid.tsx` — comma-separated hsl() to match the 2×2 grid.
 */
const PORTAL_CHARTS_GRID_PROJECTS_BY_COUNTRY_BAR = "hsl(152,55%,36%)";

const PORTAL_CHARTS_GRID_GRASS_PIE_COLORS = [
  "hsl(152,55%,32%)",
  "hsl(152,55%,45%)",
  "hsl(152,40%,60%)",
  "hsl(152,30%,75%)",
  "hsl(35,80%,55%)",
  "hsl(210,70%,55%)",
  "hsl(280,40%,60%)",
];

const PORTAL_CHARTS_GRID_DELIVERED_BY_FARM_BAR = "hsl(152,55%,45%)";

/** Distinct hues for ≤6 farms; 6 entries so index 5 never wraps to same green as 0 */
const PORTAL_CHARTS_GRID_TREND_LINE_COLORS = [
  "hsl(152,55%,36%)",
  "hsl(35,92%,52%)",
  "hsl(210,80%,52%)",
  "hsl(280,50%,55%)",
  "hsl(0,70%,55%)",
  "hsl(188,72%,44%)",
];

/** Harvesting Portal main dashboard stacked bar (`CHART_COLORS`) — qty by type per farm. */
const FARM_STACKED_HARVEST_COLORS = {
  SOD: "hsl(152,55%,36%)",
  SPRIG: "hsl(35,92%,52%)",
  SOD_FOR_SPRIG: "hsl(210,80%,52%)",
} as const;

type FarmStackHarvestKey = keyof typeof FARM_STACKED_HARVEST_COLORS;

/**
 * Numeric `ref_hrv_qty_sprig` (`sts_project_harvesting_plan`) on subitem; > 0 counts.
 * Monday payload alone often omits it — dashboard merges harvesting-index rows like the project list.
 */
function parseRefHrvQtySprigNumber(rec: Record<string, unknown>): number {
  const raw = rec.ref_hrv_qty_sprig ?? rec.refHrvQtySprig;
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : 0;
  const s = String(raw ?? "").trim();
  if (!s || s === "null" || s === "undefined") return 0;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Merge harvesting-plan rows into each project `subitems` by `project_id` / `id` (parity with Projects page). */
function mergeDashboardSubitemsWithHarvestPlan(
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
    const existingSubitems = parseSubitems(row.subitems);
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
    return { ...row, subitems: JSON.stringify(merged) };
  });
}

function harvestTypeStackKey(rec: Record<string, unknown>): FarmStackHarvestKey {
  if (parseRefHrvQtySprigNumber(rec) > 0) return "SOD_FOR_SPRIG";

  const raw = String(
    rec.load_type ?? rec.select_harvest_type ?? rec.selectHarvestType ?? "",
  ).trim();
  if (!raw) return "SPRIG";
  const u = raw.toUpperCase().replace(/\s+/g, "_");
  if (
    u === "SOD_FOR_SPRIG" ||
    /sod\s*for\s*sprig/i.test(raw) ||
    /sod.*sprig/i.test(raw)
  ) {
    return "SOD_FOR_SPRIG";
  }
  if (u === "SOD" || raw === "Sod") return "SOD";
  if (u === "SPRIG" || raw === "Sprig") return "SPRIG";
  const low = raw.toLowerCase();
  if (low.includes("sod") && low.includes("sprig")) return "SOD_FOR_SPRIG";
  if (low.includes("sod")) return "SOD";
  return "SPRIG";
}

function countryCodeToFlag(code: string): string {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return "🏳️";
  return String.fromCodePoint(
    normalized.charCodeAt(0) + 127397,
    normalized.charCodeAt(1) + 127397,
  );
}

/** Month bucket YYYY-MM from `sts_project_harvesting_plan.delivery_harvest_date` only (subitems). */
function monthKeyFromSubitem(item: Record<string, unknown>): string | null {
  const raw = item.delivery_harvest_date;
  const s = String(raw ?? "").trim();
  if (!s || s === "0000-00-00" || s === "null") return null;
  const datePart = s.includes(" ") ? s.split(" ")[0] : s;
  const d = new Date(datePart);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function hasDeliveryHarvestDate(item: Record<string, unknown>): boolean {
  return monthKeyFromSubitem(item) !== null;
}

function parseRequirementItems(raw: unknown): Array<Record<string, unknown>> {
  return parseQuantityRequiredRows(raw);
}

function parseDeliveryDate(item: Record<string, unknown>): Date | null {
  const raw = item.delivery_harvest_date;
  const s = String(raw ?? "").trim();
  if (!s || s === "0000-00-00" || s === "null") return null;
  const datePart = s.includes(" ") ? s.split(" ")[0] : s;
  const m = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const dNum = Number(m[3]);
  const d = new Date(y, mo - 1, dNum);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function localDateFromYmd(ymd: string): Date | null {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const dNum = Number(m[3]);
  const d = new Date(y, mo - 1, dNum);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Calendar display: `dd/m/yyyy` (day padded, month without leading zero). */
function formatDashboardDateDmYyyy(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const m = String(d.getMonth() + 1);
  const yyyy = String(d.getFullYear());
  return `${dd}/${m}/${yyyy}`;
}

function formatDashboardDateFromYmd(ymd: string): string {
  const d = localDateFromYmd(ymd);
  if (!d) return "—";
  return formatDashboardDateDmYyyy(d);
}

function formatRecentDeliveryTableDate(ymd: string): string {
  return formatDashboardDateFromYmd(ymd);
}

function stripTimeLocal(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addCalendarDaysCopy(d: Date, days: number): Date {
  const o = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  o.setDate(o.getDate() + days);
  return o;
}

/** Monday ISO-style (Monday as first day of week) on or before `d`. */
function mondayOnOrBeforeCalendar(d: Date): Date {
  const x = stripTimeLocal(d);
  const dow = x.getDay();
  const delta = dow === 0 ? -6 : 1 - dow;
  x.setDate(x.getDate() + delta);
  return x;
}

type KpiTrendTimeSlot = { key: string; label: string };

/** X-axis buckets for delivery trend: Week = days, Month = week slices, Quarter = calendar months. */
function buildKpiDeliveryTrendSlots(deliveryPeriod: KpiDeliveryPeriod): KpiTrendTimeSlot[] {
  const startD = localDateFromYmd(periodStartYmd(deliveryPeriod));
  const endD = localDateFromYmd(todayYmd());
  if (!startD || !endD) return [];
  const startStrip = stripTimeLocal(startD);
  const endStrip = stripTimeLocal(endD);

  if (deliveryPeriod === "week") {
    const out: KpiTrendTimeSlot[] = [];
    for (
      let t = startStrip.getTime();
      t <= endStrip.getTime();
      t += 86400000
    ) {
      const day = new Date(t);
      out.push({
        key: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`,
        label: formatDashboardDateDmYyyy(day),
      });
    }
    return out;
  }

  if (deliveryPeriod === "month") {
    const out: KpiTrendTimeSlot[] = [];
    let weekStart = mondayOnOrBeforeCalendar(startStrip);
    const endTs = endStrip.getTime();
    while (weekStart.getTime() <= endTs) {
      const weekEndNatural = stripTimeLocal(addCalendarDaysCopy(weekStart, 6));
      const sliceStartMs = Math.max(weekStart.getTime(), startStrip.getTime());
      const sliceEndMs = Math.min(weekEndNatural.getTime(), endTs);
      const sliceStartDate = new Date(sliceStartMs);
      const sliceEndDate = new Date(sliceEndMs);
      const mondayLabel = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, "0")}-${String(weekStart.getDate()).padStart(2, "0")}`;
      const label =
        sliceStartMs === sliceEndMs
          ? formatDashboardDateDmYyyy(sliceStartDate)
          : `${formatDashboardDateDmYyyy(sliceStartDate)}–${formatDashboardDateDmYyyy(sliceEndDate)}`;
      out.push({ key: mondayLabel, label });
      weekStart = addCalendarDaysCopy(weekStart, 7);
    }
    return out;
  }

  const out: KpiTrendTimeSlot[] = [];
  const monthEndCeil = new Date(endStrip.getFullYear(), endStrip.getMonth(), 1);
  for (
    let dMonth = new Date(startStrip.getFullYear(), startStrip.getMonth(), 1);
    dMonth.getTime() <= monthEndCeil.getTime();
    dMonth = new Date(dMonth.getFullYear(), dMonth.getMonth() + 1, 1)
  ) {
    const key = `${dMonth.getFullYear()}-${String(dMonth.getMonth() + 1).padStart(2, "0")}`;
    const firstOfMonth = new Date(dMonth.getFullYear(), dMonth.getMonth(), 1);
    out.push({
      key,
      label: formatDashboardDateDmYyyy(firstOfMonth),
    });
  }
  return out;
}

/** Maps a delivery_yyyymmdd to the trend-slot key chosen for `deliveryPeriod`. */
function kpiTrendBucketKeyForDeliveryYmd(
  deliveryYmd: string,
  deliveryPeriod: KpiDeliveryPeriod,
): string | null {
  const d = localDateFromYmd(deliveryYmd);
  if (!d) return null;
  if (deliveryPeriod === "quarter") {
    return deliveryYmd.length >= 7 ? deliveryYmd.slice(0, 7) : null;
  }
  const strip = stripTimeLocal(d);
  if (deliveryPeriod === "week") return dateToLocalYmd(strip);
  const monday = mondayOnOrBeforeCalendar(strip);
  return dateToLocalYmd(monday);
}

function rowPassesKpiGrassDeliveryPortfolio(
  row: MondayProjectServerRow,
  ctx: {
    excludeProjectsWithoutFarm: boolean;
    selectedFarmIdSet: Set<string>;
    deliveryPeriod: KpiDeliveryPeriod;
  },
): boolean {
  return rowMatchesDashboardActiveProjectsKpi(row, {
    excludeProjectsWithoutFarm: ctx.excludeProjectsWithoutFarm,
    selectedFarmIdSet: ctx.selectedFarmIdSet,
    excludeCompleted: true,
    deliveryMatch: (r) => projectHasSubitemDeliveryInKpiPeriod(r, ctx.deliveryPeriod),
  });
}

function hasActualHarvestDate(item: Record<string, unknown>): boolean {
  const actual = String(item.actual_harvest_date ?? "").trim();
  if (actual && actual !== "0000-00-00" && actual !== "null") {
    const actualDatePart = actual.includes(" ") ? actual.split(" ")[0] : actual;
    const actualDate = new Date(actualDatePart);
    if (!Number.isNaN(actualDate.getTime())) return true;
  }

  const estimated = String(item.estimated_harvest_date ?? "").trim();
  if (estimated && estimated !== "0000-00-00" && estimated !== "null") {
    const estimatedDatePart = estimated.includes(" ") ? estimated.split(" ")[0] : estimated;
    const estimatedDate = new Date(estimatedDatePart);
    if (!Number.isNaN(estimatedDate.getTime())) return true;
  }

  return false;
}

/** Trim, collapse inner whitespace, uppercase — for grouping / comparing customer names. */
function normalizeCustomerNameKey(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

/** Same semantics as DashboardLayout / harvest list — comma-separated farm ids, empty = all. */
function parseCsvFilter(value: string): string[] {
  return String(value ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function formatKpiDeliveredAbbrev(n: number, unit: "kg" | "m²"): string {
  const v = Number.isFinite(n) && n >= 0 ? n : 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M ${unit}`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k ${unit}`;
  if (Number.isInteger(v)) return `${v.toLocaleString()} ${unit}`;
  return `${v.toFixed(1)} ${unit}`;
}

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  trend,
  trendLabel,
}: {
  label: string;
  value: ReactNode;
  sub: string;
  icon: ComponentType<{ className?: string }>;
  trend?: number;
  trendLabel?: string;
}) {
  return (
    <div className="glass-card flex h-full min-h-0 flex-col rounded-xl p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-4 w-4 text-primary" />
        </div>
      </div>
      <div className="font-heading text-2xl font-bold tabular-nums text-foreground">{value}</div>
      <div className="mt-auto min-h-0 pt-3">
        {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
        {trend !== undefined ? (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <span
              className={`inline-flex items-center text-xs font-medium ${trend >= 0 ? "text-primary" : "text-destructive"
                }`}
            >
              {trend >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {Math.abs(trend)}%
            </span>
            {trendLabel ? <span className="text-xs text-muted-foreground">{trendLabel}</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Harvesting Portal–style delivery status strip (counts harvesting subitems). */
function DeliveryStatusBadge({
  count,
  label,
  colorDot,
}: {
  count: number;
  label: string;
  colorDot: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-muted/30 p-3">
      <div className={`h-3 w-3 shrink-0 rounded-full ${colorDot}`} />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      <p className="font-heading text-lg font-bold tabular-nums text-foreground">{count}</p>
    </div>
  );
}

function sprigSodSegmentClass(active: boolean) {
  return `rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
    }`;
}

/** Same pills as KPI delivery period (week / month / quarter). */
function kpiDeliveryPeriodSegmentClass(active: boolean) {
  return `rounded-md px-3 py-1 text-xs font-medium transition-colors ${active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
    }`;
}

function formatDashTableYmd(ymd: string): string {
  const datePart = ymd.includes(" ") ? ymd.split(" ")[0]!.trim() : ymd.trim();
  const parts = datePart.split("-").map(Number);
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return datePart || "—";
  const [y, m, day] = parts;
  const d = new Date(y!, m! - 1, day);
  if (Number.isNaN(d.getTime())) return datePart || "—";
  return formatDashboardDateDmYyyy(d);
}

function dashProjectCustomerLabel(rec: Record<string, unknown>): string {
  const c = String(rec.company_name ?? "").trim();
  const a = String(rec.alias_title ?? "").trim();
  const t = String(rec.title ?? rec.name ?? "").trim();
  return c || a || t || "";
}

type ForecastHorizonMonths = 1 | 3 | 6 | 12;

function startOfLocalToday(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

/** Same idea as Harvesting Portal `monthsAhead`: move calendar months from anchor day. */
function addCalendarMonths(anchor: Date, months: number): Date {
  return new Date(anchor.getFullYear(), anchor.getMonth() + months, anchor.getDate());
}

function formatMonthYearLong(d: Date, locale: string): string {
  return d.toLocaleDateString(locale, { month: "long", year: "numeric" });
}

/** Dedicated active-projects view (`app/projects/active-projects/page.tsx`). */
const ACTIVE_PROJECTS_PAGE_HREF = "/projects/active-projects";

/** Harvesting Portal forecast: `target = deliveryDate || estDate` on each harvest line. */
function getForecastTargetYmd(rec: Record<string, unknown>): string | null {
  return (
    normalizeDateFieldToYmd(rec.delivery_harvest_date) ??
    normalizeDateFieldToYmd(rec.estimated_harvest_date)
  );
}

export default function DashboardPage() {
  const t = useAppTranslations();
  const locale = useLocale();
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const harvestListFarmFilter = useHarvestingDataStore((s) => s.harvestListFarmFilter);
  const setHarvestListFarmFilter = useHarvestingDataStore((s) => s.setHarvestListFarmFilter);
  const selectedFarmIds = useMemo(
    () => parseCsvFilter(harvestListFarmFilter),
    [harvestListFarmFilter],
  );
  const selectedFarmIdSet = useMemo(() => new Set(selectedFarmIds), [selectedFarmIds]);
  const hasFarmSelection = selectedFarmIds.length > 0;
  /** "All Countries" + no farm chips: omit projects with no `farm_id` on any subitem. */
  const excludeProjectsWithoutFarm = selectedCountry === null && !hasFarmSelection;
  const [forecastHorizon, setForecastHorizon] = useState<ForecastHorizonMonths>(3);
  const [deliveryPeriod, setDeliveryPeriod] = useState<KpiDeliveryPeriod>("month");

  const { forecastHorizonEnd, forecastTodayStart, firstForecastDay } = useMemo(() => {
    const forecastTodayStart = startOfLocalToday();
    const forecastHorizonEnd = addCalendarMonths(forecastTodayStart, forecastHorizon);
    const firstForecastDay = new Date(forecastTodayStart);
    firstForecastDay.setDate(firstForecastDay.getDate() + 1);
    return { forecastHorizonEnd, forecastTodayStart, firstForecastDay };
  }, [forecastHorizon]);
  const [deliveredByMonthMode, setDeliveredByMonthMode] = useState<"sprig" | "sod">("sprig");
  const [rows, setRows] = useState<MondayProjectServerRow[]>([]);
  const [showAnalyticsPanels, setShowAnalyticsPanels] = useState(true);
  const { sortKey, sortDir, onSort } = useTableColumnSort<RecentDeliveriesSortKey>(
    "deliveryYmd",
    "desc",
  );
  const farmsRef = useHarvestingDataStore((s) => s.farms);
  const countriesRef = useHarvestingDataStore((s) => s.countries);
  const productsRef = useHarvestingDataStore((s) => s.products);
  const fetchAllHarvestingReferenceData = useHarvestingDataStore((s) => s.fetchAllHarvestingReferenceData);

  useEffect(() => {
    void fetchAllHarvestingReferenceData();
  }, [fetchAllHarvestingReferenceData]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const res = await fetchMondayProjectRowsFromServer({
        module: "project",
        page: 1,
        perPage: 5000,
      });
      if (!mounted) return;
      let merged = res.rows as unknown as Array<Record<string, unknown>>;
      try {
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
        if (allHarvestRows.length > 0) {
          merged = mergeDashboardSubitemsWithHarvestPlan(merged, allHarvestRows);
        }
      } catch {
        // Charts still work off Monday-only subitems when plan index fails.
      }
      setRows(sortMondayProjectRows(merged) as unknown as MondayProjectServerRow[]);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const farmFilters = useMemo(() => {
    const countriesById = new Map<string, { countryName: string; countryCode: string }>();
    for (const row of countriesRef) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const id = String(r.id ?? "").trim();
      if (!id) continue;
      countriesById.set(id, {
        countryName: String(r.country_name ?? r.name ?? "").trim(),
        countryCode: String(r.country_code ?? "").trim().toUpperCase(),
      });
    }

    const out: Array<{
      farmId: string;
      farmName: string;
      countryId: string;
      countryName: string;
      countryCode: string;
      flag: string;
    }> = [];

    for (const row of farmsRef) {
      if (!row || typeof row !== "object") continue;
      const farm = row as Record<string, unknown>;
      if (String(farm.deleted ?? "0") === "1") continue;
      const farmId = String(farm.id ?? "").trim();
      const farmName = String(farm.name ?? "").trim();
      const countryId = String(farm.country_id ?? "").trim();
      if (!farmId || !farmName || !countryId) continue;
      const c = countriesById.get(countryId);
      const countryCode = (c?.countryCode ?? "").trim();
      out.push({
        farmId,
        farmName,
        countryId,
        countryName: c?.countryName ?? "",
        countryCode,
        flag: countryCodeToFlag(countryCode),
      });
    }
    const countryPriority = (countryName: string): number => {
      const key = countryName.trim().toLowerCase();
      if (key === "vietnam") return 0;
      if (key === "thailand") return 1;
      return 2;
    };
    return out.sort((a, b) => {
      const aCountry = a.countryName || a.countryId;
      const bCountry = b.countryName || b.countryId;
      const pDiff = countryPriority(aCountry) - countryPriority(bCountry);
      if (pDiff !== 0) return pDiff;

      const countryCmp = aCountry.localeCompare(bCountry, undefined, { sensitivity: "base" });
      if (countryCmp !== 0) return countryCmp;
      return a.farmName.localeCompare(b.farmName, undefined, { sensitivity: "base" });
    });
  }, [farmsRef, countriesRef]);

  const normalizeStatus = (v: unknown): string => {
    const s = String(v ?? "").toLowerCase().trim();
    if (!s) return "";
    if (s.includes("done") || s.includes("complete")) return "Done";
    if (s.includes("future")) return "Future";
    if (s.includes("warning")) return "Warning";
    if (s.includes("ongoing")) return "Ongoing";
    return "";
  };

  const isDeleted = (row: MondayProjectServerRow): boolean =>
    String((row as Record<string, unknown>).deleted ?? "0").trim() === "1";

  const deliveryPeriodLabel = useMemo(() => {
    if (deliveryPeriod === "week") return t("Dashboard.periodWeek");
    if (deliveryPeriod === "month") return t("Dashboard.periodMonth");
    return t("Dashboard.periodQuarter");
  }, [deliveryPeriod, t]);

  /** KPI delivery window `[periodStart, today]` formatted for subtitles (Deliveries charts). */
  const kpiDeliveryWindowRangeLabel = useMemo(() => {
    const startDt = localDateFromYmd(periodStartYmd(deliveryPeriod));
    const endDt = localDateFromYmd(todayYmd());
    return startDt && endDt
      ? `${formatDashboardDateDmYyyy(startDt)} – ${formatDashboardDateDmYyyy(endDt)}`
      : "";
  }, [deliveryPeriod]);

  const kpiActiveProjectsCount = useMemo(() => {
    const ids = new Set<string>();
    for (const row of rows) {
      if (
        !rowMatchesDashboardActiveProjectsKpi(row, {
          excludeProjectsWithoutFarm,
          selectedFarmIdSet,
          excludeCompleted: true,
          deliveryMatch: (r) => projectHasSubitemDeliveryInKpiPeriod(r, deliveryPeriod),
        })
      ) {
        continue;
      }
      const rec = row as Record<string, unknown>;
      const id = String(rec.project_id ?? rec.id ?? "").trim();
      if (id) ids.add(id);
    }
    return ids.size;
  }, [rows, selectedFarmIdSet, excludeProjectsWithoutFarm, deliveryPeriod]);

  /** Distinct projects whose row status is Ongoing / Future / Warning (active-type); excludes Done & unknown. */
  const kpiTotalProjectsCount = useMemo(() => {
    const ids = new Set<string>();
    for (const row of rows) {
      if (
        !rowMatchesDashboardActiveProjectsKpi(row, {
          excludeProjectsWithoutFarm,
          selectedFarmIdSet,
          excludeCompleted: false,
          deliveryMatch: (r) => projectHasSubitemDeliveryInKpiPeriod(r, deliveryPeriod),
        })
      ) {
        continue;
      }
      const rec = row as Record<string, unknown>;
      const id = String(rec.project_id ?? rec.id ?? "").trim();
      if (id) ids.add(id);
    }
    return ids.size;
  }, [rows, selectedFarmIdSet, excludeProjectsWithoutFarm, deliveryPeriod]);

  /** Same rules as active-project count, but delivery lines must fall in the prior period window (trend baseline). */
  const kpiActiveProjectsPriorPeriodCount = useMemo(() => {
    const prior = priorKpiPeriodWindowYmd(deliveryPeriod);
    const ids = new Set<string>();
    for (const row of rows) {
      if (
        !rowMatchesDashboardActiveProjectsKpi(row, {
          excludeProjectsWithoutFarm,
          selectedFarmIdSet,
          excludeCompleted: true,
          deliveryMatch: (r) => projectHasSubitemDeliveryInYmdRange(r, prior.start, prior.end),
        })
      ) {
        continue;
      }
      const rec = row as Record<string, unknown>;
      const id = String(rec.project_id ?? rec.id ?? "").trim();
      if (id) ids.add(id);
    }
    return ids.size;
  }, [rows, selectedFarmIdSet, excludeProjectsWithoutFarm, deliveryPeriod]);

  const activeProjectsListHref = useMemo(() => {
    const q = new URLSearchParams();
    q.set("kpi", "1");
    q.set("period", deliveryPeriod);
    if (excludeProjectsWithoutFarm) q.set("excludeNoFarm", "1");
    return `${ACTIVE_PROJECTS_PAGE_HREF}?${q.toString()}`;
  }, [deliveryPeriod, excludeProjectsWithoutFarm]);

  const kpiProjectTrendMonth = useMemo(() => {
    if (kpiActiveProjectsPriorPeriodCount <= 0) return 0;
    return Math.round(
      ((kpiActiveProjectsCount - kpiActiveProjectsPriorPeriodCount) /
        kpiActiveProjectsPriorPeriodCount) *
      100,
    );
  }, [kpiActiveProjectsCount, kpiActiveProjectsPriorPeriodCount]);

  const kpiProjectTrendVsLabel = useMemo(() => {
    if (deliveryPeriod === "week") return t("Dashboard.kpiVsLastWeek");
    if (deliveryPeriod === "month") return t("Dashboard.kpiVsLastMonth");
    return t("Dashboard.kpiVsLastQuarter");
  }, [deliveryPeriod, t]);

  const kpiDeliveryPeriodStats = useMemo(() => {
    let deliveryLineCount = 0;
    let totalKg = 0;
    let totalM2 = 0;
    const productKg = new Map<string, number>();
    for (const row of rows) {
      if (isDeleted(row)) continue;
      for (const item of parseSubitems((row as Record<string, unknown>).subitems)) {
        const rec = item as Record<string, unknown>;
        if (String(rec.deleted ?? "0").trim() === "1") continue;
        const farmId = String(rec.farm_id ?? "").trim();
        if (hasFarmSelection && !selectedFarmIdSet.has(farmId)) continue;
        const deliveryYmd = normalizeDeliveryHarvestYmd(rec);
        if (!deliveryYmd || !isDeliveryYmdInKpiPeriod(deliveryYmd, deliveryPeriod)) continue;
        deliveryLineCount += 1;
        const qtyRaw = rec.quantity_harvested ?? rec.quantity ?? 0;
        const qty = Number(String(qtyRaw).replace(/,/g, "").trim());
        const uom = String(rec.uom ?? "").trim().toLowerCase();
        if (Number.isFinite(qty) && qty > 0) {
          if (uom === "kg") totalKg += qty;
          if (uom === "m2" || uom === "m²" || uom === "sqm") totalM2 += qty;
        }
        const pid = String(rec.product_id ?? "").trim();
        if (pid && Number.isFinite(qty) && qty > 0) {
          productKg.set(pid, (productKg.get(pid) ?? 0) + qty);
        }
      }
    }
    return { deliveryLineCount, totalKg, totalM2, productKg };
  }, [rows, hasFarmSelection, selectedFarmIdSet, deliveryPeriod]);

  const kpiQtyDeliveredValue = useMemo(() => {
    const { totalKg, totalM2 } = kpiDeliveryPeriodStats;
    const showKg = totalKg > 0 || totalM2 <= 0;
    const showM2 = totalM2 > 0;
    return (
      <span className="flex flex-col gap-1 leading-snug">
        {showKg ? <span>{formatKpiDeliveredAbbrev(totalKg, "kg")}</span> : null}
        {showM2 ? (
          <span
            className={
              showKg ? "text-xl font-semibold text-foreground/90" : "text-2xl font-bold text-foreground"
            }
          >
            {formatKpiDeliveredAbbrev(totalM2, "m²")}
          </span>
        ) : null}
      </span>
    );
  }, [kpiDeliveryPeriodStats]);

  /**
   * Calendar-month delivery pipeline (Harvesting Portal): lines whose estimated or delivery date falls in the
   * current month — estimated (no harvest yet), delivered, in transit (harvested, not delivered), finalized (DO #).
   */
  const deliveryStatusThisMonthCounts = useMemo(() => {
    const currentMonth = todayYmd().slice(0, 7);
    let estimated = 0;
    let delivered = 0;
    let inTransit = 0;
    let finalized = 0;

    for (const row of rows) {
      if (isDeleted(row)) continue;
      if (excludeProjectsWithoutFarm && !projectRowHasFarmAssigned(row)) continue;
      const recRow = row as Record<string, unknown>;
      if (!hasFarmSelection && selectedCountry && String(recRow.country_id ?? "").trim() !== selectedCountry) {
        continue;
      }

      for (const item of parseSubitems(recRow.subitems)) {
        const rec = item as Record<string, unknown>;
        if (String(rec.deleted ?? "0").trim() === "1") continue;
        const farmId = String(rec.farm_id ?? "").trim();
        if (hasFarmSelection && !selectedFarmIdSet.has(farmId)) continue;

        const estYmd = normalizeDateFieldToYmd(rec.estimated_harvest_date);
        const delYmd = normalizeDateFieldToYmd(rec.delivery_harvest_date);
        const estMonth = estYmd && estYmd.length >= 7 ? estYmd.slice(0, 7) : "";
        const delMonth = delYmd && delYmd.length >= 7 ? delYmd.slice(0, 7) : "";
        if (estMonth !== currentMonth && delMonth !== currentMonth) continue;

        const harvestYmd = normalizeDateFieldToYmd(rec.actual_harvest_date);
        const hasHarvest = Boolean(harvestYmd);
        const hasDelivery = Boolean(delYmd);
        const hasEst = Boolean(estYmd);
        const doSo = String(rec.do_so_number ?? "").trim();

        if (!hasHarvest && hasEst) estimated += 1;
        if (hasDelivery) delivered += 1;
        if (hasHarvest && !hasDelivery) inTransit += 1;
        if (hasDelivery && doSo) finalized += 1;
      }
    }
    return { estimated, delivered, inTransit, finalized };
  }, [rows, hasFarmSelection, selectedFarmIdSet, selectedCountry, excludeProjectsWithoutFarm]);

  /** Planned deliveries after today through end of horizon (inclusive), matching Harvesting Portal forecast semantics. */
  const isSubitemInForecastHorizon = (item: Record<string, unknown>): boolean => {
    const deliveryDate = parseDeliveryDate(item);
    const itemFarmId = String(item.farm_id ?? "").trim();

    // When farm(s) are selected, keep undated rows for those farms
    // so dashboard doesn't go blank due to missing delivery_harvest_date.
    if (!deliveryDate) {
      return hasFarmSelection && selectedFarmIdSet.has(itemFarmId);
    }
    if (deliveryDate.getTime() <= forecastTodayStart.getTime()) return false;
    if (deliveryDate.getTime() > forecastHorizonEnd.getTime()) return false;
    return true;
  };

  const allProjectCount = useMemo(() => {
    const ids = new Set<string>();
    for (const row of rows) {
      if (isDeleted(row)) continue;
      if (hasFarmSelection) {
        const hasSelectedFarm = parseSubitems((row as Record<string, unknown>).subitems).some((item) => {
          if (String((item as Record<string, unknown>).deleted ?? "0").trim() === "1") return false;
          const farmId = String((item as Record<string, unknown>).farm_id ?? "").trim();
          return selectedFarmIdSet.has(farmId);
        });
        if (!hasSelectedFarm) continue;
      }
      const hasAnyInDateRange = parseSubitems((row as Record<string, unknown>).subitems).some((item) =>
        isSubitemInForecastHorizon(item as Record<string, unknown>),
      );
      if (!hasAnyInDateRange) continue;
      const id = String((row as Record<string, unknown>).project_id ?? row.id ?? "").trim();
      if (id) ids.add(id);
    }
    return ids.size;
  }, [rows, forecastHorizon, hasFarmSelection, selectedFarmIdSet]);

  const totalCurrentProjects = useMemo(() => {
    const ids = new Set<string>();
    for (const row of rows) {
      if (isDeleted(row)) continue;
      if (hasFarmSelection) {
        const hasSelectedFarm = parseSubitems((row as Record<string, unknown>).subitems).some((item) => {
          if (String((item as Record<string, unknown>).deleted ?? "0").trim() === "1") return false;
          const farmId = String((item as Record<string, unknown>).farm_id ?? "").trim();
          return selectedFarmIdSet.has(farmId);
        });
        if (!hasSelectedFarm) continue;
      }
      const hasAnyInDateRange = parseSubitems((row as Record<string, unknown>).subitems).some((item) =>
        isSubitemInForecastHorizon(item as Record<string, unknown>),
      );
      if (!hasAnyInDateRange) continue;
      const status = normalizeStatus((row as Record<string, unknown>).status_app ?? row.status);
      if (!(status === "Ongoing" || status === "Future" || status === "Warning")) continue;
      const id = String((row as Record<string, unknown>).project_id ?? row.id ?? "").trim();
      if (id) ids.add(id);
    }
    return ids.size;
  }, [rows, forecastHorizon, hasFarmSelection, selectedFarmIdSet]);

  const deliveredTotals = useMemo(() => {
    let sprigKg = 0;
    let sodM2 = 0;
    for (const row of rows) {
      if (isDeleted(row)) continue;
      for (const item of parseSubitems((row as Record<string, unknown>).subitems)) {
        if (String((item as Record<string, unknown>).deleted ?? "0").trim() === "1") continue;
        if (!isSubitemInForecastHorizon(item as Record<string, unknown>)) continue;
        const farmId = String((item as Record<string, unknown>).farm_id ?? "").trim();
        if (hasFarmSelection && !selectedFarmIdSet.has(farmId)) continue;
        const qtyRaw = item.quantity_harvested ?? item.quantity ?? 0;
        const qty = Number(String(qtyRaw).replace(/,/g, "").trim());
        if (!Number.isFinite(qty)) continue;
        const uom = String(item.uom ?? "").trim().toLowerCase();
        if (uom === "kg") sprigKg += qty;
        if (uom === "m2" || uom === "m²" || uom === "sqm") sodM2 += qty;
      }
    }
    return { sprigKg, sodM2 };
  }, [rows, forecastHorizon, hasFarmSelection, selectedFarmIdSet]);

  const countryProjectsChartData = useMemo(() => {
    const singleSelectedFarmCountryId =
      selectedFarmIds.length === 1
        ? farmFilters.find((f) => f.farmId === selectedFarmIds[0])?.countryId ?? null
        : null;
    const effectiveCountryId = singleSelectedFarmCountryId ?? selectedCountry;
    const counts = new Map<string, { country: string; projects: number }>();

    for (const row of rows) {
      if (isDeleted(row)) continue;
      if (
        !rowMatchesDashboardActiveProjectsKpi(row, {
          excludeProjectsWithoutFarm,
          selectedFarmIdSet,
          excludeCompleted: true,
          deliveryMatch: (r) => projectHasSubitemDeliveryInKpiPeriod(r, deliveryPeriod),
        })
      ) {
        continue;
      }
      const rec = row as Record<string, unknown>;

      const rowCountryId = String(rec.country_id ?? "").trim();
      const countryId =
        selectedFarmIds.length === 1
          ? String(singleSelectedFarmCountryId ?? rowCountryId).trim()
          : rowCountryId;
      if (!countryId) continue;
      if (!hasFarmSelection && effectiveCountryId && countryId !== effectiveCountryId) continue;

      const projectId = String(rec.project_id ?? rec.id ?? "").trim();
      if (!projectId) continue;

      const key = `${countryId}`;
      const existing = counts.get(key) ?? {
        country: "",
        projects: 0,
      };

      // Set country name once from countriesRef
      if (!existing.country) {
        let name = "";
        for (const c of countriesRef) {
          if (!c || typeof c !== "object") continue;
          const cr = c as Record<string, unknown>;
          if (String(cr.id ?? "").trim() === countryId) {
            name = String(cr.country_name ?? cr.name ?? "").trim();
            break;
          }
        }
        existing.country = name || countryId;
      }

      // Use a Set per country to ensure unique project ids
      const setKey = `${key}::${projectId}`;
      if (!(counts as unknown as { _seen?: Set<string> })._seen) {
        (counts as unknown as { _seen: Set<string> })._seen = new Set<string>();
      }
      const seen = (counts as unknown as { _seen: Set<string> })._seen;
      if (!seen.has(setKey)) {
        seen.add(setKey);
        existing.projects += 1;
      }

      counts.set(key, existing);
    }

    return Array.from(counts.values()).sort((a, b) => a.country.localeCompare(b.country));
  }, [
    rows,
    countriesRef,
    selectedCountry,
    deliveryPeriod,
    excludeProjectsWithoutFarm,
    selectedFarmIdSet,
    selectedFarmIds,
    farmFilters,
  ]);

  const grassDistributionByUnit = useMemo(() => {
    const productNameById = new Map<string, string>();
    for (const row of productsRef) {
      if (!row || typeof row !== "object") continue;
      const rec = row as Record<string, unknown>;
      if (String(rec.deleted ?? "0").trim() === "1") continue;
      const id = String(rec.id ?? "").trim();
      if (!id) continue;
      productNameById.set(id, String(rec.title ?? rec.name ?? "").trim() || id);
    }

    let farmsForGrass = farmFilters;
    if (selectedCountry) {
      farmsForGrass = farmsForGrass.filter((f) => f.countryId === selectedCountry);
    }
    if (hasFarmSelection) {
      farmsForGrass = farmsForGrass.filter((f) => selectedFarmIdSet.has(f.farmId));
    }
    const allowedFarmIds = new Set(farmsForGrass.map((f) => f.farmId));

    const qtyByProductKg = new Map<string, number>();
    const qtyByProductM2 = new Map<string, number>();
    const kpiRowCtx = {
      excludeProjectsWithoutFarm,
      selectedFarmIdSet,
      deliveryPeriod,
    };
    for (const row of rows) {
      if (isDeleted(row)) continue;
      if (!rowPassesKpiGrassDeliveryPortfolio(row, kpiRowCtx)) continue;
      const prow = row as Record<string, unknown>;
      const rowCountry = String(prow.country_id ?? "").trim();
      if (!hasFarmSelection && selectedCountry && rowCountry !== selectedCountry) continue;

      const subitems = parseSubitems(prow.subitems);
      for (const item of subitems) {
        if (String(item.deleted ?? "0").trim() === "1") continue;
        const farmId = String(item.farm_id ?? "").trim();
        if (!allowedFarmIds.has(farmId)) continue;

        const deliveryYmd = normalizeDeliveryHarvestYmd(item as Record<string, unknown>);
        if (!deliveryYmd || !isDeliveryYmdInKpiPeriod(deliveryYmd, deliveryPeriod)) continue;

        const productId = String(item.product_id ?? "").trim();
        if (!productId) continue;

        const qtyRaw = item.quantity_harvested ?? item.quantity ?? 0;
        const qtyParsed = Number(String(qtyRaw).replace(/,/g, "").trim());
        if (!Number.isFinite(qtyParsed)) continue;
        const uom = String(item.uom ?? "").trim().toLowerCase();
        const hk = harvestTypeStackKey(item as Record<string, unknown>);
        const refSprigKg = parseRefHrvQtySprigNumber(item as Record<string, unknown>);
        /** Sprig kg slice: same logic as deliveryGrassTypePeriodBreakdown — Sod→Sprig can be m² + ref kg only */
        const lineKg =
          uom === "kg" && Number.isFinite(qtyParsed) && qtyParsed > 0 ? qtyParsed : 0;
        let contribKgPie = 0;
        if (hk === "SOD_FOR_SPRIG") {
          contribKgPie = lineKg > 0 ? lineKg : refSprigKg;
        } else if (lineKg > 0) {
          contribKgPie = lineKg;
        }
        if (contribKgPie > 0) {
          qtyByProductKg.set(productId, (qtyByProductKg.get(productId) ?? 0) + contribKgPie);
        }

        const lineM2 =
          (uom === "m2" || uom === "m²" || uom === "sqm") &&
            Number.isFinite(qtyParsed) &&
            qtyParsed > 0
            ? qtyParsed
            : 0;
        if (lineM2 > 0) {
          qtyByProductM2.set(productId, (qtyByProductM2.get(productId) ?? 0) + lineM2);
        }
      }
    }

    const toSeries = (map: Map<string, number>) =>
      Array.from(map.entries())
        .map(([productId, value]) => ({
          productId,
          grass: productNameById.get(productId) ?? productId,
          value,
        }))
        .sort((a, b) => b.value - a.value);

    return {
      kg: toSeries(qtyByProductKg),
      m2: toSeries(qtyByProductM2),
    };
  }, [
    productsRef,
    rows,
    farmFilters,
    selectedCountry,
    hasFarmSelection,
    excludeProjectsWithoutFarm,
    selectedFarmIdSet,
    deliveryPeriod,
  ]);

  /** GRASS KPI card matches chart cohort (portfolio filter): distinct grasses with kg and/or sod m² in window */
  const kpiPortfolioGrassTypesDisplay = useMemo(() => {
    const seen = new Map<string, string>();
    const take = grassDistributionByUnit.kg.concat(grassDistributionByUnit.m2);
    for (const s of take) {
      if (s.value <= 0) continue;
      if (!seen.has(s.productId)) seen.set(s.productId, s.grass);
    }
    const names = Array.from(seen.values()).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
    const subtitle =
      names.length === 0
        ? ""
        : (() => {
            const joined = names.join(", ");
            return joined.length > 100 ? `${joined.slice(0, 97)}…` : joined;
          })();
    return { count: seen.size, subtitle };
  }, [grassDistributionByUnit]);

  const grassDistributionData = useMemo(() => {
    return deliveredByMonthMode === "sprig" ? grassDistributionByUnit.kg : grassDistributionByUnit.m2;
  }, [grassDistributionByUnit, deliveredByMonthMode]);

  const grassPieUnitLabel = deliveredByMonthMode === "sprig" ? "kg" : "m2";

  const deliveredByMonthUnitLabel = deliveredByMonthMode === "sprig" ? "kg" : "m2";

  /**
   * Stacked bar per farm — SOD totals **m²**, SPRIG and Sod→Sprig totals **kg**:
   * Sod→Sprig uses **`ref_hrv_qty_sprig`** (planned sprig kg tied to sod m²); falls back to line kg only if needed.
   */
  const farmQtyDeliveredByHarvestTypeBarData = useMemo(() => {
    let farms = farmFilters;
    if (selectedCountry) {
      farms = farms.filter((f) => f.countryId === selectedCountry);
    }
    if (hasFarmSelection) {
      farms = farms.filter((f) => selectedFarmIdSet.has(f.farmId));
    }

    const byFarmId = new Map<
      string,
      { SOD: number; SPRIG: number; SOD_FOR_SPRIG: number }
    >();
    for (const f of farms) {
      byFarmId.set(f.farmId, { SOD: 0, SPRIG: 0, SOD_FOR_SPRIG: 0 });
    }

    const stackKpiCtx = {
      excludeProjectsWithoutFarm,
      selectedFarmIdSet,
      deliveryPeriod,
    };

    for (const row of rows) {
      if (isDeleted(row)) continue;
      if (!rowPassesKpiGrassDeliveryPortfolio(row, stackKpiCtx)) continue;
      const prow = row as Record<string, unknown>;
      const rowCountry = String(prow.country_id ?? "").trim();
      if (!hasFarmSelection && selectedCountry && rowCountry !== selectedCountry) continue;

      for (const item of parseSubitems(prow.subitems)) {
        const rec = item as Record<string, unknown>;
        if (String(rec.deleted ?? "0").trim() === "1") continue;
        const farmId = String(rec.farm_id ?? "").trim();
        const bucket = byFarmId.get(farmId);
        if (!bucket) continue;
        if (hasFarmSelection && !selectedFarmIdSet.has(farmId)) continue;

        const deliveryYmd = normalizeDeliveryHarvestYmd(rec);
        if (!deliveryYmd || !isDeliveryYmdInKpiPeriod(deliveryYmd, deliveryPeriod)) continue;

        const uom = String(rec.uom ?? "").trim().toLowerCase();
        const qtyRaw = rec.quantity_harvested ?? rec.quantity ?? 0;
        const qtyParsed = Number(String(qtyRaw).replace(/,/g, "").trim());
        const lineKg =
          uom === "kg" && Number.isFinite(qtyParsed) && qtyParsed > 0 ? qtyParsed : 0;
        const lineM2 =
          (uom === "m2" || uom === "m²" || uom === "sqm") &&
            Number.isFinite(qtyParsed) &&
            qtyParsed > 0
            ? qtyParsed
            : 0;

        const refSprigKg = parseRefHrvQtySprigNumber(rec);
        const hk = harvestTypeStackKey(rec);

        if (hk === "SOD") {
          if (lineM2 > 0) bucket.SOD += lineM2;
          continue;
        }
        if (hk === "SPRIG") {
          if (lineKg > 0) bucket.SPRIG += lineKg;
          continue;
        }
        if (hk === "SOD_FOR_SPRIG") {
          const sodForSprigKg =
            refSprigKg > 0 ? refSprigKg : lineKg > 0 ? lineKg : 0;
          if (sodForSprigKg > 0) bucket.SOD_FOR_SPRIG += sodForSprigKg;
        }
      }
    }

    return farms
      .map((f) => {
        const b = byFarmId.get(f.farmId) ?? { SOD: 0, SPRIG: 0, SOD_FOR_SPRIG: 0 };
        return { farm: f.farmName, ...b };
      })
      .filter((d) => d.SOD > 0 || d.SPRIG > 0 || d.SOD_FOR_SPRIG > 0);
  }, [
    rows,
    farmFilters,
    selectedCountry,
    excludeProjectsWithoutFarm,
    hasFarmSelection,
    selectedFarmIdSet,
    deliveryPeriod,
  ]);

  /**
   * Harvesting Portal: delivery lines in the KPI window (stacked-bar parity). Client-side column sort applies next.
   */
  const recentKpiDeliveriesTableRows = useMemo(() => {
    let farms = farmFilters;
    if (selectedCountry) {
      farms = farms.filter((f) => f.countryId === selectedCountry);
    }
    if (hasFarmSelection) {
      farms = farms.filter((f) => selectedFarmIdSet.has(f.farmId));
    }
    const allowedFarmIds = new Set(farms.map((f) => f.farmId));

    const productNameById = new Map<string, string>();
    for (const row of productsRef) {
      if (!row || typeof row !== "object") continue;
      const rec = row as Record<string, unknown>;
      if (String(rec.deleted ?? "0").trim() === "1") continue;
      const id = String(rec.id ?? "").trim();
      if (!id) continue;
      productNameById.set(id, String(rec.title ?? rec.name ?? "").trim() || id);
    }

    type Out = {
      key: string;
      deliveryYmd: string;
      projectLabel: string;
      grassLabel: string;
      harvestKey: FarmStackHarvestKey;
      /** Parsed quantity when present (>0); omitted / zero → show dash in UI. */
      qty: number | null;
      unitLabel: "kg" | "m2";
    };
    const out: Out[] = [];
    let rowKeySeq = 0;
    const recentKpiCtx = {
      excludeProjectsWithoutFarm,
      selectedFarmIdSet,
      deliveryPeriod,
    };

    for (const row of rows) {
      if (isDeleted(row)) continue;
      if (!rowPassesKpiGrassDeliveryPortfolio(row, recentKpiCtx)) continue;
      const projRec = row as Record<string, unknown>;
      const rowCountry = String(projRec.country_id ?? "").trim();
      if (!hasFarmSelection && selectedCountry && rowCountry !== selectedCountry) continue;
      const projectLabel = dashProjectCustomerLabel(projRec);

      for (const item of parseSubitems(projRec.subitems)) {
        const rec = item as Record<string, unknown>;
        if (String(rec.deleted ?? "0").trim() === "1") continue;

        const farmId = String(rec.farm_id ?? "").trim();
        const farmInScope =
          (farmId && allowedFarmIds.has(farmId)) ||
          (!farmId &&
            selectedFarmIdSet.size === 0 &&
            (!selectedCountry || rowCountry === selectedCountry));
        if (!farmInScope) continue;
        const deliveryYmd = normalizeDeliveryHarvestYmd(rec);
        if (!deliveryYmd || !isDeliveryYmdInKpiPeriod(deliveryYmd, deliveryPeriod)) continue;

        const productId = String(rec.product_id ?? "").trim();
        const grassLabel = productId ? productNameById.get(productId) ?? productId : "";

        const uom = String(rec.uom ?? "").trim().toLowerCase();
        const qtyRaw = rec.quantity_harvested ?? rec.quantity ?? 0;
        const qtyParsed = Number(String(qtyRaw).replace(/,/g, "").trim());

        const hk = harvestTypeStackKey(rec);
        const lineKgRaw =
          uom === "kg" && Number.isFinite(qtyParsed) && qtyParsed > 0 ? qtyParsed : 0;
        const refSprigKg = parseRefHrvQtySprigNumber(rec);
        let sprigDisplayKg = 0;
        if (hk === "SOD_FOR_SPRIG") {
          sprigDisplayKg = lineKgRaw > 0 ? lineKgRaw : refSprigKg;
        } else {
          sprigDisplayKg = lineKgRaw;
        }
        const lineM2 =
          (uom === "m2" || uom === "m²" || uom === "sqm") &&
          Number.isFinite(qtyParsed) &&
          qtyParsed > 0
            ? qtyParsed
            : 0;

        let qty: number | null = null;
        let unitLabel: "kg" | "m2" = "kg";
        if (sprigDisplayKg > 0) {
          qty = sprigDisplayKg;
          unitLabel = "kg";
        } else if (lineM2 > 0) {
          qty = lineM2;
          unitLabel = "m2";
        } else if (uom === "m2" || uom === "m²" || uom === "sqm") {
          unitLabel = "m2";
        }

        out.push({
          key: `kpi-recent-${rowKeySeq++}`,
          deliveryYmd,
          projectLabel,
          grassLabel,
          harvestKey: hk,
          qty,
          unitLabel,
        });
      }
    }

    return out;
  }, [
    productsRef,
    rows,
    farmFilters,
    selectedCountry,
    hasFarmSelection,
    excludeProjectsWithoutFarm,
    selectedFarmIdSet,
    deliveryPeriod,
  ]);

  const sortedRecentKpiDeliveriesTableRows = useMemo(() => {
    const list = [...recentKpiDeliveriesTableRows];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "deliveryYmd":
          cmp = compareIsoDateStrings(a.deliveryYmd, b.deliveryYmd, sortDir);
          break;
        case "projectLabel":
          cmp = compareStrings(a.projectLabel, b.projectLabel, sortDir);
          break;
        case "grassLabel":
          cmp = compareStrings(a.grassLabel, b.grassLabel, sortDir);
          break;
        case "harvestKey":
          cmp = compareStrings(a.harvestKey, b.harvestKey, sortDir);
          break;
        case "qty": {
          const aPos = a.qty != null && a.qty > 0 ? a.qty : null;
          const bPos = b.qty != null && b.qty > 0 ? b.qty : null;
          if (aPos == null && bPos == null) {
            cmp = 0;
          } else if (aPos == null) {
            cmp = sortDir === "asc" ? 1 : -1;
          } else if (bPos == null) {
            cmp = sortDir === "asc" ? -1 : 1;
          } else {
            cmp = compareNumbers(aPos, bPos, sortDir);
          }
          break;
        }
        default:
          return 0;
      }
      if (cmp !== 0) return cmp;
      const byDate = compareIsoDateStrings(a.deliveryYmd, b.deliveryYmd, "desc");
      if (byDate !== 0) return byDate;
      return compareStrings(a.key, b.key, "asc");
    });
    return list;
  }, [recentKpiDeliveriesTableRows, sortKey, sortDir]);

  /**
   * Harvesting Portal dashboard: qty by grass product in KPI window — Sprig (kg stacked-bar logic) or Sod (m² lines), synced with charts toggle.
   */
  const deliveryGrassTypePeriodBreakdown = useMemo(() => {
    const wantSprig = deliveredByMonthMode === "sprig";

    let farms = farmFilters;
    if (selectedCountry) {
      farms = farms.filter((f) => f.countryId === selectedCountry);
    }
    if (hasFarmSelection) {
      farms = farms.filter((f) => selectedFarmIdSet.has(f.farmId));
    }
    const allowedFarmIds = new Set(farms.map((f) => f.farmId));

    const productNameById = new Map<string, string>();
    for (const row of productsRef) {
      if (!row || typeof row !== "object") continue;
      const rec = row as Record<string, unknown>;
      if (String(rec.deleted ?? "0").trim() === "1") continue;
      const id = String(rec.id ?? "").trim();
      if (!id) continue;
      productNameById.set(id, String(rec.title ?? rec.name ?? "").trim() || id);
    }

    const byProduct = new Map<string, number>();
    const grassBreakdownCtx = {
      excludeProjectsWithoutFarm,
      selectedFarmIdSet,
      deliveryPeriod,
    };

    for (const row of rows) {
      if (isDeleted(row)) continue;
      if (!rowPassesKpiGrassDeliveryPortfolio(row, grassBreakdownCtx)) continue;
      const prow = row as Record<string, unknown>;
      const rowCountry = String(prow.country_id ?? "").trim();
      if (!hasFarmSelection && selectedCountry && rowCountry !== selectedCountry) continue;

      for (const item of parseSubitems(prow.subitems)) {
        const rec = item as Record<string, unknown>;
        if (String(rec.deleted ?? "0").trim() === "1") continue;
        const farmId = String(rec.farm_id ?? "").trim();
        if (!allowedFarmIds.has(farmId)) continue;

        const deliveryYmd = normalizeDeliveryHarvestYmd(rec);
        if (!deliveryYmd || !isDeliveryYmdInKpiPeriod(deliveryYmd, deliveryPeriod)) continue;

        const productId = String(rec.product_id ?? "").trim();
        if (!productId) continue;

        const uom = String(rec.uom ?? "").trim().toLowerCase();
        const qtyRaw = rec.quantity_harvested ?? rec.quantity ?? 0;
        const qtyParsed = Number(String(qtyRaw).replace(/,/g, "").trim());

        if (wantSprig) {
          const lineKg =
            uom === "kg" && Number.isFinite(qtyParsed) && qtyParsed > 0 ? qtyParsed : 0;
          const refSprigKg = parseRefHrvQtySprigNumber(rec);
          const hk = harvestTypeStackKey(rec);
          let contrib = 0;
          if (hk === "SOD_FOR_SPRIG") {
            contrib = lineKg > 0 ? lineKg : refSprigKg;
          } else if (lineKg > 0) {
            contrib = lineKg;
          } else {
            continue;
          }
          byProduct.set(productId, (byProduct.get(productId) ?? 0) + contrib);
        } else {
          const lineM2 =
            (uom === "m2" || uom === "m²" || uom === "sqm") &&
              Number.isFinite(qtyParsed) &&
              qtyParsed > 0
              ? qtyParsed
              : 0;
          if (lineM2 <= 0) continue;
          byProduct.set(productId, (byProduct.get(productId) ?? 0) + lineM2);
        }
      }
    }

    const unitLabel = wantSprig ? ("kg" as const) : ("m2" as const);
    return Array.from(byProduct.entries())
      .map(([pid, amount]) => ({
        productId: pid,
        name: productNameById.get(pid) ?? pid,
        amount,
        unit: unitLabel,
      }))
      .filter((x) => x.amount > 0)
      .sort((a, b) => b.amount - a.amount);
  }, [
    deliveredByMonthMode,
    productsRef,
    rows,
    farmFilters,
    selectedCountry,
    hasFarmSelection,
    excludeProjectsWithoutFarm,
    selectedFarmIdSet,
    deliveryPeriod,
  ]);

  /** Per-farm horizontal bars: same KPI delivery window & qty rules as stacked bar (“Deliveries”). */
  const deliveredByFarmComposed = useMemo(() => {
    const rangeLabel = kpiDeliveryWindowRangeLabel;

    const wantSprig = deliveredByMonthMode === "sprig";

    let farms = farmFilters;
    if (selectedCountry) {
      farms = farms.filter((f) => f.countryId === selectedCountry);
    }
    if (hasFarmSelection) {
      farms = farms.filter((f) => selectedFarmIdSet.has(f.farmId));
    }

    const farmIds = new Set(farms.map((f) => f.farmId));
    const perFarmTotal = new Map<string, number>();
    for (const f of farms) {
      perFarmTotal.set(f.farmId, 0);
    }

    const composedKpiCtx = {
      excludeProjectsWithoutFarm,
      selectedFarmIdSet,
      deliveryPeriod,
    };

    for (const row of rows) {
      if (isDeleted(row)) continue;
      if (!rowPassesKpiGrassDeliveryPortfolio(row, composedKpiCtx)) continue;
      const rec = row as Record<string, unknown>;
      const rowCountry = String(rec.country_id ?? "").trim();
      if (!hasFarmSelection && selectedCountry && rowCountry !== selectedCountry) continue;

      const subitems = parseSubitems(rec.subitems);
      for (const item of subitems) {
        if (String(item.deleted ?? "0").trim() === "1") continue;
        const itemRec = item as Record<string, unknown>;
        const farmId = String(itemRec.farm_id ?? "").trim();
        if (!farmIds.has(farmId)) continue;

        const deliveryYmd = normalizeDeliveryHarvestYmd(itemRec);
        if (!deliveryYmd || !isDeliveryYmdInKpiPeriod(deliveryYmd, deliveryPeriod)) continue;

        const qtyRaw = itemRec.quantity_harvested ?? itemRec.quantity ?? 0;
        const qtyParsed = Number(String(qtyRaw).replace(/,/g, "").trim());
        const uom = String(itemRec.uom ?? "").trim().toLowerCase();

        if (wantSprig) {
          const lineKg =
            uom === "kg" && Number.isFinite(qtyParsed) && qtyParsed > 0 ? qtyParsed : 0;
          const refSprigKg = parseRefHrvQtySprigNumber(itemRec);
          const hk = harvestTypeStackKey(itemRec);
          let contribKg = 0;
          if (hk === "SOD_FOR_SPRIG") {
            contribKg = lineKg > 0 ? lineKg : refSprigKg;
          } else if (lineKg > 0) {
            contribKg = lineKg;
          } else {
            continue;
          }
          perFarmTotal.set(farmId, (perFarmTotal.get(farmId) ?? 0) + contribKg);
        } else {
          const lineM2 =
            (uom === "m2" || uom === "m²" || uom === "sqm") &&
              Number.isFinite(qtyParsed) &&
              qtyParsed > 0
              ? qtyParsed
              : 0;
          if (lineM2 <= 0) continue;
          perFarmTotal.set(farmId, (perFarmTotal.get(farmId) ?? 0) + lineM2);
        }
      }
    }

    const ranked = farms
      .map((f) => ({
        farm: f.farmName,
        total: perFarmTotal.get(f.farmId) ?? 0,
      }))
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total);

    const othersTail =
      ranked.length > 16 ? ranked.slice(16).reduce((acc, r) => acc + r.total, 0) : 0;
    const chartRows =
      othersTail > 0
        ? [
            ...ranked.slice(0, 16),
            { farm: t("Dashboard.trendOtherFarms"), total: othersTail },
          ]
        : ranked.slice(0, 16);

    return { chartRows, rangeLabel };
  }, [
    rows,
    farmFilters,
    selectedCountry,
    excludeProjectsWithoutFarm,
    hasFarmSelection,
    selectedFarmIdSet,
    deliveredByMonthMode,
    deliveryPeriod,
    kpiDeliveryWindowRangeLabel,
    t,
  ]);

  /** Delivery trend buckets track the selected KPI period: week = days, month = weeks, quarter = months. */
  const deliveredSixMonthFarmTrend = useMemo(() => {
    const timeSlots = buildKpiDeliveryTrendSlots(deliveryPeriod);

    const wantSprig = deliveredByMonthMode === "sprig";

    let farmsFiltered = farmFilters;
    if (selectedCountry) {
      farmsFiltered = farmsFiltered.filter((f) => f.countryId === selectedCountry);
    }
    if (hasFarmSelection) {
      farmsFiltered = farmsFiltered.filter((f) => selectedFarmIdSet.has(f.farmId));
    }

    const farmKey = (id: string) => `k_${String(id).replace(/\W/g, "_")}`;
    const trendOthersKey = "k___trend_other_farms";

    const farmIds = new Set(farmsFiltered.map((f) => f.farmId));
    const trendKpiCtx = {
      excludeProjectsWithoutFarm,
      selectedFarmIdSet,
      deliveryPeriod,
    };
    const perFarmSlot = new Map<string, Map<string, number>>();
    for (const f of farmsFiltered) {
      perFarmSlot.set(f.farmId, new Map(timeSlots.map((m) => [m.key, 0])));
    }

    for (const row of rows) {
      if (isDeleted(row)) continue;
      if (!rowPassesKpiGrassDeliveryPortfolio(row, trendKpiCtx)) continue;
      const rec = row as Record<string, unknown>;
      const rowCountry = String(rec.country_id ?? "").trim();
      if (!hasFarmSelection && selectedCountry && rowCountry !== selectedCountry) continue;

      const subitems = parseSubitems(rec.subitems);
      for (const item of subitems) {
        if (String(item.deleted ?? "0").trim() === "1") continue;
        const itemRec = item as Record<string, unknown>;
        const fid = String(itemRec.farm_id ?? "").trim();
        if (!farmIds.has(fid)) continue;

        const deliveryYmd = normalizeDeliveryHarvestYmd(itemRec);
        if (!deliveryYmd || !isDeliveryYmdInKpiPeriod(deliveryYmd, deliveryPeriod)) continue;
        const slotKey = kpiTrendBucketKeyForDeliveryYmd(deliveryYmd, deliveryPeriod);
        if (!slotKey) continue;
        const inner = perFarmSlot.get(fid);
        if (!inner || !inner.has(slotKey)) continue;

        const uom = String(itemRec.uom ?? "").trim().toLowerCase();
        const qtyRaw = itemRec.quantity_harvested ?? itemRec.quantity ?? 0;
        const qtyParsed = Number(String(qtyRaw).replace(/,/g, "").trim());

        if (wantSprig) {
          const lineKg =
            uom === "kg" && Number.isFinite(qtyParsed) && qtyParsed > 0 ? qtyParsed : 0;
          const refSprigKg = parseRefHrvQtySprigNumber(itemRec);
          const hk = harvestTypeStackKey(itemRec);
          let add = 0;
          if (hk === "SOD_FOR_SPRIG") {
            add = lineKg > 0 ? lineKg : refSprigKg;
          } else if (lineKg > 0) {
            add = lineKg;
          }
          if (add <= 0) continue;
          inner.set(slotKey, (inner.get(slotKey) ?? 0) + add);
        } else {
          const lineM2 =
            (uom === "m2" || uom === "m²" || uom === "sqm") &&
              Number.isFinite(qtyParsed) &&
              qtyParsed > 0
              ? qtyParsed
              : 0;
          if (lineM2 <= 0) continue;
          inner.set(slotKey, (inner.get(slotKey) ?? 0) + lineM2);
        }
      }
    }

    const farmGrandTotals = farmsFiltered.map((f) => {
      let sum = 0;
      const inner = perFarmSlot.get(f.farmId);
      if (inner) {
        for (const v of inner.values()) sum += v;
      }
      return { farm: f, sum };
    });
    const farmsWithVolume = farmGrandTotals
      .filter((x) => x.sum > 0)
      .sort((a, b) => b.sum - a.sum);
    const topFarms = farmsWithVolume.slice(0, 6);
    const topFarmIdSet = new Set(topFarms.map((x) => x.farm.farmId));
    const showOthersSeries = farmsWithVolume.length > 6;

    const data = timeSlots.map(({ key, label }) => {
      const chartRow: Record<string, string | number> = { slotLabel: label };
      let othersSlot = 0;
      for (const f of farmsFiltered) {
        const v = perFarmSlot.get(f.farmId)?.get(key) ?? 0;
        if (topFarmIdSet.has(f.farmId)) {
          chartRow[farmKey(f.farmId)] = v;
        } else {
          othersSlot += v;
        }
      }
      if (showOthersSeries) {
        chartRow[trendOthersKey] = othersSlot;
      }
      return chartRow;
    });

    const series = topFarms.map((x) => ({
      dataKey: farmKey(x.farm.farmId),
      name: x.farm.farmName,
    }));
    if (showOthersSeries) {
      series.push({ dataKey: trendOthersKey, name: t("Dashboard.trendOtherFarms") });
    }

    return { data, series, bucketCount: timeSlots.length };
  }, [
    rows,
    farmFilters,
    selectedCountry,
    excludeProjectsWithoutFarm,
    hasFarmSelection,
    selectedFarmIdSet,
    deliveredByMonthMode,
    deliveryPeriod,
    t,
  ]);

  const selectedFarmNamesLabel = useMemo(() => {
    if (selectedFarmIds.length === 0) return "";
    return selectedFarmIds
      .map((id) => farmFilters.find((f) => f.farmId === id)?.farmName ?? id)
      .join(", ");
  }, [selectedFarmIds, farmFilters]);

  const horizonThroughLabel = useMemo(
    () => formatMonthYearLong(forecastHorizonEnd, locale),
    [forecastHorizonEnd, locale],
  );

  /** Forecast strip: same rules as Harvesting Portal — target = delivery || est, string window (today, horizonEnd], count lines, sum kg. */
  const upcomingDeliveries = useMemo(() => {
    let length = 0;
    let totalKg = 0;
    const todayY = todayYmd();
    const horizonY = dateToLocalYmd(forecastHorizonEnd);
    for (const row of rows) {
      if (isDeleted(row)) continue;
      for (const item of parseSubitems((row as Record<string, unknown>).subitems)) {
        const rec = item as Record<string, unknown>;
        if (String(rec.deleted ?? "0").trim() === "1") continue;
        const farmId = String(rec.farm_id ?? "").trim();
        if (hasFarmSelection && !selectedFarmIdSet.has(farmId)) continue;
        const targetYmd = getForecastTargetYmd(rec);
        if (!targetYmd) continue;
        if (targetYmd <= todayY) continue;
        if (targetYmd > horizonY) continue;
        length += 1;
        const qtyRaw = rec.quantity_harvested ?? rec.quantity ?? 0;
        const qty = Number(String(qtyRaw).replace(/,/g, "").trim());
        const uom = String(rec.uom ?? "").trim().toLowerCase();
        if (Number.isFinite(qty) && qty > 0 && uom === "kg") totalKg += qty;
      }
    }
    return { length, totalKg };
  }, [rows, hasFarmSelection, selectedFarmIdSet, forecastHorizonEnd]);

  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="dashboard-harvesting-skin min-w-0 flex-1">
          <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <div>
              <h2 className="font-heading text-2xl font-bold text-foreground">{t("Dashboard.title")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("Dashboard.subtitle")}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => {
                  setSelectedCountry(null);
                  setHarvestListFarmFilter("");
                }}
                type="button"
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${selectedCountry === null && selectedFarmIds.length === 0
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
              >
                {t("Dashboard.allCountries")}
              </button>
              {farmFilters.map((f) => {
                const farmSelected = selectedFarmIds.includes(f.farmId);
                return (
                  <button
                    key={f.farmId}
                    onClick={() => {
                      setSelectedCountry(null);
                      const next = new Set(selectedFarmIds);
                      if (next.has(f.farmId)) next.delete(f.farmId);
                      else next.add(f.farmId);
                      setHarvestListFarmFilter(Array.from(next).join(","));
                    }}
                    type="button"
                    aria-pressed={farmSelected}
                    className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${farmSelected
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                  >
                    <FarmCountryFlag countryCode={f.countryCode} flagEmoji={f.flag} active={farmSelected} />
                    {f.farmName}
                  </button>
                );
              })}
            </div>

            <div className="glass-card flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t("Dashboard.forecastHorizonSection")}
                </p>
                <p className="mt-0.5 text-sm text-foreground">
                  <span className="font-heading font-bold">{upcomingDeliveries.length}</span>{" "}
                  {t("Dashboard.forecastUpcomingDeliveriesBullet")}{" "}
                  <span className="font-heading font-bold">
                    {(upcomingDeliveries.totalKg / 1000).toFixed(1)}k kg
                  </span>{" "}
                  {t("Dashboard.forecastSprigThrough")}{" "}
                  <span className="font-heading font-semibold">{horizonThroughLabel}</span>
                </p>
              </div>
              <div className="flex gap-1 rounded-lg bg-muted p-0.5">
                {([1, 3, 6, 12] as ForecastHorizonMonths[]).map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setForecastHorizon(h)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${forecastHorizon === h
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                      }`}
                  >
                    {h === 1 ? t("Dashboard.forecastNextMonth") : t("Dashboard.forecastNextNMonths", { months: h })}
                  </button>
                ))}
              </div>
            </div>



            <div className="grid grid-cols-2 items-stretch gap-4 lg:grid-cols-4">
              <Link
                href={activeProjectsListHref}
                className="block h-full min-h-0 transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <KpiCard
                  label={t("Dashboard.kpiActiveProjects")}
                  value={String(kpiActiveProjectsCount)}
                  sub={t("Dashboard.kpiProjectsTotalSub", { count: kpiTotalProjectsCount })}
                  icon={Briefcase}
                  trend={kpiProjectTrendMonth}
                  trendLabel={kpiProjectTrendVsLabel}
                />
              </Link>
              <Link
                href="/harvest"
                className="block h-full min-h-0 transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <KpiCard
                  label={t("Dashboard.kpiDeliveries")}
                  value={String(kpiDeliveryPeriodStats.deliveryLineCount)}
                  sub={deliveryPeriodLabel}
                  icon={Truck}
                />
              </Link>
              <Link
                href="/harvest"
                className="block h-full min-h-0 transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <KpiCard
                  label={t("Dashboard.kpiQtyDelivered")}
                  value={kpiQtyDeliveredValue}
                  sub={deliveryPeriodLabel}
                  icon={Package}
                />
              </Link>
              <div className="h-full min-h-0">
                <KpiCard
                  label={t("Dashboard.kpiGrassTypes")}
                  value={String(kpiPortfolioGrassTypesDisplay.count)}
                  sub={kpiPortfolioGrassTypesDisplay.subtitle}
                  icon={TrendingUp}
                />
              </div>
            </div>

            <div>
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="font-heading text-lg font-semibold text-foreground">
                  {t("Dashboard.kpiDeliveries")}
                </h3>
                <div className="flex gap-1 rounded-lg bg-muted p-0.5">
                  {(["week", "month", "quarter"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setDeliveryPeriod(p)}
                      className={kpiDeliveryPeriodSegmentClass(deliveryPeriod === p)}
                    >
                      {p === "week"
                        ? t("Dashboard.periodWeek")
                        : p === "month"
                          ? t("Dashboard.periodMonth")
                          : t("Dashboard.periodQuarter")}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <DeliveryStatusBadge
                  count={deliveryStatusThisMonthCounts.estimated}
                  label={t("Dashboard.deliveryStatusEstimated")}
                  colorDot="bg-blue-400"
                />
                <DeliveryStatusBadge
                  count={deliveryStatusThisMonthCounts.delivered}
                  label={t("Dashboard.deliveryStatusDelivered")}
                  colorDot="bg-primary"
                />
                <DeliveryStatusBadge
                  count={deliveryStatusThisMonthCounts.inTransit}
                  label={t("Dashboard.deliveryStatusInTransit")}
                  colorDot="bg-amber-400"
                />
                <DeliveryStatusBadge
                  count={deliveryStatusThisMonthCounts.finalized}
                  label={t("Dashboard.deliveryStatusFinalized")}
                  colorDot="bg-emerald-600"
                />
              </div>
            </div>

            <div>
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="font-heading text-lg font-semibold text-foreground">{t("Dashboard.chartsHeading")}</h3>
                <button
                  type="button"
                  onClick={() => setShowAnalyticsPanels((v) => !v)}
                  className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border bg-muted/50 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                  aria-pressed={!showAnalyticsPanels}
                >
                  {showAnalyticsPanels ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  {showAnalyticsPanels ? t("Dashboard.hideCharts") : t("Dashboard.showCharts")}
                </button>
              </div>

              {showAnalyticsPanels ? (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  {/* QUANTITY DELIVERED BY TYPE PER FARM */}
                  <div className="glass-card col-span-1 rounded-xl p-5 lg:col-span-2">
                    <h3 className="font-heading mb-1 text-sm font-semibold text-foreground">
                      {t("Dashboard.qtyDeliveredByTypePerFarm", { period: deliveryPeriodLabel })}
                    </h3>
                    <p className="mb-4 text-xs text-muted-foreground">
                      {t("Dashboard.qtyStackedHarvestUnitHint")}
                    </p>
                    {farmQtyDeliveredByHarvestTypeBarData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={farmQtyDeliveredByHarvestTypeBarData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="farm" tick={{ fontSize: 12 }} />
                          <YAxis
                            tick={{ fontSize: 12 }}
                            tickFormatter={(v: number) =>
                              v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                            }
                            label={{
                              value: t("Dashboard.qtyStackedHarvestYAxisLabel"),
                              angle: -90,
                              position: "insideLeft",
                              style: { fontSize: 11, fill: "hsl(var(--muted-foreground))" },
                              offset: -4,
                            }}
                          />
                          <Tooltip
                            formatter={(v: number, name: string) => [
                              `${v.toLocaleString()} ${name === "SOD" ? "m²" : "kg"}`,
                              name === "SOD"
                                ? t("Dashboard.chartLegendSodWithUnit")
                                : name === "SPRIG"
                                  ? t("Dashboard.chartLegendSprigWithUnit")
                                  : name === "SOD_FOR_SPRIG"
                                    ? t("Dashboard.chartLegendSodForSprigWithUnit")
                                    : name,
                            ]}
                            contentStyle={{
                              borderRadius: "8px",
                              border: "1px solid hsl(var(--border))",
                            }}
                          />
                          <Legend
                            formatter={(v) =>
                              v === "SOD_FOR_SPRIG"
                                ? t("Dashboard.chartLegendSodForSprigWithUnit")
                                : v === "SOD"
                                  ? t("Dashboard.chartLegendSodWithUnit")
                                  : v === "SPRIG"
                                    ? t("Dashboard.chartLegendSprigWithUnit")
                                    : v
                            }
                          />
                          <Bar
                            dataKey="SOD"
                            stackId="a"
                            fill={FARM_STACKED_HARVEST_COLORS.SOD}
                            radius={[0, 0, 0, 0]}
                          />
                          <Bar dataKey="SPRIG" stackId="a" fill={FARM_STACKED_HARVEST_COLORS.SPRIG} />
                          <Bar
                            dataKey="SOD_FOR_SPRIG"
                            stackId="a"
                            fill={FARM_STACKED_HARVEST_COLORS.SOD_FOR_SPRIG}
                            radius={[4, 4, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <p className="py-10 text-center text-sm text-muted-foreground">
                        {t("Dashboard.chartNoDeliveriesThisPeriod")}
                      </p>
                    )}
                  </div>


                  {/* PROJECTS BY COUNTRY */}
                  <div className="glass-card rounded-xl p-5">
                    <h3 className="font-heading mb-4 text-sm font-semibold text-foreground">
                      {t("Dashboard.projectsByCountry")}
                    </h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={countryProjectsChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="country" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "8px",
                          }}
                        />
                        <Bar
                          dataKey="projects"
                          fill={PORTAL_CHARTS_GRID_PROJECTS_BY_COUNTRY_BAR}
                          radius={[8, 8, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* GRASS TYPE DISTRIBUTION */}
                  <div className="glass-card rounded-xl p-5">
                    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h3 className="font-heading text-sm font-semibold text-foreground">
                          {t("Dashboard.grassTypeDistribution")}
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground/80">{deliveryPeriodLabel}</span>
                          {kpiDeliveryWindowRangeLabel ? (
                            <>
                              {" · "}
                              <span className="font-medium text-foreground/80">
                                {kpiDeliveryWindowRangeLabel}
                              </span>
                            </>
                          ) : null}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1 rounded-lg bg-muted p-0.5">
                        <button
                          type="button"
                          onClick={() => setDeliveredByMonthMode("sprig")}
                          className={sprigSodSegmentClass(deliveredByMonthMode === "sprig")}
                        >
                          {t("Dashboard.sprigKgToggle")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeliveredByMonthMode("sod")}
                          className={sprigSodSegmentClass(deliveredByMonthMode === "sod")}
                        >
                          {t("Dashboard.sodM2Toggle")}
                        </button>
                      </div>
                    </div>
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={grassDistributionData}
                          dataKey="value"
                          nameKey="grass"
                          cx="50%"
                          cy="50%"
                          outerRadius={100}
                          label={(entry: unknown) =>
                            `${String((entry as { grass?: string }).grass ?? "")} ${String(
                              ((entry as { percent?: number }).percent ?? 0) * 100,
                            ).slice(0, 2)}%`
                          }
                          labelLine={{
                            stroke: "hsl(var(--muted-foreground))",
                            strokeWidth: 0.5,
                          }}
                        >
                          {grassDistributionData.map((entry, index) => (
                            <Cell
                              key={entry.productId}
                              fill={
                                PORTAL_CHARTS_GRID_GRASS_PIE_COLORS[
                                index % PORTAL_CHARTS_GRID_GRASS_PIE_COLORS.length
                                ]
                              }
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value: number) => `${value.toLocaleString()} ${grassPieUnitLabel}`}
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "8px",
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  {/* DELIVERED BY FARM */}
                  <div className="glass-card rounded-xl p-5">
                    <div className="mb-2 flex items-center justify-between">
                      <div>
                        <h3 className="font-heading text-sm font-semibold text-foreground">
                          {deliveredByMonthMode === "sprig"
                            ? t("Dashboard.deliveredByFarmSprig")
                            : t("Dashboard.deliveredByFarmSod")}
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("Dashboard.farmAxisHintPrefix")}
                          {" "}
                          <span className="font-medium text-foreground/80">{deliveryPeriodLabel}</span>
                          {kpiDeliveryWindowRangeLabel ? (
                            <>
                              {" · "}
                              <span className="font-medium text-foreground/80">
                                {kpiDeliveryWindowRangeLabel}
                              </span>
                            </>
                          ) : null}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1 rounded-lg bg-muted p-0.5">
                        <button
                          type="button"
                          onClick={() => setDeliveredByMonthMode("sprig")}
                          className={sprigSodSegmentClass(deliveredByMonthMode === "sprig")}
                        >
                          {t("Dashboard.sprigKg")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeliveredByMonthMode("sod")}
                          className={sprigSodSegmentClass(deliveredByMonthMode === "sod")}
                        >
                          {t("Dashboard.sodM2")}
                        </button>
                      </div>
                    </div>
                    {deliveredByFarmComposed.chartRows.length === 0 ? (
                      <p className="py-8 text-sm text-muted-foreground">{t("Dashboard.noFarmsForFilters")}</p>
                    ) : (
                      <ResponsiveContainer
                        width="100%"
                        height={Math.max(320, deliveredByFarmComposed.chartRows.length * 40)}
                      >
                        <ComposedChart
                          layout="vertical"
                          data={deliveredByFarmComposed.chartRows}
                          margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                          <XAxis
                            type="number"
                            tick={{ fontSize: 11 }}
                            tickFormatter={(v: number) => v.toLocaleString()}
                            label={{
                              value: `${t("Common.quantity")} (${deliveredByMonthUnitLabel})`,
                              position: "insideBottom",
                              offset: -4,
                              style: { fontSize: 11, fill: "hsl(var(--muted-foreground))" },
                            }}
                          />
                          <YAxis
                            type="category"
                            dataKey="farm"
                            width={120}
                            tick={{ fontSize: 11 }}
                            interval={0}
                          />
                          <Tooltip
                            formatter={(value: number) => [
                              `${value.toLocaleString()} ${deliveredByMonthUnitLabel}`,
                              deliveredByFarmComposed.rangeLabel,
                            ]}
                            contentStyle={{
                              backgroundColor: "hsl(var(--card))",
                              border: "1px solid hsl(var(--border))",
                              borderRadius: "8px",
                            }}
                          />
                          <Bar
                            dataKey="total"
                            name={deliveredByFarmComposed.rangeLabel}
                            fill={PORTAL_CHARTS_GRID_DELIVERED_BY_FARM_BAR}
                            radius={[0, 8, 8, 0]}
                            barSize={18}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    )}
                  </div>

                  {/* FORECAST DELIVERY TRENDS */}
                  <div className="glass-card rounded-xl p-5">
                    <div className="mb-4 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-heading text-sm font-semibold leading-snug text-foreground">
                          {t("Dashboard.forecastDeliveryTrendsTitle", {
                            period: deliveryPeriodLabel,
                          })}
                        </h3>
                        {kpiDeliveryWindowRangeLabel ? (
                          <p className="mt-1 font-heading text-xs font-medium text-muted-foreground">
                            {kpiDeliveryWindowRangeLabel}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 gap-1 rounded-lg bg-muted p-0.5">
                        <button
                          type="button"
                          onClick={() => setDeliveredByMonthMode("sprig")}
                          className={sprigSodSegmentClass(deliveredByMonthMode === "sprig")}
                        >
                          {t("Dashboard.sprigKg")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeliveredByMonthMode("sod")}
                          className={sprigSodSegmentClass(deliveredByMonthMode === "sod")}
                        >
                          {t("Dashboard.sodM2")}
                        </button>
                      </div>
                    </div>
                    {deliveredSixMonthFarmTrend.series.length === 0 ||
                    deliveredSixMonthFarmTrend.bucketCount === 0 ? (
                      <p className="py-8 text-sm text-muted-foreground">{t("Dashboard.noTrendsForFilters")}</p>
                    ) : (
                      <ResponsiveContainer width="100%" height={320}>
                        <LineChart data={deliveredSixMonthFarmTrend.data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="slotLabel" tick={{ fontSize: 12 }} />
                          <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => v.toLocaleString()} />
                          <Tooltip
                            formatter={(value: number) => `${value.toLocaleString()} ${deliveredByMonthUnitLabel}`}
                            contentStyle={{
                              backgroundColor: "hsl(var(--card))",
                              border: "1px solid hsl(var(--border))",
                              borderRadius: "8px",
                            }}
                          />
                          <Legend
                            wrapperStyle={{ fontSize: 12, paddingTop: 16 }}
                            iconType="circle"
                            formatter={(value) => <span className="text-foreground">{value}</span>}
                          />
                          {deliveredSixMonthFarmTrend.series.map((s, i) => {
                            const stroke =
                              PORTAL_CHARTS_GRID_TREND_LINE_COLORS[
                              i % PORTAL_CHARTS_GRID_TREND_LINE_COLORS.length
                              ];
                            return (
                              <Line
                                key={s.dataKey}
                                type="monotone"
                                dataKey={s.dataKey}
                                name={s.name}
                                stroke={stroke}
                                strokeWidth={2}
                                dot={{ r: 3, fill: stroke, stroke, strokeWidth: 0 }}
                                activeDot={{ r: 5 }}
                              />
                            );
                          })}
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
              ) : (
                <div className="glass-card rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                  {t("Dashboard.chartsHiddenBanner")}
                </div>
              )}
            </div>

            {deliveryGrassTypePeriodBreakdown.length > 0 ? (
              <div className="glass-card rounded-xl p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-heading text-sm font-semibold text-foreground">
                    {t("Dashboard.deliveryByGrassTypeTitle", { period: deliveryPeriodLabel })}
                  </h3>
                  <div className="flex shrink-0 gap-1 rounded-lg bg-muted p-0.5">
                    <button
                      type="button"
                      onClick={() => setDeliveredByMonthMode("sprig")}
                      className={sprigSodSegmentClass(deliveredByMonthMode === "sprig")}
                    >
                      {t("Dashboard.sprigKg")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeliveredByMonthMode("sod")}
                      className={sprigSodSegmentClass(deliveredByMonthMode === "sod")}
                    >
                      {t("Dashboard.sodM2")}
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {deliveryGrassTypePeriodBreakdown.map((g) => (
                    <div key={g.productId} className="rounded-lg bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">{g.name}</p>
                      <p className="font-heading text-lg font-bold text-foreground">
                        {g.amount >= 1000
                          ? `${(g.amount / 1000).toFixed(1)}k`
                          : g.amount.toLocaleString()}{" "}
                        {g.unit === "kg" ? "kg" : "m²"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="glass-card rounded-xl p-5">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h3 className="font-heading text-sm font-semibold text-foreground">
                    {t("Dashboard.recentDeliveriesTitle", { period: deliveryPeriodLabel })}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[
                      kpiDeliveryWindowRangeLabel,
                      hasFarmSelection && selectedFarmNamesLabel ? selectedFarmNamesLabel : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <SortableTh
                        label={t("Dashboard.recentDeliveriesDate")}
                        columnKey="deliveryYmd"
                        activeKey={sortKey}
                        direction={sortDir}
                        onSort={onSort}
                        className="px-3 py-2"
                      />
                      <SortableTh
                        label={t("Dashboard.recentDeliveriesProject")}
                        columnKey="projectLabel"
                        activeKey={sortKey}
                        direction={sortDir}
                        onSort={onSort}
                        className="px-3 py-2"
                      />
                      <SortableTh
                        label={t("Dashboard.recentDeliveriesGrass")}
                        columnKey="grassLabel"
                        activeKey={sortKey}
                        direction={sortDir}
                        onSort={onSort}
                        className="px-3 py-2"
                      />
                      <SortableTh
                        label={t("Dashboard.recentDeliveriesType")}
                        columnKey="harvestKey"
                        activeKey={sortKey}
                        direction={sortDir}
                        onSort={onSort}
                        className="px-3 py-2"
                      />
                      <SortableTh
                        label={t("Dashboard.recentDeliveriesQuantityColumn")}
                        columnKey="qty"
                        activeKey={sortKey}
                        direction={sortDir}
                        onSort={onSort}
                        align="right"
                        className="px-3 py-2"
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {recentKpiDeliveriesTableRows.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">
                          {t("Dashboard.recentDeliveriesEmpty")}
                        </td>
                      </tr>
                    ) : (
                      sortedRecentKpiDeliveriesTableRows.map((h) => (
                        <tr key={h.key} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="py-2.5 px-3">{formatRecentDeliveryTableDate(h.deliveryYmd)}</td>
                          <td className="max-w-[140px] truncate py-2.5 px-3 text-foreground" title={h.projectLabel}>
                            {h.projectLabel || "—"}
                          </td>
                          <td className="py-2.5 px-3">{h.grassLabel || "—"}</td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                                h.harvestKey === "SOD"
                                  ? "bg-primary/10 text-primary"
                                  : h.harvestKey === "SPRIG"
                                    ? "bg-accent/10 text-accent"
                                    : "bg-info/10 text-info"
                              }`}
                            >
                              {h.harvestKey === "SOD_FOR_SPRIG"
                                ? t("Dashboard.chartLegendSodForSprig")
                                : h.harvestKey}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-medium tabular-nums text-foreground">
                            {h.qty != null && h.qty > 0
                              ? `${h.qty.toLocaleString()} ${h.unitLabel === "kg" ? "kg" : "m²"}`
                              : t("Dashboard.recentDeliveriesQtyPlaceholder")}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </DashboardLayout>
    </RequireAuth>
  );
}
