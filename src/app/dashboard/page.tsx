"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import Link from "next/link";
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
  AlignLeft,
  ArrowDown,
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
import { RainfallSection } from "@/features/dashboard/ui/RainfallSection";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { useSyncedFarmMultiSelect } from "@/shared/hooks/useSyncedFarmMultiSelect";
import {
  filterFarmCatalogByScope,
  useFarmUserScope,
} from "@/shared/store/farmUserScope";
import { fetchMondayProjectRowsFromServer, type MondayProjectServerRow } from "@/entities/projects";
import { sortMondayProjectRows } from "@/features/project";
import { stsProxyGetHarvestingIndex } from "@/shared/api/stsProxyClient";
import { parseJsonMaybe, parseQuantityRequiredRows, parseSubitems } from "@/shared/lib/parseJsonMaybe";
import { MultiSelect } from "@/shared/ui/multi-select";
import { cn } from "@/lib/utils";
import { bgSurfaceFilter } from "@/shared/lib/surfaceFilter";
import { filterRowsByFarmZoneGrassSelection } from "@/shared/lib/grassFilterByFarmZone";
import { useGrassFilterByFarm } from "@/shared/hooks/useGrassFilterByFarm";
import { useAppTranslations } from "@/shared/i18n/useAppTranslations";
import { SortableTh } from "@/components/ui/sortable-th";
import { useTableColumnSort } from "@/shared/hooks/useTableColumnSort";
import {
  compareNumbers,
  compareStrings,
  compareIsoDateStrings,
} from "@/shared/lib/tableSort";
import { DashboardKpiDateFilter } from "@/features/dashboard/DashboardKpiDateFilter";
import {
  dateToLocalYmd,
  isDeliveryYmdInYmdRange,
  kpiDateRangeFromFilter,
  kpiPresetToLegacyPeriod,
  kpiTrendBucketModeForRange,
  normalizeDateFieldToYmd,
  normalizeDeliveryHarvestYmd,
  priorKpiPeriodWindowYmdFromRange,
  projectHasSubitemDeliveryInYmdRange,
  projectRowHasFarmAssigned,
  rowMatchesDashboardActiveProjectsKpi,
  todayYmd,
  type KpiDeliveryDateFilter,
  type KpiTrendBucketMode,
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

function parseDashboardSubitemQty(rec: Record<string, unknown>): number {
  const qtyRaw = rec.quantity_harvested ?? rec.quantity ?? 0;
  const qtyParsed = Number(String(qtyRaw).replace(/,/g, "").trim());
  return Number.isFinite(qtyParsed) && qtyParsed > 0 ? qtyParsed : 0;
}

/**
 * Sod→Sprig: DB `uom` is often m² but `quantity` is sprig kg — count only toward kg totals.
 * SOD (not Sod→Sprig): m² uom → m²; SPRIG: kg uom → kg.
 */
function dashboardDeliveryKgM2Split(rec: Record<string, unknown>): { kg: number; m2: number } {
  const qty = parseDashboardSubitemQty(rec);
  if (qty <= 0) return { kg: 0, m2: 0 };
  if (harvestTypeStackKey(rec) === "SOD_FOR_SPRIG") return { kg: qty, m2: 0 };
  const uom = String(rec.uom ?? "").trim().toLowerCase();
  if (uom === "m2" || uom === "m²" || uom === "sqm") return { kg: 0, m2: qty };
  if (uom === "kg") return { kg: qty, m2: 0 };
  return { kg: 0, m2: 0 };
}

/** Integer pie labels that always sum to 100% (largest remainder). */
function integerPercentsSummingTo100(values: number[]): number[] {
  if (values.length === 0) return [];
  const total = values.reduce((sum, v) => sum + v, 0);
  if (total <= 0) return values.map(() => 0);

  const raw = values.map((v) => (v / total) * 100);
  const floors = raw.map((v) => Math.floor(v));
  const remainder = 100 - floors.reduce((sum, v) => sum + v, 0);

  const ranked = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const result = [...floors];
  for (let k = 0; k < remainder; k++) {
    result[ranked[k].i] += 1;
  }
  return result;
}

function countryCodeToFlag(code: string): string {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return "🏳️";
  return String.fromCodePoint(
    normalized.charCodeAt(0) + 127397,
    normalized.charCodeAt(1) + 127397,
  );
}

function toRecArray(rows: unknown[]): Record<string, unknown>[] {
  return rows.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
}

function rowMatchesCountryFilter(rowCountryId: string, countryFilterIds: string[]): boolean {
  if (countryFilterIds.length === 0) return true;
  return countryFilterIds.includes(rowCountryId);
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

/** Delivery line must match selected grass (product) ids. */
function subitemMatchesGrassFilter(
  rec: Record<string, unknown>,
  grassFilterIds: string[],
): boolean {
  if (grassFilterIds.length === 0) return true;
  const pid = String(rec.product_id ?? "").trim();
  return Boolean(pid) && grassFilterIds.includes(pid);
}

function projectRowHasGrassProductId(row: MondayProjectServerRow, productId: string): boolean {
  if (rowHasGrassProduct(row, productId)) return true;
  for (const item of parseSubitems((row as Record<string, unknown>).subitems)) {
    if (String(item.deleted ?? "0").trim() === "1") continue;
    if (String(item.product_id ?? "").trim() === String(productId ?? "").trim()) return true;
  }
  return false;
}

function rowMatchesGrassFilter(row: MondayProjectServerRow, grassFilterIds: string[]): boolean {
  if (grassFilterIds.length === 0) return true;
  return grassFilterIds.some((id) => projectRowHasGrassProductId(row, id));
}

type DashboardDeliverySubitemScope = {
  grassFilterIds: string[];
  countryFilterIds: string[];
  rowCountry: string;
  allowedFarmIds: Set<string>;
  selectedFarmIdSet: Set<string>;
  kpiRangeStart: string;
  kpiRangeEnd: string;
};

function deliverySubitemPassesDashboardFilters(
  rec: Record<string, unknown>,
  scope: DashboardDeliverySubitemScope,
): boolean {
  if (!subitemMatchesGrassFilter(rec, scope.grassFilterIds)) return false;
  const farmId = String(rec.farm_id ?? "").trim();
  if (
    !subitemFarmInKpiDashboardScope(
      farmId,
      scope.rowCountry,
      scope.allowedFarmIds,
      scope.selectedFarmIdSet,
      scope.countryFilterIds,
    )
  ) {
    return false;
  }
  const deliveryYmd = normalizeDeliveryHarvestYmd(rec);
  if (
    !deliveryYmd ||
    !isDeliveryYmdInYmdRange(deliveryYmd, scope.kpiRangeStart, scope.kpiRangeEnd)
  ) {
    return false;
  }
  return true;
}

function buildDashboardAllowedFarmIds(
  farms: Array<{ farmId: string; countryId: string }>,
  countryFilterIds: string[],
  selectedFarmIdSet: Set<string>,
): Set<string> {
  let list = farms;
  if (countryFilterIds.length > 0) {
    list = list.filter((f) => countryFilterIds.includes(f.countryId));
  }
  if (selectedFarmIdSet.size > 0) {
    list = list.filter((f) => selectedFarmIdSet.has(f.farmId));
  }
  return new Set(list.map((f) => f.farmId));
}

/** ≥1 delivered line in range matching dashboard country / farm / grass filters. */
function projectHasDashboardFilteredDeliveryInRange(
  row: MondayProjectServerRow,
  scope: Omit<DashboardDeliverySubitemScope, "rowCountry">,
): boolean {
  const rec = row as Record<string, unknown>;
  const fullScope: DashboardDeliverySubitemScope = {
    ...scope,
    rowCountry: String(rec.country_id ?? "").trim(),
  };
  for (const item of parseSubitems(rec.subitems)) {
    if (String(item.deleted ?? "0").trim() === "1") continue;
    if (deliverySubitemPassesDashboardFilters(item as Record<string, unknown>, fullScope)) {
      return true;
    }
  }
  return false;
}

type DashboardKpiPortfolioCtx = {
  excludeProjectsWithoutFarm: boolean;
  selectedFarmIdSet: Set<string>;
  grassFilterIds: string[];
  countryFilterIds: string[];
  allowedFarmIds: Set<string>;
  kpiRangeStart: string;
  kpiRangeEnd: string;
};

function filterFarmFiltersByCountry<
  T extends { countryId: string },
>(farms: T[], countryFilterIds: string[]): T[] {
  if (countryFilterIds.length === 0) return farms;
  return farms.filter((f) => countryFilterIds.includes(f.countryId));
}

function rowPassesDashboardCountryGrassFilters(
  row: MondayProjectServerRow,
  countryFilterIds: string[],
  grassFilterIds: string[],
): boolean {
  const rec = row as Record<string, unknown>;
  const rowCountry = String(rec.country_id ?? "").trim();
  if (!rowMatchesCountryFilter(rowCountry, countryFilterIds)) return false;
  if (!rowMatchesGrassFilter(row, grassFilterIds)) return false;
  return true;
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

/** X-axis buckets for delivery trend from selected date range. */
function buildKpiDeliveryTrendSlots(
  startYmd: string,
  endYmd: string,
  bucketMode: KpiTrendBucketMode,
): KpiTrendTimeSlot[] {
  const startD = localDateFromYmd(startYmd);
  const endD = localDateFromYmd(endYmd);
  if (!startD || !endD) return [];
  const startStrip = stripTimeLocal(startD);
  const endStrip = stripTimeLocal(endD);

  if (bucketMode === "day") {
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

  if (bucketMode === "week") {
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

/** Maps a delivery_yyyymmdd to the trend-slot key for the selected bucket mode. */
function kpiTrendBucketKeyForDeliveryYmd(
  deliveryYmd: string,
  bucketMode: KpiTrendBucketMode,
): string | null {
  const d = localDateFromYmd(deliveryYmd);
  if (!d) return null;
  if (bucketMode === "month") {
    return deliveryYmd.length >= 7 ? deliveryYmd.slice(0, 7) : null;
  }
  const strip = stripTimeLocal(d);
  if (bucketMode === "day") return dateToLocalYmd(strip);
  const monday = mondayOnOrBeforeCalendar(strip);
  return dateToLocalYmd(monday);
}

function rowPassesKpiGrassDeliveryPortfolio(
  row: MondayProjectServerRow,
  ctx: DashboardKpiPortfolioCtx,
): boolean {
  return rowMatchesDashboardActiveProjectsKpi(row, {
    excludeProjectsWithoutFarm: ctx.excludeProjectsWithoutFarm,
    selectedFarmIdSet: ctx.selectedFarmIdSet,
    excludeCompleted: true,
    deliveryMatch: (r) =>
      projectHasDashboardFilteredDeliveryInRange(r, {
        grassFilterIds: ctx.grassFilterIds,
        countryFilterIds: ctx.countryFilterIds,
        allowedFarmIds: ctx.allowedFarmIds,
        selectedFarmIdSet: ctx.selectedFarmIdSet,
        kpiRangeStart: ctx.kpiRangeStart,
        kpiRangeEnd: ctx.kpiRangeEnd,
      }),
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

/** KPI qty card, recent-deliveries summary, and table footer — full numbers (no k/M). */
function formatKpiDeliveredQty(n: number, unit: "kg" | "m²"): string {
  const v = Number.isFinite(n) && n >= 0 ? n : 0;
  const formatted = Number.isInteger(v)
    ? v.toLocaleString()
    : v.toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  return `${formatted} ${unit}`;
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

function formatDashTableYmd(ymd: string): string {
  const datePart = ymd.includes(" ") ? ymd.split(" ")[0]!.trim() : ymd.trim();
  const parts = datePart.split("-").map(Number);
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return datePart || "—";
  const [y, m, day] = parts;
  const d = new Date(y!, m! - 1, day);
  if (Number.isNaN(d.getTime())) return datePart || "—";
  return formatDashboardDateDmYyyy(d);
}

function isDashProjectLabelPlaceholder(raw: string): boolean {
  const s = String(raw ?? "").trim();
  return !s || /^n\/a$/i.test(s);
}

/** Project column: company → title/name → golf club (`alias_title`); skips empty / "N/A". */
function dashProjectCustomerLabel(rec: Record<string, unknown>): string {
  const company = String(rec.company_name ?? "").trim();
  const title = String(rec.title ?? rec.name ?? rec.project_name ?? "").trim();
  const alias = String(rec.alias_title ?? "").trim();
  for (const candidate of [company, title, alias]) {
    if (!isDashProjectLabelPlaceholder(candidate)) return candidate;
  }
  return "";
}

function subitemFarmInKpiDashboardScope(
  farmId: string,
  rowCountry: string,
  allowedFarmIds: Set<string>,
  selectedFarmIdSet: Set<string>,
  countryFilterIds: string[],
): boolean {
  return (
    (Boolean(farmId) && allowedFarmIds.has(farmId)) ||
    (!farmId &&
      selectedFarmIdSet.size === 0 &&
      rowMatchesCountryFilter(rowCountry, countryFilterIds))
  );
}

/** Dedicated active-projects view (`app/projects/active-projects/page.tsx`). */
const ACTIVE_PROJECTS_PAGE_HREF = "/projects/active-projects";

export default function DashboardPage() {
  const t = useAppTranslations();
  const [countryFilterIds, setCountryFilterIds] = useState<string[]>([]);
  const [grassFilterIds, setGrassFilterIds] = useState<string[]>([]);
  const { selectedFarmIds, setSelectedFarmIds } = useSyncedFarmMultiSelect("dashboard");
  const { scopeIds, farmUserMeta, canViewAllModule } = useFarmUserScope("dashboard");
  const harvestFarmMeta = useMemo(
    () => (canViewAllModule ? undefined : farmUserMeta),
    [canViewAllModule, farmUserMeta],
  );
  const selectedFarmIdSet = useMemo(() => new Set(selectedFarmIds), [selectedFarmIds]);
  const hasFarmSelection = selectedFarmIds.length > 0;
  /** Default view: omit projects with no `farm_id` on any subitem until a filter is applied. */
  const excludeProjectsWithoutFarm =
    countryFilterIds.length === 0 && !hasFarmSelection && grassFilterIds.length === 0;
  const [kpiDateFilter, setKpiDateFilter] = useState<KpiDeliveryDateFilter>({
    preset: "lastMonth",
  });
  const kpiDateRange = useMemo(() => kpiDateRangeFromFilter(kpiDateFilter), [kpiDateFilter]);
  const kpiTrendBucketMode = useMemo(
    () => kpiTrendBucketModeForRange(kpiDateRange.start, kpiDateRange.end),
    [kpiDateRange],
  );
  const [deliveredByMonthMode, setDeliveredByMonthMode] = useState<"sprig" | "sod">("sprig");
  const [rows, setRows] = useState<MondayProjectServerRow[]>([]);
  const [showAnalyticsPanels, setShowAnalyticsPanels] = useState(true);
  const recentDeliveriesSectionRef = useRef<HTMLDivElement>(null);
  const scrollToRecentDeliveries = () => {
    recentDeliveriesSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const kpiCardScrollClass =
    "block h-full min-h-0 w-full cursor-pointer text-left transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
  const { sortKey, sortDir, onSort } = useTableColumnSort<RecentDeliveriesSortKey>(
    "deliveryYmd",
    "desc",
  );
  const farmsRef = useHarvestingDataStore((s) => s.farms);
  const scopedFarms = useMemo(
    () => filterFarmCatalogByScope(farmsRef, scopeIds),
    [farmsRef, scopeIds],
  );
  const countriesRef = useHarvestingDataStore((s) => s.countries);
  const activeCountriesRef = useHarvestingDataStore((s) => s.activeCountries);
  const productsRef = useHarvestingDataStore((s) => s.products);
  const grassesRef = useHarvestingDataStore((s) => s.grasses);
  const zoneConfigurations = useHarvestingDataStore((s) => s.zoneConfigurations);
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
            ...(harvestFarmMeta ? { farm_user_id: harvestFarmMeta } : {}),
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
  }, [harvestFarmMeta]);

  const farmFilters = useMemo(() => {
    const countriesById = new Map<string, { countryName: string; countryCode: string }>();
    for (const row of activeCountriesRef) {
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

    for (const row of scopedFarms) {
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
  }, [scopedFarms, activeCountriesRef]);

  /** Farms that narrow the grass filter: explicit farm pick, else all farms in selected countries. */
  const grassFilterFarmIds = useMemo(() => {
    if (selectedFarmIds.length > 0) return selectedFarmIds;
    if (countryFilterIds.length === 0) return [];
    const countrySet = new Set(countryFilterIds);
    return farmFilters
      .filter((f) => countrySet.has(f.countryId))
      .map((f) => f.farmId);
  }, [selectedFarmIds, countryFilterIds, farmFilters]);

  const { grassFilterOptions, allowedGrassIdsForSelectedFarms } = useGrassFilterByFarm({
    grasses: grassesRef as unknown[],
    zoneConfigs: zoneConfigurations,
    selectedFarmIds: grassFilterFarmIds,
    selectedGrassIds: grassFilterIds,
    onSelectedGrassIdsChange: setGrassFilterIds,
    catalogMode: "all",
  });

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
    switch (kpiDateFilter.preset) {
      case "today":
        return t("Dashboard.datePresetToday");
      case "yesterday":
        return t("Dashboard.datePresetYesterday");
      case "lastWeek":
        return t("Dashboard.periodWeek");
      case "lastMonth":
        return t("Dashboard.periodMonth");
      case "lastQuarter":
        return t("Dashboard.periodQuarter");
      case "custom": {
        const startDt = localDateFromYmd(kpiDateRange.start);
        const endDt = localDateFromYmd(kpiDateRange.end);
        if (startDt && endDt) {
          if (kpiDateRange.start === kpiDateRange.end) {
            return formatDashboardDateDmYyyy(startDt);
          }
          return `${formatDashboardDateDmYyyy(startDt)} – ${formatDashboardDateDmYyyy(endDt)}`;
        }
        return t("Dashboard.datePresetCustom");
      }
      default:
        return t("Dashboard.periodMonth");
    }
  }, [kpiDateFilter.preset, kpiDateRange, t]);

  /** KPI delivery window formatted for subtitles (Deliveries charts). */
  const kpiDeliveryWindowRangeLabel = useMemo(() => {
    const startDt = localDateFromYmd(kpiDateRange.start);
    const endDt = localDateFromYmd(kpiDateRange.end);
    return startDt && endDt
      ? `${formatDashboardDateDmYyyy(startDt)} – ${formatDashboardDateDmYyyy(endDt)}`
      : "";
  }, [kpiDateRange]);

  const dashboardAllowedFarmIds = useMemo(
    () => buildDashboardAllowedFarmIds(farmFilters, countryFilterIds, selectedFarmIdSet),
    [farmFilters, countryFilterIds, selectedFarmIdSet],
  );

  const kpiActiveProjectsCount = useMemo(() => {
    const ids = new Set<string>();
    for (const row of rows) {
      if (!rowPassesDashboardCountryGrassFilters(row, countryFilterIds, grassFilterIds)) continue;
      if (
        !rowMatchesDashboardActiveProjectsKpi(row, {
          excludeProjectsWithoutFarm,
          selectedFarmIdSet,
          excludeCompleted: true,
          deliveryMatch: (r) =>
            projectHasDashboardFilteredDeliveryInRange(r, {
              grassFilterIds,
              countryFilterIds,
              allowedFarmIds: dashboardAllowedFarmIds,
              selectedFarmIdSet,
              kpiRangeStart: kpiDateRange.start,
              kpiRangeEnd: kpiDateRange.end,
            }),
        })
      ) {
        continue;
      }
      const rec = row as Record<string, unknown>;
      const id = String(rec.project_id ?? rec.id ?? "").trim();
      if (id) ids.add(id);
    }
    return ids.size;
  }, [
    rows,
    selectedFarmIdSet,
    excludeProjectsWithoutFarm,
    kpiDateRange,
    countryFilterIds,
    grassFilterIds,
    dashboardAllowedFarmIds,
  ]);

  /** Distinct projects with a filtered delivery in range (any status, for “X total” sub-label). */
  const kpiTotalProjectsCount = useMemo(() => {
    const ids = new Set<string>();
    for (const row of rows) {
      if (!rowPassesDashboardCountryGrassFilters(row, countryFilterIds, grassFilterIds)) continue;
      if (
        !rowMatchesDashboardActiveProjectsKpi(row, {
          excludeProjectsWithoutFarm,
          selectedFarmIdSet,
          excludeCompleted: false,
          deliveryMatch: (r) =>
            projectHasDashboardFilteredDeliveryInRange(r, {
              grassFilterIds,
              countryFilterIds,
              allowedFarmIds: dashboardAllowedFarmIds,
              selectedFarmIdSet,
              kpiRangeStart: kpiDateRange.start,
              kpiRangeEnd: kpiDateRange.end,
            }),
        })
      ) {
        continue;
      }
      const rec = row as Record<string, unknown>;
      const id = String(rec.project_id ?? rec.id ?? "").trim();
      if (id) ids.add(id);
    }
    return ids.size;
  }, [
    rows,
    selectedFarmIdSet,
    excludeProjectsWithoutFarm,
    kpiDateRange,
    countryFilterIds,
    grassFilterIds,
    dashboardAllowedFarmIds,
  ]);

  /** Same rules as active-project count, but delivery lines must fall in the prior period window (trend baseline). */
  const kpiActiveProjectsPriorPeriodCount = useMemo(() => {
    const prior = priorKpiPeriodWindowYmdFromRange(kpiDateRange.start, kpiDateRange.end);
    const ids = new Set<string>();
    for (const row of rows) {
      if (!rowPassesDashboardCountryGrassFilters(row, countryFilterIds, grassFilterIds)) continue;
      if (
        !rowMatchesDashboardActiveProjectsKpi(row, {
          excludeProjectsWithoutFarm,
          selectedFarmIdSet,
          excludeCompleted: true,
          deliveryMatch: (r) =>
            projectHasDashboardFilteredDeliveryInRange(r, {
              grassFilterIds,
              countryFilterIds,
              allowedFarmIds: dashboardAllowedFarmIds,
              selectedFarmIdSet,
              kpiRangeStart: prior.start,
              kpiRangeEnd: prior.end,
            }),
        })
      ) {
        continue;
      }
      const rec = row as Record<string, unknown>;
      const id = String(rec.project_id ?? rec.id ?? "").trim();
      if (id) ids.add(id);
    }
    return ids.size;
  }, [
    rows,
    selectedFarmIdSet,
    excludeProjectsWithoutFarm,
    kpiDateRange,
    countryFilterIds,
    grassFilterIds,
    dashboardAllowedFarmIds,
  ]);

  const activeProjectsListHref = useMemo(() => {
    const q = new URLSearchParams();
    q.set("kpi", "1");
    const legacyPeriod = kpiPresetToLegacyPeriod(kpiDateFilter.preset);
    if (legacyPeriod) q.set("period", legacyPeriod);
    q.set("deliveryFrom", kpiDateRange.start);
    q.set("deliveryTo", kpiDateRange.end);
    if (excludeProjectsWithoutFarm) q.set("excludeNoFarm", "1");
    return `${ACTIVE_PROJECTS_PAGE_HREF}?${q.toString()}`;
  }, [kpiDateFilter.preset, kpiDateRange, excludeProjectsWithoutFarm]);

  const kpiProjectTrendMonth = useMemo(() => {
    if (kpiActiveProjectsPriorPeriodCount <= 0) return 0;
    return Math.round(
      ((kpiActiveProjectsCount - kpiActiveProjectsPriorPeriodCount) /
        kpiActiveProjectsPriorPeriodCount) *
      100,
    );
  }, [kpiActiveProjectsCount, kpiActiveProjectsPriorPeriodCount]);

  const kpiProjectTrendVsLabel = useMemo(() => {
    switch (kpiDateFilter.preset) {
      case "today":
        return t("Dashboard.kpiVsYesterday");
      case "yesterday":
        return t("Dashboard.kpiVsPriorPeriod");
      case "lastWeek":
        return t("Dashboard.kpiVsLastWeek");
      case "lastMonth":
        return t("Dashboard.kpiVsLastMonth");
      case "lastQuarter":
        return t("Dashboard.kpiVsLastQuarter");
      default:
        return t("Dashboard.kpiVsPriorPeriod");
    }
  }, [kpiDateFilter.preset, t]);

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
      if (!rowPassesDashboardCountryGrassFilters(row, countryFilterIds, grassFilterIds)) continue;
      const recRow = row as Record<string, unknown>;

      const rowCountry = String(recRow.country_id ?? "").trim();
      for (const item of parseSubitems(recRow.subitems)) {
        const rec = item as Record<string, unknown>;
        if (String(rec.deleted ?? "0").trim() === "1") continue;
        if (!subitemMatchesGrassFilter(rec, grassFilterIds)) continue;
        const farmId = String(rec.farm_id ?? "").trim();
        if (hasFarmSelection && !selectedFarmIdSet.has(farmId)) continue;
        if (!rowMatchesCountryFilter(rowCountry, countryFilterIds)) continue;

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
  }, [rows, hasFarmSelection, selectedFarmIdSet, countryFilterIds, grassFilterIds, excludeProjectsWithoutFarm]);

  const countryProjectsChartData = useMemo(() => {
    const counts = new Map<string, { country: string; projects: number }>();

    for (const row of rows) {
      if (isDeleted(row)) continue;
      if (!rowMatchesGrassFilter(row, grassFilterIds)) continue;
      if (
        !rowMatchesDashboardActiveProjectsKpi(row, {
          excludeProjectsWithoutFarm,
          selectedFarmIdSet,
          excludeCompleted: true,
          deliveryMatch: (r) =>
            projectHasDashboardFilteredDeliveryInRange(r, {
              grassFilterIds,
              countryFilterIds,
              allowedFarmIds: dashboardAllowedFarmIds,
              selectedFarmIdSet,
              kpiRangeStart: kpiDateRange.start,
              kpiRangeEnd: kpiDateRange.end,
            }),
        })
      ) {
        continue;
      }
      const rec = row as Record<string, unknown>;

      const countryId = String(rec.country_id ?? "").trim();
      if (!countryId) continue;
      if (!rowMatchesCountryFilter(countryId, countryFilterIds)) continue;

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
    countryFilterIds,
    grassFilterIds,
    kpiDateRange,
    excludeProjectsWithoutFarm,
    selectedFarmIdSet,
    dashboardAllowedFarmIds,
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
    if (countryFilterIds.length > 0) {
      farmsForGrass = farmsForGrass.filter((f) => countryFilterIds.includes(f.countryId));
    }
    if (hasFarmSelection) {
      farmsForGrass = farmsForGrass.filter((f) => selectedFarmIdSet.has(f.farmId));
    }
    const allowedFarmIds = new Set(farmsForGrass.map((f) => f.farmId));

    const qtyByProductKg = new Map<string, number>();
    const qtyByProductM2 = new Map<string, number>();
    const kpiRowCtx: DashboardKpiPortfolioCtx = {
      excludeProjectsWithoutFarm,
      selectedFarmIdSet,
      grassFilterIds,
      countryFilterIds,
      allowedFarmIds: dashboardAllowedFarmIds,
      kpiRangeStart: kpiDateRange.start,
      kpiRangeEnd: kpiDateRange.end,
    };
    for (const row of rows) {
      if (isDeleted(row)) continue;
      if (!rowPassesDashboardCountryGrassFilters(row, countryFilterIds, grassFilterIds)) continue;
      if (!rowPassesKpiGrassDeliveryPortfolio(row, kpiRowCtx)) continue;
      const prow = row as Record<string, unknown>;

      const rowCountry = String(prow.country_id ?? "").trim();
      const deliveryScope: DashboardDeliverySubitemScope = {
        grassFilterIds,
        countryFilterIds,
        rowCountry,
        allowedFarmIds,
        selectedFarmIdSet,
        kpiRangeStart: kpiDateRange.start,
        kpiRangeEnd: kpiDateRange.end,
      };
      const subitems = parseSubitems(prow.subitems);
      for (const item of subitems) {
        if (String(item.deleted ?? "0").trim() === "1") continue;
        const itemRec = item as Record<string, unknown>;
        if (!deliverySubitemPassesDashboardFilters(itemRec, deliveryScope)) continue;

        const productId = String(item.product_id ?? "").trim();
        if (!productId) continue;

        const { kg: splitKg, m2: splitM2 } = dashboardDeliveryKgM2Split(itemRec);
        if (splitKg <= 0 && splitM2 <= 0) continue;

        if (splitKg > 0) {
          qtyByProductKg.set(productId, (qtyByProductKg.get(productId) ?? 0) + splitKg);
        }
        if (splitM2 > 0) {
          qtyByProductM2.set(productId, (qtyByProductM2.get(productId) ?? 0) + splitM2);
        }
      }
    }

    const toSeries = (map: Map<string, number>) =>
      filterRowsByFarmZoneGrassSelection(
        Array.from(map.entries())
          .map(([productId, value]) => ({
            productId,
            grass: productNameById.get(productId) ?? productId,
            value,
          }))
          .sort((a, b) => b.value - a.value),
        allowedGrassIdsForSelectedFarms,
      );

    return {
      kg: toSeries(qtyByProductKg),
      m2: toSeries(qtyByProductM2),
    };
  }, [
    productsRef,
    rows,
    farmFilters,
    countryFilterIds,
    grassFilterIds,
    hasFarmSelection,
    excludeProjectsWithoutFarm,
    selectedFarmIdSet,
    kpiDateRange,
    kpiTrendBucketMode,
    dashboardAllowedFarmIds,
    allowedGrassIdsForSelectedFarms,
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
    const raw =
      deliveredByMonthMode === "sprig" ? grassDistributionByUnit.kg : grassDistributionByUnit.m2;
    const displayPercents = integerPercentsSummingTo100(raw.map((item) => item.value));
    return raw.map((item, index) => ({
      ...item,
      displayPercent: displayPercents[index],
    }));
  }, [grassDistributionByUnit, deliveredByMonthMode]);

  const grassPieUnitLabel = deliveredByMonthMode === "sprig" ? "kg" : "m2";

  const deliveredByMonthUnitLabel = deliveredByMonthMode === "sprig" ? "kg" : "m2";

  /**
   * Stacked bar per farm — SOD totals **m²**, SPRIG and Sod→Sprig totals **kg**:
   * Sod→Sprig uses plan **`quantity`** for kg stack totals.
   */
  const farmQtyDeliveredByHarvestTypeBarData = useMemo(() => {
    let farms = farmFilters;
    if (countryFilterIds.length > 0) {
      farms = farms.filter((f) => countryFilterIds.includes(f.countryId));
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

    const stackKpiCtx: DashboardKpiPortfolioCtx = {
      excludeProjectsWithoutFarm,
      selectedFarmIdSet,
      grassFilterIds,
      countryFilterIds,
      allowedFarmIds: dashboardAllowedFarmIds,
      kpiRangeStart: kpiDateRange.start,
      kpiRangeEnd: kpiDateRange.end,
    };

    for (const row of rows) {
      if (isDeleted(row)) continue;
      if (!rowPassesDashboardCountryGrassFilters(row, countryFilterIds, grassFilterIds)) continue;
      if (!rowPassesKpiGrassDeliveryPortfolio(row, stackKpiCtx)) continue;
      const prow = row as Record<string, unknown>;

      const rowCountry = String(prow.country_id ?? "").trim();
      const stackDeliveryScope: DashboardDeliverySubitemScope = {
        grassFilterIds,
        countryFilterIds,
        rowCountry,
        allowedFarmIds: new Set(farms.map((f) => f.farmId)),
        selectedFarmIdSet,
        kpiRangeStart: kpiDateRange.start,
        kpiRangeEnd: kpiDateRange.end,
      };
      for (const item of parseSubitems(prow.subitems)) {
        const rec = item as Record<string, unknown>;
        if (String(rec.deleted ?? "0").trim() === "1") continue;
        if (!deliverySubitemPassesDashboardFilters(rec, stackDeliveryScope)) continue;
        const farmId = String(rec.farm_id ?? "").trim();
        const bucket = byFarmId.get(farmId);
        if (!bucket) continue;

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
            Number.isFinite(qtyParsed) && qtyParsed > 0 ? qtyParsed : 0;
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
    countryFilterIds,
    grassFilterIds,
    excludeProjectsWithoutFarm,
    hasFarmSelection,
    selectedFarmIdSet,
    kpiDateRange,
    kpiTrendBucketMode,
    dashboardAllowedFarmIds,
  ]);

  /**
   * Harvesting Portal: delivery lines in the KPI window (stacked-bar parity). Client-side column sort applies next.
   */
  const recentKpiDeliveriesTableRows = useMemo(() => {
    let farms = farmFilters;
    if (countryFilterIds.length > 0) {
      farms = farms.filter((f) => countryFilterIds.includes(f.countryId));
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
    const recentKpiCtx: DashboardKpiPortfolioCtx = {
      excludeProjectsWithoutFarm,
      selectedFarmIdSet,
      grassFilterIds,
      countryFilterIds,
      allowedFarmIds: dashboardAllowedFarmIds,
      kpiRangeStart: kpiDateRange.start,
      kpiRangeEnd: kpiDateRange.end,
    };

    for (const row of rows) {
      if (isDeleted(row)) continue;
      if (!rowPassesDashboardCountryGrassFilters(row, countryFilterIds, grassFilterIds)) continue;
      if (!rowPassesKpiGrassDeliveryPortfolio(row, recentKpiCtx)) continue;
      const projRec = row as Record<string, unknown>;
      const rowCountry = String(projRec.country_id ?? "").trim();
      const projectLabel = dashProjectCustomerLabel(projRec);

      const deliveryScope: DashboardDeliverySubitemScope = {
        grassFilterIds,
        countryFilterIds,
        rowCountry,
        allowedFarmIds,
        selectedFarmIdSet,
        kpiRangeStart: kpiDateRange.start,
        kpiRangeEnd: kpiDateRange.end,
      };
      for (const item of parseSubitems(projRec.subitems)) {
        const rec = item as Record<string, unknown>;
        if (String(rec.deleted ?? "0").trim() === "1") continue;
        if (!deliverySubitemPassesDashboardFilters(rec, deliveryScope)) continue;
        const deliveryYmd = normalizeDeliveryHarvestYmd(rec)!;

        const productId = String(rec.product_id ?? "").trim();
        const grassLabel = productId ? productNameById.get(productId) ?? productId : "";

        const uom = String(rec.uom ?? "").trim().toLowerCase();
        const hk = harvestTypeStackKey(rec);
        const { kg: splitKg, m2: splitM2 } = dashboardDeliveryKgM2Split(rec);

        let qty: number | null = null;
        let unitLabel: "kg" | "m2" = "kg";
        if (splitKg > 0) {
          qty = splitKg;
          unitLabel = "kg";
        } else if (splitM2 > 0) {
          qty = splitM2;
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
    countryFilterIds,
    grassFilterIds,
    hasFarmSelection,
    excludeProjectsWithoutFarm,
    selectedFarmIdSet,
    kpiDateRange,
    kpiTrendBucketMode,
    dashboardAllowedFarmIds,
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

  /** KPI delivery cards + recent-deliveries table share the same line cohort. */
  const kpiDeliveryPeriodStats = useMemo(() => {
    let totalKg = 0;
    let totalM2 = 0;
    for (const line of recentKpiDeliveriesTableRows) {
      if (line.qty == null || line.qty <= 0) continue;
      if (line.unitLabel === "kg") totalKg += line.qty;
      else totalM2 += line.qty;
    }
    return {
      deliveryLineCount: recentKpiDeliveriesTableRows.length,
      totalKg,
      totalM2,
    };
  }, [recentKpiDeliveriesTableRows]);

  const kpiQtyDeliveredValue = useMemo(() => {
    const { totalKg, totalM2 } = kpiDeliveryPeriodStats;
    const showKg = totalKg > 0 || totalM2 <= 0;
    const showM2 = totalM2 > 0;
    return (
      <span className="flex flex-col gap-1 leading-snug">
        {showKg ? <span>{formatKpiDeliveredQty(totalKg, "kg")}</span> : null}
        {showM2 ? (
          <span
            className={
              showKg ? "text-xl font-semibold text-foreground/90" : "text-2xl font-bold text-foreground"
            }
          >
            {formatKpiDeliveredQty(totalM2, "m²")}
          </span>
        ) : null}
      </span>
    );
  }, [kpiDeliveryPeriodStats]);

  const recentDeliveriesTableTotals = useMemo(() => {
    let totalKg = 0;
    let totalM2 = 0;
    const projectKeys = new Set<string>();
    const grassNames = new Set<string>();
    for (const line of recentKpiDeliveriesTableRows) {
      const label = String(line.projectLabel ?? "").trim();
      if (!isDashProjectLabelPlaceholder(label)) {
        projectKeys.add(normalizeCustomerNameKey(label));
      }
      const grass = String(line.grassLabel ?? "").trim();
      if (grass) grassNames.add(grass);
      if (line.qty == null || line.qty <= 0) continue;
      if (line.unitLabel === "kg") totalKg += line.qty;
      else totalM2 += line.qty;
    }
    const grassTypeNames = [...grassNames].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
    const joinedGrass = grassTypeNames.join(", ");
    return {
      deliveryLineCount: recentKpiDeliveriesTableRows.length,
      projectCount: projectKeys.size,
      totalKg,
      totalM2,
      grassTypeCount: grassNames.size,
      grassTypeNames: joinedGrass.length > 100 ? `${joinedGrass.slice(0, 97)}…` : joinedGrass,
    };
  }, [recentKpiDeliveriesTableRows]);

  const recentDeliveriesSummaryLine = useMemo(() => {
    if (recentDeliveriesTableTotals.deliveryLineCount <= 0) return "";
    const parts = [
      t("Dashboard.recentDeliveriesFooterDeliveries", {
        count: recentDeliveriesTableTotals.deliveryLineCount,
      }),
      t("Dashboard.recentDeliveriesFooterProjects", {
        count: recentDeliveriesTableTotals.projectCount,
      }),
      t("Dashboard.recentDeliveriesFooterGrassTypes", {
        count: recentDeliveriesTableTotals.grassTypeCount,
      }),
    ];
    if (recentDeliveriesTableTotals.totalKg > 0) {
      parts.push(formatKpiDeliveredQty(recentDeliveriesTableTotals.totalKg, "kg"));
    }
    if (recentDeliveriesTableTotals.totalM2 > 0) {
      parts.push(formatKpiDeliveredQty(recentDeliveriesTableTotals.totalM2, "m²"));
    }
    return parts.join(" · ");
  }, [recentDeliveriesTableTotals, t]);

  /**
   * Harvesting Portal dashboard: qty by grass product in KPI window — Sprig (kg stacked-bar logic) or Sod (m² lines), synced with charts toggle.
   */
  const deliveryGrassTypePeriodBreakdown = useMemo(() => {
    const wantSprig = deliveredByMonthMode === "sprig";

    let farms = farmFilters;
    if (countryFilterIds.length > 0) {
      farms = farms.filter((f) => countryFilterIds.includes(f.countryId));
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
    const grassBreakdownCtx: DashboardKpiPortfolioCtx = {
      excludeProjectsWithoutFarm,
      selectedFarmIdSet,
      grassFilterIds,
      countryFilterIds,
      allowedFarmIds: dashboardAllowedFarmIds,
      kpiRangeStart: kpiDateRange.start,
      kpiRangeEnd: kpiDateRange.end,
    };

    for (const row of rows) {
      if (isDeleted(row)) continue;
      if (!rowPassesDashboardCountryGrassFilters(row, countryFilterIds, grassFilterIds)) continue;
      if (!rowPassesKpiGrassDeliveryPortfolio(row, grassBreakdownCtx)) continue;
      const prow = row as Record<string, unknown>;

      const rowCountry = String(prow.country_id ?? "").trim();
      const breakdownScope: DashboardDeliverySubitemScope = {
        grassFilterIds,
        countryFilterIds,
        rowCountry,
        allowedFarmIds,
        selectedFarmIdSet,
        kpiRangeStart: kpiDateRange.start,
        kpiRangeEnd: kpiDateRange.end,
      };
      for (const item of parseSubitems(prow.subitems)) {
        const rec = item as Record<string, unknown>;
        if (String(rec.deleted ?? "0").trim() === "1") continue;
        if (!deliverySubitemPassesDashboardFilters(rec, breakdownScope)) continue;

        const productId = String(rec.product_id ?? "").trim();
        if (!productId) continue;

        const { kg: splitKg, m2: splitM2 } = dashboardDeliveryKgM2Split(rec);
        const contrib = wantSprig ? splitKg : splitM2;
        if (contrib <= 0) continue;
        byProduct.set(productId, (byProduct.get(productId) ?? 0) + contrib);
      }
    }

    const unitLabel = wantSprig ? ("kg" as const) : ("m2" as const);
    return filterRowsByFarmZoneGrassSelection(
      Array.from(byProduct.entries())
        .map(([pid, amount]) => ({
          productId: pid,
          name: productNameById.get(pid) ?? pid,
          amount,
          unit: unitLabel,
        }))
        .filter((x) => x.amount > 0)
        .sort((a, b) => b.amount - a.amount),
      allowedGrassIdsForSelectedFarms,
    );
  }, [
    deliveredByMonthMode,
    productsRef,
    rows,
    farmFilters,
    countryFilterIds,
    grassFilterIds,
    hasFarmSelection,
    excludeProjectsWithoutFarm,
    selectedFarmIdSet,
    kpiDateRange,
    kpiTrendBucketMode,
    dashboardAllowedFarmIds,
    allowedGrassIdsForSelectedFarms,
  ]);

  /** Per-farm horizontal bars: same KPI delivery window & qty rules as stacked bar (“Deliveries”). */
  const deliveredByFarmComposed = useMemo(() => {
    const rangeLabel = kpiDeliveryWindowRangeLabel;

    const wantSprig = deliveredByMonthMode === "sprig";

    let farms = farmFilters;
    if (countryFilterIds.length > 0) {
      farms = farms.filter((f) => countryFilterIds.includes(f.countryId));
    }
    if (hasFarmSelection) {
      farms = farms.filter((f) => selectedFarmIdSet.has(f.farmId));
    }

    const farmIds = new Set(farms.map((f) => f.farmId));
    const perFarmTotal = new Map<string, number>();
    for (const f of farms) {
      perFarmTotal.set(f.farmId, 0);
    }

    const composedKpiCtx: DashboardKpiPortfolioCtx = {
      excludeProjectsWithoutFarm,
      selectedFarmIdSet,
      grassFilterIds,
      countryFilterIds,
      allowedFarmIds: dashboardAllowedFarmIds,
      kpiRangeStart: kpiDateRange.start,
      kpiRangeEnd: kpiDateRange.end,
    };

    for (const row of rows) {
      if (isDeleted(row)) continue;
      if (!rowPassesDashboardCountryGrassFilters(row, countryFilterIds, grassFilterIds)) continue;
      if (!rowPassesKpiGrassDeliveryPortfolio(row, composedKpiCtx)) continue;
      const rec = row as Record<string, unknown>;

      const rowCountry = String(rec.country_id ?? "").trim();
      const composedScope: DashboardDeliverySubitemScope = {
        grassFilterIds,
        countryFilterIds,
        rowCountry,
        allowedFarmIds: farmIds,
        selectedFarmIdSet,
        kpiRangeStart: kpiDateRange.start,
        kpiRangeEnd: kpiDateRange.end,
      };
      const subitems = parseSubitems(rec.subitems);
      for (const item of subitems) {
        if (String(item.deleted ?? "0").trim() === "1") continue;
        const itemRec = item as Record<string, unknown>;
        if (!deliverySubitemPassesDashboardFilters(itemRec, composedScope)) continue;
        const farmId = String(itemRec.farm_id ?? "").trim();
        if (!farmIds.has(farmId)) continue;

        const { kg: splitKg, m2: splitM2 } = dashboardDeliveryKgM2Split(itemRec);
        const contrib = wantSprig ? splitKg : splitM2;
        if (contrib <= 0) continue;
        perFarmTotal.set(farmId, (perFarmTotal.get(farmId) ?? 0) + contrib);
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
    countryFilterIds,
    grassFilterIds,
    excludeProjectsWithoutFarm,
    hasFarmSelection,
    selectedFarmIdSet,
    deliveredByMonthMode,
    kpiDateRange,
    kpiTrendBucketMode,
    kpiDeliveryWindowRangeLabel,
    dashboardAllowedFarmIds,
    t,
  ]);

  /** Delivery trend buckets track the selected KPI period: week = days, month = weeks, quarter = months. */
  const deliveredSixMonthFarmTrend = useMemo(() => {
    const timeSlots = buildKpiDeliveryTrendSlots(
      kpiDateRange.start,
      kpiDateRange.end,
      kpiTrendBucketMode,
    );

    const wantSprig = deliveredByMonthMode === "sprig";

    let farmsFiltered = farmFilters;
    if (countryFilterIds.length > 0) {
      farmsFiltered = farmsFiltered.filter((f) => countryFilterIds.includes(f.countryId));
    }
    if (hasFarmSelection) {
      farmsFiltered = farmsFiltered.filter((f) => selectedFarmIdSet.has(f.farmId));
    }

    const farmKey = (id: string) => `k_${String(id).replace(/\W/g, "_")}`;
    const trendOthersKey = "k___trend_other_farms";

    const farmIds = new Set(farmsFiltered.map((f) => f.farmId));
    const trendKpiCtx: DashboardKpiPortfolioCtx = {
      excludeProjectsWithoutFarm,
      selectedFarmIdSet,
      grassFilterIds,
      countryFilterIds,
      allowedFarmIds: dashboardAllowedFarmIds,
      kpiRangeStart: kpiDateRange.start,
      kpiRangeEnd: kpiDateRange.end,
    };
    const perFarmSlot = new Map<string, Map<string, number>>();
    for (const f of farmsFiltered) {
      perFarmSlot.set(f.farmId, new Map(timeSlots.map((m) => [m.key, 0])));
    }

    for (const row of rows) {
      if (isDeleted(row)) continue;
      if (!rowPassesDashboardCountryGrassFilters(row, countryFilterIds, grassFilterIds)) continue;
      if (!rowPassesKpiGrassDeliveryPortfolio(row, trendKpiCtx)) continue;
      const rec = row as Record<string, unknown>;

      const rowCountry = String(rec.country_id ?? "").trim();
      const trendScope: DashboardDeliverySubitemScope = {
        grassFilterIds,
        countryFilterIds,
        rowCountry,
        allowedFarmIds: farmIds,
        selectedFarmIdSet,
        kpiRangeStart: kpiDateRange.start,
        kpiRangeEnd: kpiDateRange.end,
      };
      const subitems = parseSubitems(rec.subitems);
      for (const item of subitems) {
        if (String(item.deleted ?? "0").trim() === "1") continue;
        const itemRec = item as Record<string, unknown>;
        if (!deliverySubitemPassesDashboardFilters(itemRec, trendScope)) continue;
        const fid = String(itemRec.farm_id ?? "").trim();
        if (!farmIds.has(fid)) continue;

        const deliveryYmd = normalizeDeliveryHarvestYmd(itemRec);
        if (!deliveryYmd) continue;
        const slotKey = kpiTrendBucketKeyForDeliveryYmd(deliveryYmd, kpiTrendBucketMode);
        if (!slotKey) continue;
        const inner = perFarmSlot.get(fid);
        if (!inner || !inner.has(slotKey)) continue;

        const { kg: splitKg, m2: splitM2 } = dashboardDeliveryKgM2Split(itemRec);
        const add = wantSprig ? splitKg : splitM2;
        if (add <= 0) continue;
        inner.set(slotKey, (inner.get(slotKey) ?? 0) + add);
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
    countryFilterIds,
    grassFilterIds,
    excludeProjectsWithoutFarm,
    hasFarmSelection,
    selectedFarmIdSet,
    deliveredByMonthMode,
    kpiDateRange,
    kpiTrendBucketMode,
    dashboardAllowedFarmIds,
    t,
  ]);

  const selectedFarmNamesLabel = useMemo(() => {
    if (selectedFarmIds.length === 0) return "";
    return selectedFarmIds
      .map((id) => farmFilters.find((f) => f.farmId === id)?.farmName ?? id)
      .join(", ");
  }, [selectedFarmIds, farmFilters]);

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

  const farmOptions = useMemo(() => {
    const list = toRecArray(scopedFarms)
      .map((r) => ({
        id: String(r.id ?? "").trim(),
        name: String(r.name ?? r.title ?? "").trim(),
      }))
      .filter((x) => x.id && x.name);
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [scopedFarms]);

  const grassOptions = useMemo(
    () =>
      grassFilterOptions.map((o) => ({
        id: o.value,
        name: o.label,
      })),
    [grassFilterOptions],
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
        <div className="dashboard-harvesting-skin min-w-0 flex-1">
          <div className="mx-auto w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <div>
              <h2 className="font-heading text-2xl font-bold text-foreground">{t("Dashboard.title")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("Dashboard.subtitle")}</p>
            </div>

            <div className="flex flex-wrap items-start gap-3">
              <MultiSelect
                options={countryOptions.map((c) => ({ value: c.id, label: c.name }))}
                values={countryFilterIds}
                onChange={setCountryFilterIds}
                placeholder={t("Projects.allCountries")}
                showAllOption
                className={cn(multiSelectBaseClass, bgSurfaceFilter(countryFilterIds.length > 0))}
                rightIcon={filterTriggerIcon}
              />
              <MultiSelect
                options={farmOptions.map((f) => ({ value: f.id, label: f.name }))}
                values={selectedFarmIds}
                onChange={setSelectedFarmIds}
                placeholder={t("Projects.allFarms")}
                showAllOption
                className={cn(multiSelectBaseClass, bgSurfaceFilter(selectedFarmIds.length > 0))}
                rightIcon={filterTriggerIcon}
              />
              <MultiSelect
                options={grassOptions.map((g) => ({ value: g.id, label: g.name }))}
                values={grassFilterIds}
                onChange={setGrassFilterIds}
                placeholder={t("Projects.allGrass")}
                showAllOption
                className={cn(multiSelectBaseClass, bgSurfaceFilter(grassFilterIds.length > 0))}
                rightIcon={filterTriggerIcon}
              />
              <DashboardKpiDateFilter value={kpiDateFilter} onChange={setKpiDateFilter} />
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
              <button type="button" onClick={scrollToRecentDeliveries} className={kpiCardScrollClass}>
                <KpiCard
                  label={t("Dashboard.kpiDeliveries")}
                  value={String(kpiDeliveryPeriodStats.deliveryLineCount)}
                  sub={deliveryPeriodLabel}
                  icon={Truck}
                />
              </button>
              <button type="button" onClick={scrollToRecentDeliveries} className={kpiCardScrollClass}>
                <KpiCard
                  label={t("Dashboard.kpiQtyDelivered")}
                  value={kpiQtyDeliveredValue}
                  sub={deliveryPeriodLabel}
                  icon={Package}
                />
              </button>
              <button type="button" onClick={scrollToRecentDeliveries} className={kpiCardScrollClass}>
                <KpiCard
                  label={t("Dashboard.kpiGrassTypes")}
                  value={String(kpiPortfolioGrassTypesDisplay.count)}
                  sub={kpiPortfolioGrassTypesDisplay.subtitle}
                  icon={TrendingUp}
                />
              </button>
            </div>

            <div>
              <div className="mb-4">
                <h3 className="font-heading text-lg font-semibold text-foreground">
                  {t("Dashboard.kpiDeliveries")}
                </h3>
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
                          label={(entry: unknown) => {
                            const e = entry as { grass?: string; displayPercent?: number };
                            return `${String(e.grass ?? "")} ${e.displayPercent ?? 0}%`;
                          }}
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

            <RainfallSection
              farmFilters={farmFilters}
              selectedFarmIds={selectedFarmIds}
              scopeFarmIds={scopeIds}
              recentDateFrom={kpiDateRange.start}
              recentDateTo={kpiDateRange.end}
            />

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
                        {formatKpiDeliveredQty(g.amount, g.unit === "kg" ? "kg" : "m²")}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div
              ref={recentDeliveriesSectionRef}
              id="recent-deliveries"
              className="glass-card scroll-mt-24 rounded-xl p-5"
            >
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
                          <td className="max-w-[200px] py-2.5 px-3 text-foreground">
                            <span
                              className="block max-w-full truncate"
                              title={
                                h.projectLabel
                                  ? h.projectLabel
                                  : undefined
                              }
                            >
                              {h.projectLabel || "—"}
                            </span>
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
                  {recentKpiDeliveriesTableRows.length > 0 ? (
                    <tfoot>
                      <tr className="border-t-2 border-border bg-muted/40 font-semibold text-foreground">
                        <td className="py-3 px-3">
                          <span className="block">{t("Dashboard.recentDeliveriesFooterLabel")}</span>
                          <span className="mt-0.5 block text-xs font-normal tabular-nums text-muted-foreground">
                            {t("Dashboard.recentDeliveriesFooterDeliveries", {
                              count: recentDeliveriesTableTotals.deliveryLineCount,
                            })}
                          </span>
                        </td>
                        <td className="py-3 px-3 tabular-nums">
                          {t("Dashboard.recentDeliveriesFooterProjects", {
                            count: recentDeliveriesTableTotals.projectCount,
                          })}
                        </td>
                        <td className="max-w-[200px] py-3 px-3" title={recentDeliveriesTableTotals.grassTypeNames}>
                          <span className="block tabular-nums">
                            {t("Dashboard.recentDeliveriesFooterGrassTypes", {
                              count: recentDeliveriesTableTotals.grassTypeCount,
                            })}
                          </span>
                          {recentDeliveriesTableTotals.grassTypeNames ? (
                            <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">
                              {recentDeliveriesTableTotals.grassTypeNames}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-3 px-3" />
                        <td className="py-3 px-3 text-right tabular-nums">
                          <span className="flex flex-col items-end gap-0.5 leading-snug">
                            {recentDeliveriesTableTotals.totalKg > 0 ? (
                              <span>{formatKpiDeliveredQty(recentDeliveriesTableTotals.totalKg, "kg")}</span>
                            ) : null}
                            {recentDeliveriesTableTotals.totalM2 > 0 ? (
                              <span className="text-sm font-semibold text-foreground/90">
                                {formatKpiDeliveredQty(recentDeliveriesTableTotals.totalM2, "m²")}
                              </span>
                            ) : null}
                            {recentDeliveriesTableTotals.totalKg <= 0 &&
                            recentDeliveriesTableTotals.totalM2 <= 0
                              ? t("Dashboard.recentDeliveriesQtyPlaceholder")
                              : null}
                          </span>
                        </td>
                      </tr>
                    </tfoot>
                  ) : null}
                </table>
              </div>
            </div>
          </div>
        </div>
      </DashboardLayout>
    </RequireAuth>
  );
}
