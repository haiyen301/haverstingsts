/**
 * Parse JSON strings from API/DB when value may be a stringified object/array.
 */

export function parseJsonMaybe(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const s = v.trim();
  if (!s) return null;
  if ((s.startsWith("[") && s.endsWith("]")) || (s.startsWith("{") && s.endsWith("}"))) {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      return v;
    }
  }
  return v;
}

export function parseSubitems(raw: unknown): Array<Record<string, unknown>> {
  const p = parseJsonMaybe(raw);
  return Array.isArray(p)
    ? (p.filter((x) => !!x && typeof x === "object") as Array<Record<string, unknown>>)
    : [];
}
