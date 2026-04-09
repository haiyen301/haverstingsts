export type SortDir = "asc" | "desc";

export function compareStrings(a: string, b: string, dir: SortDir): number {
  const cmp = a.localeCompare(b, undefined, {
    sensitivity: "base",
    numeric: true,
  });
  return dir === "asc" ? cmp : -cmp;
}

export function compareNumbers(a: number, b: number, dir: SortDir): number {
  const cmp = a === b ? 0 : a < b ? -1 : 1;
  return dir === "asc" ? cmp : -cmp;
}

/** Compare YYYY-MM-DD or empty; empty sorts last when ascending. */
export function compareIsoDateStrings(
  a: string,
  b: string,
  dir: SortDir,
): number {
  const ta = a?.trim() ? new Date(a.replace(/\//g, "-").slice(0, 10)).getTime() : NaN;
  const tb = b?.trim() ? new Date(b.replace(/\//g, "-").slice(0, 10)).getTime() : NaN;
  const va = Number.isFinite(ta) ? ta : dir === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  const vb = Number.isFinite(tb) ? tb : dir === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  const cmp = va === vb ? 0 : va < vb ? -1 : 1;
  return dir === "asc" ? cmp : -cmp;
}
