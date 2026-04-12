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
      // Some STS payloads are python-like strings (single quotes, None/True/False).
      // Try a conservative normalization fallback before giving up.
      try {
        const normalized = s
          .replace(/\bNone\b/g, "null")
          .replace(/\bTrue\b/g, "true")
          .replace(/\bFalse\b/g, "false")
          .replace(/'/g, "\"");
        return JSON.parse(normalized) as unknown;
      } catch {
        return v;
      }
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

/**
 * `quantity_required_sprig_sod` from API: array, JSON string, or `{ data: [...] }` (aligned with `buildProjectCardData.normalizeRequirements`).
 */
export function parseQuantityRequiredRows(raw: unknown): Array<Record<string, unknown>> {
  const p = parseJsonMaybe(raw);
  let list: unknown = p;
  if (
    list &&
    typeof list === "object" &&
    !Array.isArray(list) &&
    Array.isArray((list as Record<string, unknown>).data)
  ) {
    list = (list as Record<string, unknown>).data;
  }
  if (!Array.isArray(list)) return [];
  return list.filter((x) => !!x && typeof x === "object") as Array<Record<string, unknown>>;
}
