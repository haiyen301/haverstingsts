import {
  addDays,
  addMonths,
  endOfMonth,
  format,
  isSameDay,
  isValid,
  startOfMonth,
} from "date-fns";

export type DateRangeValue = { from?: string; to?: string };

export type LocalDateRange = { from?: Date; to?: Date };

export type MonthDayCell = {
  date: Date;
  ymd: string;
  label: number;
};

export type MonthGrid = {
  key: string;
  month: Date;
  title: string;
  weeks: (MonthDayCell | null)[][];
};

export const MOBILE_RANGE_LAST_MONTH = new Date(2027, 9, 1);
export const MOBILE_RANGE_MONTHS = buildScrollMonths(MOBILE_RANGE_LAST_MONTH);
export const MOBILE_RANGE_FIRST_MONTH = MOBILE_RANGE_MONTHS[0]!;
export const MOBILE_RANGE_LAST_DAY = endOfMonth(MOBILE_RANGE_LAST_MONTH);
export const MOBILE_RANGE_MONTH_GRIDS = MOBILE_RANGE_MONTHS.map(buildMonthGrid);

export function parseLocalYmd(value: string | undefined): Date | undefined {
  const ymd = String(value ?? "").trim().slice(0, 10);
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return undefined;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return isValid(date) ? date : undefined;
}

export function toYmd(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function toLocalDateRange(value?: DateRangeValue): LocalDateRange | undefined {
  const from = parseLocalYmd(value?.from);
  const to = parseLocalYmd(value?.to);
  if (!from && !to) return undefined;
  return { from, to };
}

export function normalizeLocalRange(from: Date, to: Date): LocalDateRange {
  if (to < from) return { from: to, to: from };
  return { from, to };
}

export function formatRangeHeader(range?: LocalDateRange): string {
  const from = range?.from;
  const to = range?.to;
  if (!from && !to) return "—";
  if (from && !to) return format(from, "MMM d, yyyy");
  if (from && to) return `${format(from, "MMM d, yyyy")} – ${format(to, "MMM d, yyyy")}`;
  return "—";
}

export function monthKey(date: Date): string {
  return format(startOfMonth(date), "yyyy-MM");
}

export function clampScrollMonthKey(key: string): string {
  const firstKey = monthKey(MOBILE_RANGE_FIRST_MONTH);
  const lastKey = monthKey(MOBILE_RANGE_LAST_MONTH);
  if (key < firstKey) return firstKey;
  if (key > lastKey) return lastKey;
  return key;
}

export function isDateDisabled(date: Date): boolean {
  return date < MOBILE_RANGE_FIRST_MONTH || date > MOBILE_RANGE_LAST_DAY;
}

export function getDayRangeState(
  date: Date,
  range: LocalDateRange | undefined,
): "none" | "start" | "end" | "middle" | "single" {
  const from = range?.from;
  const to = range?.to;
  if (!from) return "none";
  if (!to) {
    return isSameDay(date, from) ? "single" : "none";
  }
  if (isSameDay(date, from) && isSameDay(date, to)) return "single";
  if (isSameDay(date, from)) return "start";
  if (isSameDay(date, to)) return "end";
  if (date > from && date < to) return "middle";
  return "none";
}

export function pickRangeDay(
  current: LocalDateRange | undefined,
  nextDay: Date,
): LocalDateRange | undefined {
  if (isDateDisabled(nextDay)) return current;

  if (current?.from && current?.to) {
    return { from: nextDay, to: undefined };
  }

  if (!current?.from) {
    return { from: nextDay, to: undefined };
  }

  if (!current.to) {
    return normalizeLocalRange(current.from, nextDay);
  }

  return { from: nextDay, to: undefined };
}

function buildScrollMonths(lastMonth: Date): Date[] {
  const end = startOfMonth(lastMonth);
  const start = startOfMonth(new Date(end.getFullYear() - 10, 0, 1));
  const months: Date[] = [];
  for (let cursor = start; cursor <= end; cursor = addMonths(cursor, 1)) {
    months.push(cursor);
  }
  return months;
}

function buildMonthGrid(month: Date): MonthGrid {
  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const gridStart = addDays(monthStart, -monthStart.getDay());
  const weeks: (MonthDayCell | null)[][] = [];
  let cursor = gridStart;

  while (cursor <= monthEnd || cursor.getDay() !== 0) {
    if (cursor.getDay() === 0) weeks.push([]);

    const week = weeks[weeks.length - 1]!;
    if (cursor.getMonth() === month.getMonth() && cursor >= monthStart && cursor <= monthEnd) {
      week.push({
        date: cursor,
        ymd: toYmd(cursor),
        label: cursor.getDate(),
      });
    } else {
      week.push(null);
    }

    cursor = addDays(cursor, 1);
    if (cursor > monthEnd && cursor.getDay() === 0) break;
  }

  return {
    key: monthKey(month),
    month,
    title: format(month, "MMMM yyyy"),
    weeks,
  };
}
