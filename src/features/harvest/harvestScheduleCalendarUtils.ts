import { format, getISOWeek, isValid, parseISO } from "date-fns";

import { formatDateDisplay } from "@/shared/lib/format/date";
import type {
  HarvestScheduleCalendarEntry,
  HarvestSchedulePrimaryDateKind,
} from "./harvestScheduleTypes";

export type { HarvestScheduleCalendarEntry };

export type MonthGridDay = {
  date: Date;
  ymd: string;
  inCurrentMonth: boolean;
};

export function formatScheduleEstimatedRange(
  startYmd: string,
  endYmd: string,
  locale: string,
): string | null {
  const start = startYmd.trim().slice(0, 10);
  const end = (endYmd.trim().slice(0, 10) || start).trim();
  if (!start) return null;
  const startLabel = formatDateDisplay(start, locale);
  if (startLabel === "-") return null;
  if (!end || end === start) return startLabel;
  const endLabel = formatDateDisplay(end, locale);
  if (endLabel === "-") return startLabel;
  return `${startLabel} – ${endLabel}`;
}

export function entryPrimaryScheduleDate(entry: {
  actualDate: string;
  estimatedDateStart: string;
}): { kind: HarvestSchedulePrimaryDateKind; ymd: string } | null {
  const actual = entry.actualDate.trim().slice(0, 10);
  if (actual) return { kind: "actual", ymd: actual };
  const estimated = entry.estimatedDateStart.trim().slice(0, 10);
  if (estimated) return { kind: "estimated", ymd: estimated };
  return null;
}

/** Badge on calendar day cell: actual wins if any entry on that day has actual_harvest_date on ymd. */
export function resolveDayCellDateBadgeKind(
  ymd: string,
  entries: HarvestScheduleCalendarEntry[],
): HarvestSchedulePrimaryDateKind | null {
  if (entries.length === 0) return null;
  const day = ymd.trim().slice(0, 10);
  if (!day || day === "0000-00-00") return null;

  let hasEstimate = false;

  for (const entry of entries) {
    if (entry.actualDate.trim().slice(0, 10) === day) return "actual";

    const estStart = entry.estimatedDateStart.trim().slice(0, 10);
    const estEnd = (entry.estimatedDateEnd.trim().slice(0, 10) || estStart).trim();
    if (estStart) {
      const lo = estStart <= estEnd ? estStart : estEnd;
      const hi = estStart <= estEnd ? estEnd : estStart;
      if (day >= lo && day <= hi) hasEstimate = true;
    }

    if (entry.date.trim().slice(0, 10) === day) {
      const primary = entryPrimaryScheduleDate(entry);
      if (primary?.kind === "estimated") hasEstimate = true;
    }
  }

  return hasEstimate ? "estimated" : null;
}

export function formatScheduleYmd(ymd: string, locale: string): string | null {
  const s = ymd.trim().slice(0, 10);
  if (!s) return null;
  const label = formatDateDisplay(s, locale);
  return label === "-" ? null : label;
}

export function ymdToLocalDate(ymd: string): Date | undefined {
  const s = ymd.trim().slice(0, 10);
  const parsed = parseISO(s);
  return isValid(parsed) ? parsed : undefined;
}

export function dateToYmd(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

function addDaysYmd(ymd: string, days: number): string {
  const d = ymdToLocalDate(ymd);
  if (!d) return ymd;
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return dateToYmd(next);
}

function eachYmdInclusive(startYmd: string, endYmd: string): string[] {
  const start = startYmd.trim().slice(0, 10);
  const end = (endYmd.trim().slice(0, 10) || start).trim();
  if (!start) return [];
  const lo = start <= end ? start : end;
  const hi = start <= end ? end : start;
  const out: string[] = [];
  let cur = lo;
  let guard = 0;
  while (cur <= hi && guard < 400) {
    out.push(cur);
    cur = addDaysYmd(cur, 1);
    guard += 1;
  }
  return out;
}

function bumpCount(map: Map<string, number>, ymd: string) {
  const key = ymd.trim().slice(0, 10);
  if (!key || key === "0000-00-00") return;
  map.set(key, (map.get(key) ?? 0) + 1);
}

function collectEntryYmds(entry: HarvestScheduleCalendarEntry): Set<string> {
  const days = new Set<string>();
  if (entry.date) days.add(entry.date.trim().slice(0, 10));
  const estStart = entry.estimatedDateStart.trim().slice(0, 10);
  const estEnd = entry.estimatedDateEnd.trim().slice(0, 10) || estStart;
  if (estStart) {
    for (const ymd of eachYmdInclusive(estStart, estEnd)) {
      days.add(ymd);
    }
  }
  return days;
}

export function buildHarvestCountByYmd(
  entries: HarvestScheduleCalendarEntry[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const ymd of collectEntryYmds(entry)) bumpCount(counts, ymd);
  }
  return counts;
}

export function buildEntriesByYmd(
  entries: HarvestScheduleCalendarEntry[],
): Map<string, HarvestScheduleCalendarEntry[]> {
  const byYmd = new Map<string, HarvestScheduleCalendarEntry[]>();
  for (const entry of entries) {
    for (const ymd of collectEntryYmds(entry)) {
      const list = byYmd.get(ymd) ?? [];
      list.push(entry);
      byYmd.set(ymd, list);
    }
  }
  for (const list of byYmd.values()) {
    list.sort((a, b) => a.project.localeCompare(b.project) || a.id.localeCompare(b.id));
  }
  return byYmd;
}

export function buildMonthGridRows(viewMonth: Date): { week: number; cells: MonthGridDay[] }[] {
  const cells = buildMonthGridCells(viewMonth);
  const rows: { week: number; cells: MonthGridDay[] }[] = [];
  for (let i = 0; i < cells.length; i += 7) {
    const slice = cells.slice(i, i + 7);
    rows.push({ week: getISOWeek(slice[0].date), cells: slice });
  }
  return rows;
}

/** Six-week grid starting Sunday (matches schedule calendar layout). */
export function buildMonthGridCells(viewMonth: Date): MonthGridDay[] {
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const leading = firstOfMonth.getDay();
  const gridStart = new Date(year, month, 1 - leading);
  const cells: MonthGridDay[] = [];
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    cells.push({
      date,
      ymd: dateToYmd(date),
      inCurrentMonth: date.getMonth() === month,
    });
  }
  return cells;
}

export function buildWeekdayLabels(locale: string): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: "short" });
  const labels: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(2024, 0, 7 + i);
    const label = formatter.format(d).replace(/\./g, "").trim();
    labels.push(label.length <= 3 ? label.toUpperCase() : label.slice(0, 2).toUpperCase());
  }
  return labels;
}

export function toValidDate(value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (value && typeof value === "object" && "date" in value) {
    const nested = (value as { date: unknown }).date;
    if (nested instanceof Date && !Number.isNaN(nested.getTime())) return nested;
  }
  return new Date();
}

export function formatMonthYearTitle(monthDate: Date, locale: string): string {
  return toValidDate(monthDate).toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
  });
}

export type HarvestDayInViewMonth = {
  ymd: string;
  count: number;
};

/** Harvest days that fall in the calendar month currently on screen. */
export function listHarvestDaysInViewMonth(
  harvestCountByYmd: Map<string, number>,
  viewMonth: Date,
): HarvestDayInViewMonth[] {
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const days: HarvestDayInViewMonth[] = [];

  for (const [ymd, count] of harvestCountByYmd) {
    if (count <= 0) continue;
    const date = ymdToLocalDate(ymd);
    if (!date) continue;
    if (date.getFullYear() === year && date.getMonth() === month) {
      days.push({ ymd, count });
    }
  }

  return days.sort((a, b) => a.ymd.localeCompare(b.ymd));
}
