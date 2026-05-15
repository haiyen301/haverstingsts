/**
 * Date formatting helpers for STS pages.
 */

export function isValidDate(v: unknown): v is string {
  const s = String(v ?? "").trim();
  return !!s && s !== "0000-00-00" && s.toLowerCase() !== "null";
}

/** Display date with localized month (e.g. `Mar 28, 2026` / `16 thg 5, 2026`); invalid values return `-`. */
export function formatDateDisplay(v: unknown, locale?: string): string {
  const s = String(v ?? "").trim();
  if (!isValidDate(s)) return "-";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "-";
  const tag = locale?.trim() || "en-US";
  return d.toLocaleDateString(tag, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Display date as `dd/m/yyyy`; invalid values return `-`. */
export function formatDateDisplayDmy(v: unknown): string {
  const d =
    v instanceof Date
      ? v
      : (() => {
          const s = String(v ?? "").trim();
          if (!isValidDate(s)) return null;
          return new Date(s);
        })();
  if (!d || Number.isNaN(d.getTime())) return "-";
  return `${String(d.getDate()).padStart(2, "0")}/${d.getMonth() + 1}/${d.getFullYear()}`;
}
