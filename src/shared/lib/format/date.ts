/**
 * Date formatting helpers for STS pages.
 */

/** STSPortal stores `Y-m-d H:i:s` in UTC (no `Z` suffix). Display in UTC+7 for admin UI. */
export const STS_DISPLAY_TIME_ZONE = "Asia/Ho_Chi_Minh";

const STS_UTC_DATETIME_WITHOUT_ZONE_RE =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

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

/**
 * Parse STSPortal datetime from DB/API. Strings like `2026-05-29 10:30:00` are UTC.
 */
export function parseStsPortalUtcDate(input: unknown): Date | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  const normalized = STS_UTC_DATETIME_WITHOUT_ZONE_RE.test(raw)
    ? `${raw.replace(" ", "T")}Z`
    : raw;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Format UTC DB timestamp in {@link STS_DISPLAY_TIME_ZONE} (UTC+7). */
export function formatDateTimeInDisplayZone(
  input: unknown,
  locale?: string,
): string {
  const d = parseStsPortalUtcDate(input);
  if (!d) {
    const s = String(input ?? "").trim();
    return s || "—";
  }
  return new Intl.DateTimeFormat(locale?.trim() || "en-US", {
    timeZone: STS_DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** Display datetime as `dd/m/yyyy HH:ii:ss` in {@link STS_DISPLAY_TIME_ZONE}. */
export function formatDateTimeDisplayDmyHms(input: unknown): string {
  const d = parseStsPortalUtcDate(input);
  if (!d) return "-";

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: STS_DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const dd = get("day").padStart(2, "0");
  const m = get("month");
  const yyyy = get("year");
  const HH = get("hour").padStart(2, "0");
  const ii = get("minute").padStart(2, "0");
  const ss = get("second").padStart(2, "0");

  return `${dd}/${m}/${yyyy} ${HH}:${ii}:${ss}`;
}

/** Tooltip: raw UTC value and converted UTC+7 display. */
export function formatStsPortalUtcTooltip(
  input: unknown,
  locale?: string,
): string {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  const display = formatDateTimeInDisplayZone(input, locale);
  return `UTC: ${raw} → UTC+7 (${STS_DISPLAY_TIME_ZONE}): ${display}`;
}
