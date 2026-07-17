import type { MondayProjectServerRow } from "@/entities/projects";
import { parseSubitems } from "@/shared/lib/parseJsonMaybe";

export type KpiDeliveryPeriod = "week" | "month" | "quarter" | "year";

export type KpiDatePreset =
  | "all"
  | "today"
  | "yesterday"
  | "lastWeek"
  | "lastMonth"
  | "lastQuarter"
  | "lastYear"
  | "thisWeek"
  | "thisMonth"
  | "thisQuarter"
  | "nextWeek"
  | "nextMonth"
  | "nextQuarter"
  | "next1Month"
  | "next3Months"
  | "next6Months"
  | "next12Months"
  | "custom";

/** Harvest list — optional “no delivery date filter” + dashboard presets. */
export const KPI_DATE_PRESET_HARVEST: readonly KpiDatePreset[] = [
  "all",
  "today",
  "yesterday",
  "lastWeek",
  "lastMonth",
  "lastQuarter",
  "custom",
] as const;

/** Dashboard KPI filter — default preset list (image: Today … Last quarter + Custom). */
export const KPI_DATE_PRESET_DASHBOARD: readonly KpiDatePreset[] = [
  "today",
  "yesterday",
  "lastWeek",
  "lastMonth",
  "lastQuarter",
  "custom",
] as const;

/** Harvest schedule — forward-looking calendar windows. */
export const KPI_DATE_PRESET_SCHEDULE: readonly KpiDatePreset[] = [
  "today",
  "thisWeek",
  "nextWeek",
  "nextMonth",
  "nextQuarter",
  "custom",
] as const;

/** Fertilizer usage — calendar + rolling last windows + all time + custom. */
export const KPI_DATE_PRESET_FERTILIZER: readonly KpiDatePreset[] = [
  "all",
  "today",
  "thisWeek",
  "thisMonth",
  "thisQuarter",
  "lastWeek",
  "lastMonth",
  "lastQuarter",
  "lastYear",
  "custom",
] as const;

/** Fleet fuel usage — calendar + rolling last windows + all time + custom. */
export const KPI_DATE_PRESET_FUEL: readonly KpiDatePreset[] = [
  "all",
  "today",
  "thisWeek",
  "thisMonth",
  "thisQuarter",
  "lastWeek",
  "lastMonth",
  "lastQuarter",
  "custom",
] as const;

/** Forecasting — forward-looking horizon from today. */
export const KPI_DATE_PRESET_FORECAST: readonly KpiDatePreset[] = [
  "next1Month",
  "next3Months",
  "next6Months",
  "next12Months",
  "custom",
] as const;

export type KpiDeliveryDateFilter = {
  preset: KpiDatePreset;
  customFrom?: string;
  customTo?: string;
};

export type KpiTrendBucketMode = "day" | "week" | "month";

function startOfLocalToday(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

/** Local calendar today as YYYY-MM-DD (Harvesting Portal uses string compare vs periodStart). */
export function todayYmd(): string {
  const d = startOfLocalToday();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Matches Harvesting Portal `periodStart(deliveryPeriod)` — inclusive lower bound for KPI deliveries. */
export function periodStartYmd(period: KpiDeliveryPeriod): string {
  const anchor = startOfLocalToday();
  const start = new Date(anchor);
  if (period === "week") start.setDate(start.getDate() - 7);
  else if (period === "month") start.setMonth(start.getMonth() - 1);
  else if (period === "quarter") start.setMonth(start.getMonth() - 3);
  else start.setFullYear(start.getFullYear() - 1);
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
}

/** YYYY-MM-DD in local calendar from raw DB date/datetime (shared by delivery / estimated fields). */
export function normalizeDateFieldToYmd(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s || s === "0000-00-00" || s === "null") return null;
  const datePart = s.includes(" ") ? s.split(" ")[0] : s;

  const strict = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (strict) {
    const y = Number(strict[1]);
    const mo = Number(strict[2]);
    const dNum = Number(strict[3]);
    const dt = new Date(y, mo - 1, dNum);
    if (Number.isNaN(dt.getTime())) return null;
    return `${y}-${strict[2]}-${strict[3]}`;
  }

  const loose = datePart.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (loose) {
    const y = Number(loose[1]);
    const mo = Number(loose[2]);
    const dNum = Number(loose[3]);
    const dt = new Date(y, mo - 1, dNum);
    if (Number.isNaN(dt.getTime())) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(dNum).padStart(2, "0")}`;
  }

  const parsed = Date.parse(datePart);
  if (Number.isNaN(parsed)) return null;
  const dt = new Date(parsed);
  if (Number.isNaN(dt.getTime())) return null;
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/** Normalizes subitem `delivery_harvest_date` to YYYY-MM-DD for lexicographic filtering. */
export function normalizeDeliveryHarvestYmd(rec: Record<string, unknown>): string | null {
  return normalizeDateFieldToYmd(rec.delivery_harvest_date);
}

export function dateToLocalYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function isDeliveryYmdInKpiPeriod(ymd: string, period: KpiDeliveryPeriod): boolean {
  const start = periodStartYmd(period);
  const end = todayYmd();
  return isDeliveryYmdInYmdRange(ymd, start, end);
}

export function isDeliveryYmdInYmdRange(ymd: string, startYmd: string, endYmd: string): boolean {
  return ymd >= startYmd && ymd <= endYmd;
}

function addDaysYmd(ymd: string, days: number): string {
  const d = ymdToLocalDate(ymd);
  if (!d) return ymd;
  return dateToLocalYmd(addCalendarDays(d, days));
}

/** Monday-based calendar week; `weekOffset` 0 = current week, 1 = next week. */
function calendarWeekRangeYmd(weekOffset: number): { start: string; end: string } {
  const anchor = startOfLocalToday();
  const start = startOfWeekMonday(anchor);
  start.setDate(start.getDate() + weekOffset * 7);
  const end = addCalendarDays(start, 6);
  return { start: dateToLocalYmd(start), end: dateToLocalYmd(end) };
}

function startOfWeekMonday(d: Date): Date {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
}

/** Calendar month; `monthOffset` 0 = current month, 1 = next month. */
function calendarMonthRangeYmd(monthOffset: number): { start: string; end: string } {
  const anchor = startOfLocalToday();
  const start = new Date(anchor.getFullYear(), anchor.getMonth() + monthOffset, 1);
  const end = new Date(anchor.getFullYear(), anchor.getMonth() + monthOffset + 1, 0);
  return { start: dateToLocalYmd(start), end: dateToLocalYmd(end) };
}

/** Calendar quarter; `quarterOffset` 0 = current quarter, 1 = next quarter. */
function calendarQuarterRangeYmd(quarterOffset: number): { start: string; end: string } {
  const anchor = startOfLocalToday();
  const qStartMonth = Math.floor(anchor.getMonth() / 3) * 3 + quarterOffset * 3;
  const start = new Date(anchor.getFullYear(), qStartMonth, 1);
  const end = new Date(anchor.getFullYear(), qStartMonth + 3, 0);
  return { start: dateToLocalYmd(start), end: dateToLocalYmd(end) };
}

/** Forward-looking window from today through today + `months` calendar months. */
function forwardMonthsRangeYmd(months: number): { start: string; end: string } {
  const anchor = startOfLocalToday();
  const end = new Date(anchor.getFullYear(), anchor.getMonth() + months, anchor.getDate());
  return { start: dateToLocalYmd(anchor), end: dateToLocalYmd(end) };
}

/** Resolves preset or custom filter to inclusive `[start, end]` YMD bounds. */
export function kpiDateRangeFromFilter(filter: KpiDeliveryDateFilter): {
  start: string;
  end: string;
} {
  const today = todayYmd();
  switch (filter.preset) {
    case "all":
      return { start: "", end: "" };
    case "today":
      return { start: today, end: today };
    case "yesterday": {
      const y = addDaysYmd(today, -1);
      return { start: y, end: y };
    }
    case "lastWeek":
      return { start: periodStartYmd("week"), end: today };
    case "lastMonth":
      return { start: periodStartYmd("month"), end: today };
    case "lastQuarter":
      return { start: periodStartYmd("quarter"), end: today };
    case "lastYear":
      return { start: periodStartYmd("year"), end: today };
    case "thisWeek":
      return calendarWeekRangeYmd(0);
    case "thisMonth":
      return calendarMonthRangeYmd(0);
    case "thisQuarter":
      return calendarQuarterRangeYmd(0);
    case "nextWeek":
      return calendarWeekRangeYmd(1);
    case "nextMonth":
      return calendarMonthRangeYmd(1);
    case "nextQuarter":
      return calendarQuarterRangeYmd(1);
    case "next1Month":
      return forwardMonthsRangeYmd(1);
    case "next3Months":
      return forwardMonthsRangeYmd(3);
    case "next6Months":
      return forwardMonthsRangeYmd(6);
    case "next12Months":
      return forwardMonthsRangeYmd(12);
    case "custom": {
      const from = String(filter.customFrom ?? "").trim() || today;
      const to = String(filter.customTo ?? "").trim() || from;
      return from <= to ? { start: from, end: to } : { start: to, end: from };
    }
    default:
      return { start: periodStartYmd("month"), end: today };
  }
}

/** Trend chart bucket granularity from selected range span. */
export function kpiTrendBucketModeForRange(startYmd: string, endYmd: string): KpiTrendBucketMode {
  const start = ymdToLocalDate(startYmd);
  const end = ymdToLocalDate(endYmd);
  if (!start || !end) return "day";
  const spanDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  if (spanDays <= 8) return "day";
  if (spanDays <= 45) return "week";
  return "month";
}

/** Approximate month span for forecast subtitle / chart density. */
export function forecastSpanMonthsFromFilter(filter: KpiDeliveryDateFilter): number {
  if (filter.preset === "next1Month") return 1;
  if (filter.preset === "next3Months") return 3;
  if (filter.preset === "next6Months") return 6;
  if (filter.preset === "next12Months") return 12;

  const { start, end } = kpiDateRangeFromFilter(filter);
  const s = ymdToLocalDate(start);
  const e = ymdToLocalDate(end);
  if (!s || !e) return 3;
  const spanDays = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
  return Math.max(1, Math.round(spanDays / 30.44));
}

export function kpiPresetToLegacyPeriod(preset: KpiDatePreset): KpiDeliveryPeriod | null {
  if (preset === "lastWeek") return "week";
  if (preset === "lastMonth") return "month";
  if (preset === "lastQuarter") return "quarter";
  if (preset === "lastYear") return "year";
  return null;
}

function ymdToLocalDate(ymd: string): Date | null {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const dNum = Number(m[3]);
  const out = new Date(y, mo - 1, dNum);
  return Number.isNaN(out.getTime()) ? null : out;
}

function addCalendarDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

/** Previous sliding window with the same span as [periodStartYmd(period), today]. */
export function priorKpiPeriodWindowYmd(period: KpiDeliveryPeriod): { start: string; end: string } {
  return priorKpiPeriodWindowYmdFromRange(periodStartYmd(period), todayYmd());
}

/** Previous window immediately before `[startYmd, endYmd]` with the same inclusive span. */
export function priorKpiPeriodWindowYmdFromRange(
  startYmd: string,
  endYmd: string,
): { start: string; end: string } {
  const curStart = ymdToLocalDate(startYmd);
  const curEnd = ymdToLocalDate(endYmd);
  if (!curStart || !curEnd) {
    return { start: startYmd, end: endYmd };
  }
  const spanDays = Math.round((curEnd.getTime() - curStart.getTime()) / 86400000) + 1;
  const priorEnd = addCalendarDays(curStart, -1);
  const priorStart = addCalendarDays(priorEnd, -(spanDays - 1));
  return { start: dateToLocalYmd(priorStart), end: dateToLocalYmd(priorEnd) };
}

/** ≥1 subitem `delivery_harvest_date` in [startYmd, endYmd] (inclusive). */
export function projectHasSubitemDeliveryInYmdRange(
  row: MondayProjectServerRow,
  startYmd: string,
  endYmd: string,
): boolean {
  for (const item of parseSubitems((row as Record<string, unknown>).subitems)) {
    const rec = item as Record<string, unknown>;
    if (String(rec.deleted ?? "0").trim() === "1") continue;
    const ymd = normalizeDeliveryHarvestYmd(rec);
    if (!ymd || ymd < startYmd || ymd > endYmd) continue;
    return true;
  }
  return false;
}

/** ≥1 subitem `delivery_harvest_date` in [periodStart, today]. */
export function projectHasSubitemDeliveryInKpiPeriod(row: MondayProjectServerRow, period: KpiDeliveryPeriod): boolean {
  for (const item of parseSubitems((row as Record<string, unknown>).subitems)) {
    const rec = item as Record<string, unknown>;
    if (String(rec.deleted ?? "0").trim() === "1") continue;
    const ymd = normalizeDeliveryHarvestYmd(rec);
    if (!ymd || !isDeliveryYmdInKpiPeriod(ymd, period)) continue;
    return true;
  }
  return false;
}

/** At least one non-deleted harvesting line has a farm assigned (subitem `farm_id`). */
export function projectRowHasFarmAssigned(row: MondayProjectServerRow): boolean {
  for (const item of parseSubitems((row as Record<string, unknown>).subitems)) {
    const rec = item as Record<string, unknown>;
    if (String(rec.deleted ?? "0").trim() === "1") continue;
    if (String(rec.farm_id ?? "").trim()) return true;
  }
  return false;
}

export function isProjectRecordCompletedRaw(rec: Record<string, unknown>): boolean {
  const s = String(rec.status_app ?? rec.status ?? "").toLowerCase();
  if (s.includes("done") || s.includes("complete")) return true;
  const ac = String(rec.actual_completion_date ?? "").trim();
  return Boolean(ac && ac !== "0000-00-00" && ac !== "null");
}

function normalizeKpiStatus(v: unknown): string {
  const s = String(v ?? "").toLowerCase().trim();
  if (!s) return "";
  if (s.includes("done") || s.includes("complete")) return "Done";
  if (s.includes("future")) return "Future";
  if (s.includes("warning")) return "Warning";
  if (s.includes("ongoing")) return "Ongoing";
  return "";
}

export function isMondayProjectServerRowDeleted(row: MondayProjectServerRow): boolean {
  return String((row as Record<string, unknown>).deleted ?? "0").trim() === "1";
}

export type DashboardKpiDeliveryMatch = (
  row: MondayProjectServerRow,
) => boolean;

/**
 * Checks the same predicates as Dashboard “Active projects” KPI card (delivery window + farms + completion + status).
 * Use distinct `deliveryMatch` from `projectHasSubitemDeliveryInKpiPeriod`, or prior window from `priorKpiPeriodWindowYmd`.
 */
export function rowMatchesDashboardActiveProjectsKpi(
  row: MondayProjectServerRow,
  opts: {
    excludeProjectsWithoutFarm: boolean;
    selectedFarmIdSet: Set<string>;
    deliveryMatch: DashboardKpiDeliveryMatch;
    excludeCompleted: boolean;
  },
): boolean {
  if (isMondayProjectServerRowDeleted(row)) return false;
  if (opts.excludeProjectsWithoutFarm && !projectRowHasFarmAssigned(row)) return false;
  const rec = row as Record<string, unknown>;
  if (opts.selectedFarmIdSet.size > 0) {
    const hasSelectedFarm = parseSubitems(rec.subitems).some((item) => {
      if (String((item as Record<string, unknown>).deleted ?? "0").trim() === "1") return false;
      const farmId = String((item as Record<string, unknown>).farm_id ?? "").trim();
      return opts.selectedFarmIdSet.has(farmId);
    });
    if (!hasSelectedFarm) return false;
  }
  if (!opts.deliveryMatch(row)) return false;
  if (opts.excludeCompleted && isProjectRecordCompletedRaw(rec)) return false;
  const status = normalizeKpiStatus(rec.status_app ?? rec.status);
  if (!(status === "Ongoing" || status === "Future" || status === "Warning")) return false;
  return true;
}

export function parseKpiDeliveryPeriod(v: unknown): KpiDeliveryPeriod | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "week" || s === "month" || s === "quarter") return s;
  return null;
}
