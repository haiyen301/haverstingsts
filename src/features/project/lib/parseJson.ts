/** Parse JSON-looking strings; parity with Flutter dynamic table string fields. */
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
