import type {
  DevForecastCalendarHarvestPlan,
  SourceAuditRow,
} from "@/features/forecasting/availableSourceDbMappers";

export type DbCalendarDay = {
  date: string;
  isToday: boolean;
  isAnchor: boolean;
  previousAvailable: number;
  harvestKg: number;
  regrowthKg: number;
  regrowthGrossKg: number;
  regrowthOverlimitKg: number;
  regrowthSourceCount: number;
  available: number;
  rawAvailable: number;
  capacityCap: number;
  overlimit: number;
  hasSnapshot: boolean;
  harvestPlans: DevForecastCalendarHarvestPlan[];
  regrowthSources: SourceAuditRow[];
};

export function ymdFromDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function parseYmdLocal(value: string): Date | null {
  const m = String(value ?? "").trim().slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function diffDaysInclusive(start: Date, end: Date): number {
  const startMs = startOfLocalDay(start).getTime();
  const endMs = startOfLocalDay(end).getTime();
  return Math.max(1, Math.floor((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1);
}

export function toDisplayDate(ymd: string): string {
  const d = parseYmdLocal(ymd);
  if (!d) return ymd || "-";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

export function formatWeekdayShort(ymd: string): string {
  const d = parseYmdLocal(ymd);
  if (!d) return "";
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

export function formatKg(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  return `${Math.round(n).toLocaleString()} kg`;
}

export function formatNumber(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  return Math.round(n).toLocaleString();
}

export function formatPlanQty(value: number, uom: string): string {
  const unit = String(uom ?? "").trim();
  return `${formatNumber(value)}${unit ? ` ${unit}` : ""}`;
}

export function uniqueSortedYmds(ymds: string[]): string[] {
  return Array.from(new Set(ymds.filter((ymd) => /^\d{4}-\d{2}-\d{2}$/.test(ymd)))).sort((a, b) =>
    a.localeCompare(b),
  );
}
