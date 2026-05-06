import type { MondayProjectServerRow } from "@/entities/projects";
import { parseSubitems } from "@/shared/lib/parseJsonMaybe";

export type KpiDeliveryPeriod = "week" | "month" | "quarter";

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
  else start.setMonth(start.getMonth() - 3);
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
  return ymd >= start && ymd <= end;
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
  const curStart = ymdToLocalDate(periodStartYmd(period));
  const curEnd = ymdToLocalDate(todayYmd());
  if (!curStart || !curEnd) {
    return { start: periodStartYmd(period), end: todayYmd() };
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
