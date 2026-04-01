/**
 * Date formatting helpers for STS pages.
 */

export function isValidDate(v: unknown): v is string {
  const s = String(v ?? "").trim();
  return !!s && s !== "0000-00-00" && s.toLowerCase() !== "null";
}

/** Display date as `Mar 28, 2026`; invalid values return `-`. */
export function formatDateDisplay(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!isValidDate(s)) return "-";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
