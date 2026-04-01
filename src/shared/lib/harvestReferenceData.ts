/**
 * Helpers to turn STS API reference payloads (stored as unknown[]) into select options.
 * Shapes align with STSPortal React app (e.g. FilterTool: project.title, farms use `name`).
 */

export type HarvestSelectOption = { id: string; label: string };

export function mapRowsToSelectOptions(
  rows: unknown[],
  labelKey: "title" | "name",
): HarvestSelectOption[] {
  const out: HarvestSelectOption[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = r.id;
    if (id === undefined || id === null) continue;
    const raw =
      labelKey === "title"
        ? (r.title ?? r.name)
        : (r.name ?? r.title);
    const label = raw !== undefined && raw !== null ? String(raw) : String(id);
    out.push({ id: String(id), label });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** Farm zones map: zone key → display label (e.g. from mergeFarmZonesWithRegionKey). */
export function parseFarmZoneEntries(farmZones: unknown): [string, string][] {
  if (
    !farmZones ||
    typeof farmZones !== "object" ||
    Array.isArray(farmZones)
  ) {
    return [];
  }
  return Object.entries(farmZones as Record<string, string>).sort((a, b) =>
    a[1].localeCompare(b[1]),
  );
}

/**
 * Resolve country label from STS country rows (`id`, `country_name`, …) stored in Zustand.
 */
export function countryNameByIdFromRows(
  countries: unknown[],
  countryId: string | undefined | null,
): string {
  const id = String(countryId ?? "").trim();
  if (!id) return "";
  for (const row of countries) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (String(r.id ?? "").trim() !== id) continue;
    return String(r.country_name ?? r.name ?? r.title ?? "").trim();
  }
  return "";
}

/** Resolve zone key (id) from `react_get_farm_zones` map → human label for tables. */
export function zoneIdToLabel(
  zoneId: string | undefined | null,
  farmZones: unknown,
): string {
  const key = zoneId != null ? String(zoneId).trim() : "";
  if (!key) return "";
  const entries = parseFarmZoneEntries(farmZones);
  const hit = entries.find(([k]) => k === key);
  return hit ? hit[1] : key;
}
