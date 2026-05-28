/** Local calendar helpers shared by forecast cache, compute, and UI. */

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function ymdFromDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

export function parseYmdLocal(ymd: string): Date | null {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

const FORECAST_TODAY_FOR_TEST: string | null = null;

export function getForecastToday(): Date {
  if (!FORECAST_TODAY_FOR_TEST) return startOfLocalDay(new Date());
  return parseYmdLocal(FORECAST_TODAY_FOR_TEST) ?? startOfLocalDay(new Date());
}

/** Unified harvest window for forecast + inventory cache. */
export function forecastHarvestDateRange(): { from: string; to: string } {
  const today = getForecastToday();
  return {
    from: ymdFromDate(addMonths(today, -24)),
    to: ymdFromDate(addMonths(today, 30)),
  };
}
