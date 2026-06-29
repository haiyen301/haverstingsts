/** Today first, then future dates (nearest first), then past (nearest first). */
export function compareRainfallRecentDates(a: string, b: string, today: string): number {
  const group = (date: string) => {
    if (date === today) return 0;
    return date > today ? 1 : 2;
  };

  const ga = group(a);
  const gb = group(b);
  if (ga !== gb) return ga - gb;
  if (ga === 1) return a.localeCompare(b);
  if (ga === 2) return b.localeCompare(a);
  return 0;
}

export function sortRainfallRecentEntries<T extends { date: string }>(
  entries: T[],
  today: string,
): T[] {
  return [...entries].sort((x, y) => compareRainfallRecentDates(x.date, y.date, today));
}

export const RAINFALL_RECENT_PAGE_SIZE = 12;
