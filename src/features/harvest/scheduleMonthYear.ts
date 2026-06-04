/** Inclusive calendar-month bounds as YYYY-MM-DD (local). */
export function scheduleMonthRangeYmd(
  year: number,
  monthIndex: number,
): { start: string; end: string } {
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { start: fmt(start), end: fmt(end) };
}

export function scheduleDefaultMonthYear(): { month: number; year: number } {
  const now = new Date();
  return { month: now.getMonth(), year: now.getFullYear() };
}

export function scheduleMonthCacheKey(startYmd: string, endYmd: string): string {
  return `${startYmd.trim().slice(0, 10)}|${endYmd.trim().slice(0, 10)}`;
}
