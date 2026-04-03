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

function slug(value: string | null | undefined): string {
  if (!value) return "";
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function parseFarmName(farmName: string): { code: string; location: string } {
  const parts = farmName.split("-");
  if (!parts.length) return { code: "", location: "" };
  return {
    code: parts[0].trim().toUpperCase(),
    location: parts.length > 1 ? parts.slice(1).join("-").trim() : "",
  };
}

function detectLegacyLocation(farmName: string): string | null {
  const farmLower = farmName.toLowerCase();
  const normalized = farmLower.replace(/[\s\-_]/g, "");
  const locationPatterns: Record<string, string[]> = {
    hoian: ["hoian", "hoi an"],
    phanthiet: ["phanthiet", "phan thiet"],
    laemchabang: ["laemchabang", "laem chabang"],
  };
  for (const [key, patterns] of Object.entries(locationPatterns)) {
    for (const p of patterns) {
      const pLower = p.toLowerCase();
      const pNormalized = pLower.replace(/[\s\-_]/g, "");
      if (farmLower.includes(pLower) || normalized.includes(pNormalized)) {
        return key;
      }
    }
  }
  return null;
}

/** Flutter-compatible filter by farm name (`AppConstants.filterZonesByFarmName`). */
export function filterZoneEntriesByFarmName(
  zoneEntries: [string, string][],
  farmName: string,
): [string, string][] {
  const trimmedFarmName = farmName.trim();
  if (!zoneEntries.length || !trimmedFarmName) {
    return zoneEntries;
  }

  const countrySuffix: Record<string, string> = {
    VN: "_vn",
    TH: "_th",
    MY: "_my",
  };
  const countryWords: Record<string, string> = {
    VN: "vietnam",
    TH: "thailand",
    MY: "malaysia",
  };

  const parsedFarm = parseFarmName(trimmedFarmName);
  let detectedCountryCode: string | null = countrySuffix[parsedFarm.code]
    ? parsedFarm.code
    : null;
  let detectedLocation = parsedFarm.location || null;

  if (!detectedCountryCode) {
    const farmLower = trimmedFarmName.toLowerCase();
    for (const [code, suffix] of Object.entries(countrySuffix)) {
      const word = (countryWords[code] ?? "").toLowerCase();
      if (farmLower.endsWith(suffix) || (word && farmLower.includes(word))) {
        detectedCountryCode = code;
        break;
      }
    }
  }

  if (!detectedLocation) {
    detectedLocation = detectLegacyLocation(trimmedFarmName);
  }

  const suffix = detectedCountryCode ? countrySuffix[detectedCountryCode] : null;
  const countryWord = detectedCountryCode
    ? countryWords[detectedCountryCode]
    : null;

  let candidates = zoneEntries.filter(([key, value]) => {
    const keyLower = key.toLowerCase();
    if (suffix && keyLower.endsWith(suffix)) {
      return true;
    }
    const countrySlug = slug(countryWord);
    return (
      countrySlug.length > 0 &&
      (slug(key).includes(countrySlug) || slug(value).includes(countrySlug))
    );
  });

  if (!candidates.length) {
    candidates = zoneEntries;
  }

  const locationSlug = slug(detectedLocation);
  if (locationSlug) {
    const byLocation = candidates.filter(
      ([key, value]) =>
        slug(key).includes(locationSlug) || slug(value).includes(locationSlug),
    );
    if (byLocation.length) {
      candidates = byLocation;
    }
  }

  return candidates;
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
