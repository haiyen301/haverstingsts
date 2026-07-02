export type FertilizerBalanceWeekBucket = {
  index: 1 | 2 | 3 | 4;
  startDay: number;
  endDay: number;
  startYmd: string;
  endYmd: string;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** First week ends on the first Sunday on or after day 7 (matches Excel January-2026). */
function firstWeekEndDay(year: number, month: number, daysInMonth: number): number {
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dow = new Date(year, month - 1, day).getDay();
    if (dow === 0 && day >= 7) return day;
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    if (new Date(year, month - 1, day).getDay() === 0) return day;
  }
  return Math.min(7, daysInMonth);
}

/** Split a calendar month into four buckets (WK4 always ends on the last day of the month). */
export function fertilizerBalanceWeekBuckets(
  year: number,
  month: number,
): FertilizerBalanceWeekBucket[] {
  const daysInMonth = new Date(year, month, 0).getDate();
  const w1End = firstWeekEndDay(year, month, daysInMonth);
  const ranges: Array<{ startDay: number; endDay: number }> = [];
  ranges.push({ startDay: 1, endDay: w1End });
  let cursor = w1End + 1;
  while (cursor <= daysInMonth && ranges.length < 4) {
    const isFourthWeek = ranges.length === 3;
    const endDay = isFourthWeek ? daysInMonth : Math.min(cursor + 6, daysInMonth);
    ranges.push({ startDay: cursor, endDay });
    cursor = endDay + 1;
  }
  while (ranges.length < 4) {
    ranges.push({ startDay: cursor, endDay: Math.min(cursor, daysInMonth) });
    cursor += 1;
  }
  return ranges.map((range, idx) => ({
    index: (idx + 1) as 1 | 2 | 3 | 4,
    startDay: range.startDay,
    endDay: range.endDay,
    startYmd: ymd(year, month, range.startDay),
    endYmd: ymd(year, month, range.endDay),
  }));
}

export function fertilizerBalanceWeekLabel(
  bucket: FertilizerBalanceWeekBucket,
  year: number,
  month: number,
): string {
  return `WK ${bucket.index} (From ${bucket.startDay}/${month}/${year} to ${bucket.endDay}/${month}/${year} )`;
}

export const FERTILIZER_BALANCE_MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function fertilizerBalanceMonthLabel(month: number): string {
  return FERTILIZER_BALANCE_MONTH_NAMES[month - 1] ?? String(month);
}

export type FertilizerBalanceYearMonth = {
  year: number;
  month: number;
};

function yearMonthIndex(ym: FertilizerBalanceYearMonth): number {
  return ym.year * 12 + (ym.month - 1);
}

/** Inclusive list of calendar months from `from` through `to` (chronological). */
export function enumerateFertilizerBalanceMonths(
  from: FertilizerBalanceYearMonth,
  to: FertilizerBalanceYearMonth,
): FertilizerBalanceYearMonth[] {
  let start = yearMonthIndex(from);
  let end = yearMonthIndex(to);
  if (end < start) [start, end] = [end, start];
  const out: FertilizerBalanceYearMonth[] = [];
  for (let i = start; i <= end; i += 1) {
    out.push({ year: Math.floor(i / 12), month: (i % 12) + 1 });
  }
  return out;
}

export function fertilizerBalancePeriodLabel(ym: FertilizerBalanceYearMonth): string {
  return `${fertilizerBalanceMonthLabel(ym.month)} ${ym.year}`;
}

export function fertilizerBalancePeriodRangeLabel(
  from: FertilizerBalanceYearMonth,
  to: FertilizerBalanceYearMonth,
): string {
  const months = enumerateFertilizerBalanceMonths(from, to);
  if (months.length === 1) {
    return fertilizerBalancePeriodLabel(months[0]!);
  }
  const a = months[0]!;
  const b = months[months.length - 1]!;
  if (a.year === b.year) {
    return `${fertilizerBalanceMonthLabel(a.month)} - ${fertilizerBalanceMonthLabel(b.month)} ${a.year}`;
  }
  return `${fertilizerBalancePeriodLabel(a)} - ${fertilizerBalancePeriodLabel(b)}`;
}

export const FERTILIZER_BALANCE_MAX_EXPORT_MONTHS = 24;

export function fertilizerBalanceSheetTabName(farmName: string, year: number, month: number): string {
  const monthName = fertilizerBalanceMonthLabel(month);
  const safeFarm = farmName.trim() || "Farm";
  return `${safeFarm} ${monthName}-${year}`;
}

export function fertilizerBalanceExportFileName(
  farmName: string,
  year: number,
  month: number,
  format: "csv" | "xlsx",
): string {
  const monthName = fertilizerBalanceMonthLabel(month);
  const safeFarm = farmName.trim().replace(/[\\/:*?"<>|]+/g, "-") || "Farm";
  return `${safeFarm} ${monthName} - ${year}.${format}`;
}

/** Workbook name when exporting multiple farms and/or months in one file. */
export function fertilizerBalanceBundleExportFileName(
  from: FertilizerBalanceYearMonth,
  to: FertilizerBalanceYearMonth,
  format: "csv" | "xlsx",
): string {
  const rangeLabel = fertilizerBalancePeriodRangeLabel(from, to).replace(/[\\/:*?"<>|]+/g, "-");
  return `Fertilizer Balance ${rangeLabel}.${format}`;
}

export function resolveFertilizerBalanceExportFileName(
  farmNames: string[],
  from: FertilizerBalanceYearMonth,
  to: FertilizerBalanceYearMonth,
  format: "csv" | "xlsx",
): string {
  const rangeLabel = fertilizerBalancePeriodRangeLabel(from, to).replace(/[\\/:*?"<>|]+/g, "-");
  if (farmNames.length === 1) {
    const safeFarm = farmNames[0]!.trim().replace(/[\\/:*?"<>|]+/g, "-") || "Farm";
    return `${safeFarm} ${rangeLabel}.${format}`;
  }
  return fertilizerBalanceBundleExportFileName(from, to, format);
}
