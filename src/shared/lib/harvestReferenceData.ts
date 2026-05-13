/**
 * Helpers to turn STS API reference payloads into select options.
 * Shapes align with STSPortal React app (e.g. FilterTool: project.title, farms use `name`).
 */

export type HarvestSelectOption = { id: string; label: string };
export type FarmZoneReferenceRow = {
  id?: string | number;
  farm_id?: string | number;
  is_global?: boolean;
  farm_name?: string | null;
  country_name?: string | null;
  zone_name?: string | null;
  label?: string | null;
};

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

function normalizeText(value: string | null | undefined): string {
  return value ? value.trim().toLowerCase() : "";
}

export function normalizeFarmZoneRows(farmZones: unknown): FarmZoneReferenceRow[] {
  const rows = Array.isArray(farmZones) ? farmZones : [];
  const out: FarmZoneReferenceRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const zoneName = String(r.zone_name ?? r.label ?? "").trim();
    if (!zoneName) continue;
    out.push({
      id: r.id as string | number | undefined,
      farm_id: r.farm_id as string | number | undefined,
      is_global: Boolean(r.is_global),
      farm_name: r.farm_name != null ? String(r.farm_name) : null,
      country_name: r.country_name != null ? String(r.country_name) : null,
      zone_name: zoneName,
      label: r.label != null ? String(r.label) : zoneName,
    });
  }

  return out;
}

function dedupeZoneEntries(entries: [string, string][]): [string, string][] {
  const seen = new Set<string>();
  const out: [string, string][] = [];
  for (const [value, label] of entries) {
    const zoneValue = value.trim();
    if (!zoneValue) continue;
    const dedupeKey = normalizeText(zoneValue);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push([zoneValue, label.trim() || zoneValue]);
  }
  return out.sort((a, b) => a[1].localeCompare(b[1]));
}

export function parseFarmZoneEntries(
  farmZones: FarmZoneReferenceRow[],
  valueField: "zone_name" | "id" = "zone_name",
): [string, string][] {
  return dedupeZoneEntries(
    farmZones.map((row) => {
      const zoneName = String(row.zone_name ?? "").trim();
      const zoneId = String(row.id ?? "").trim();
      const value = valueField === "id" ? zoneId || zoneName : zoneName;
      return [value, String(row.label ?? row.zone_name ?? "").trim()];
    }),
  );
}

export function filterFarmZoneRowsByFarmId(
  farmZones: FarmZoneReferenceRow[],
  farmId: string | number | null | undefined,
): FarmZoneReferenceRow[] {
  const farmKey = String(farmId ?? "").trim();
  if (!farmKey) {
    return farmZones;
  }

  return farmZones.filter((row) => {
    if (row.is_global) {
      return true;
    }
    return String(row.farm_id ?? "").trim() === farmKey;
  });
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

/** Resolve farm display name from STS farm rows (`id`, `name`, …) stored in Zustand. */
export function farmNameByIdFromRows(
  farms: unknown[],
  farmId: string | undefined | null,
): string {
  const id = String(farmId ?? "").trim();
  if (!id) return "";
  for (const row of farms) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (String(r.id ?? "").trim() !== id) continue;
    return String(r.name ?? r.title ?? "").trim();
  }
  return "";
}

/** Resolve zone display label from `/api/zones` reference rows. */
export function zoneIdToLabel(
  zoneId: string | undefined | null,
  farmZones: FarmZoneReferenceRow[],
): string {
  const key = zoneId != null ? String(zoneId).trim() : "";
  if (!key) return "";

  const exact = farmZones.find(
    (row) =>
      normalizeText(String(row.id ?? "")) === normalizeText(key) ||
      normalizeText(String(row.zone_name ?? "")) === normalizeText(key) ||
      normalizeText(String(row.label ?? "")) === normalizeText(key),
  );
  if (exact) {
    return String(exact.label ?? exact.zone_name ?? key).trim() || key;
  }

  return key;
}
