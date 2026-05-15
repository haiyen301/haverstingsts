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

/**
 * When zone selects use `parseFarmZoneEntries(rows, "id")`, map a persisted
 * `zone_configurations.zone` (historical zone_name or numeric id string) to the
 * matching `/api/zones` row id for controlled `<select value={…}>`.
 */
export function farmZoneSelectIdForStoredZone(
  storedZone: string | null | undefined,
  farmZones: FarmZoneReferenceRow[],
): string | null {
  const key = storedZone != null ? String(storedZone).trim() : "";
  if (!key) return null;
  const exact = farmZones.find(
    (row) =>
      normalizeText(String(row.id ?? "")) === normalizeText(key) ||
      normalizeText(String(row.zone_name ?? "")) === normalizeText(key) ||
      normalizeText(String(row.label ?? "")) === normalizeText(key),
  );
  if (!exact) return null;
  const id = String(exact.id ?? "").trim();
  return id || null;
}

/** Virtual no-zone bucket keys produced by forecasting allocation (not always in `/api/zones`). */
export function isNoZoneSyntheticZoneId(zoneId: string | null | undefined): boolean {
  const s = String(zoneId ?? "").trim().toLowerCase();
  return !s || s === "nozone" || s === "no-zone" || s === "no zone";
}

/** Like {@link zoneIdToLabel}, but maps synthetic no-zone keys to a caller-provided display label (i18n). */
export function zoneIdToLabelResolved(
  zoneId: string | undefined | null,
  farmZones: FarmZoneReferenceRow[],
  noZoneDisplayLabel: string,
): string {
  if (isNoZoneSyntheticZoneId(zoneId)) {
    return noZoneDisplayLabel;
  }
  const key = zoneId != null ? String(zoneId).trim() : "";
  return zoneIdToLabel(zoneId, farmZones) || key;
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

/** Parse `sts_grasses.sales_from` / `sales_to` to `YYYY-MM-DD`, or null if unset/invalid. */
export function parseGrassSalesYmd(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s || s.startsWith("0000-00-00")) return null;
  const ymd = s.length >= 10 ? s.slice(0, 10) : s;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  return ymd;
}

/** Local calendar date `YYYY-MM-DD` (browser). */
export function todayYmdLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Grass appears in selects when it has a defined sales window and `refYmd` falls in range (inclusive).
 * - Both `sales_from` and `sales_to` empty → not selectable.
 * - Only `sales_from` → `refYmd >= sales_from`.
 * - Only `sales_to` → `refYmd <= sales_to`.
 * - Both set → `sales_from <= refYmd <= sales_to`.
 */
export function isGrassRowSelectableOnDate(row: unknown, refYmd: string): boolean {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  const from = parseGrassSalesYmd(r.sales_from);
  const to = parseGrassSalesYmd(r.sales_to);
  if (!from && !to) return false;
  if (from && refYmd < from) return false;
  if (to && refYmd > to) return false;
  return true;
}

export function filterGrassesBySalesWindow(grasses: unknown[], refYmd: string): unknown[] {
  return grasses.filter((g) => isGrassRowSelectableOnDate(g, refYmd));
}

/**
 * `/admin/zone-configurations` grass dropdown (evaluated on `refYmd`, typically today):
 * - Both `sales_from` and `sales_to` empty → show (no sales window configured).
 * - Otherwise today must fall in range: if `sales_from` set then `refYmd >= sales_from`;
 *   if `sales_to` set then `refYmd <= sales_to` (hide when `refYmd > sales_to`).
 */
export function isGrassRowVisibleForZoneConfigOnDate(row: unknown, refYmd: string): boolean {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  const from = parseGrassSalesYmd(r.sales_from);
  const to = parseGrassSalesYmd(r.sales_to);
  if (!from && !to) return true;
  if (from && refYmd < from) return false;
  if (to && refYmd > to) return false;
  return true;
}

export function filterGrassesForZoneConfigSelect(grasses: unknown[], refYmd: string): unknown[] {
  return grasses.filter((g) => isGrassRowVisibleForZoneConfigOnDate(g, refYmd));
}

/** Like {@link grassSelectRowsWithPinnedIds} but uses {@link filterGrassesForZoneConfigSelect}. */
export function grassZoneConfigSelectRowsWithPinnedIds(
  grasses: unknown[],
  refYmd: string,
  pinnedGrassIds: string[],
): unknown[] {
  const base = filterGrassesForZoneConfigSelect(grasses, refYmd);
  const seen = new Set(
    base.map((r) => {
      if (!r || typeof r !== "object") return "";
      return String((r as Record<string, unknown>).id ?? "").trim();
    }),
  );
  const out = [...base];
  for (const rawId of pinnedGrassIds) {
    const id = rawId.trim();
    if (!id || seen.has(id)) continue;
    const row = grasses.find(
      (g) =>
        g &&
        typeof g === "object" &&
        String((g as Record<string, unknown>).id ?? "").trim() === id,
    );
    if (row) {
      out.push(row);
      seen.add(id);
    }
  }
  return out;
}

/**
 * Visible if any reference date is inside the grass sales window.
 * Empty / invalid `refYmds` → uses {@link todayYmdLocal} (list filters / default behaviour).
 */
export function filterGrassesBySalesWindowsOr(
  grasses: unknown[],
  refYmds: string[],
): unknown[] {
  const dates = refYmds
    .map((s) => s.trim())
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
  const effective = dates.length > 0 ? dates : [todayYmdLocal()];
  return grasses.filter((g) => effective.some((ymd) => isGrassRowSelectableOnDate(g, ymd)));
}

/**
 * Catalog / filter `sales_window` in {@link pickGrassCatalogRows} (Forecasting, Inventory, etc.):
 * - Both `sales_from` and `sales_to` unset → row is **visible** (no window configured).
 * - Only `sales_from` → visible when `refYmd >= sales_from`.
 * - Only `sales_to` → visible when `refYmd <= sales_to` (hidden when `refYmd > sales_to`).
 * - Both set → inclusive `[sales_from, sales_to]`.
 *
 * OR across `refYmds`; empty / invalid list → {@link todayYmdLocal}.
 * Same predicate as {@link isGrassRowVisibleForZoneConfigOnDate}.
 */
export function filterGrassesForSalesCatalogWindowsOr(
  grasses: unknown[],
  refYmds: string[],
): unknown[] {
  const dates = refYmds
    .map((s) => String(s ?? "").trim())
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
  const effective = dates.length > 0 ? dates : [todayYmdLocal()];
  return grasses.filter((g) =>
    effective.some((ymd) => isGrassRowVisibleForZoneConfigOnDate(g, ymd)),
  );
}

/**
 * Harvest form grass visibility on one date (`/harvest/new`):
 * - Both `sales_from` and `sales_to` empty → show by default.
 * - Otherwise date must be in range (inclusive).
 */
export function isGrassRowVisibleForHarvestGrassSelectOnDate(
  row: unknown,
  refYmd: string,
): boolean {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  const from = parseGrassSalesYmd(r.sales_from);
  const to = parseGrassSalesYmd(r.sales_to);
  if (!from && !to) return true;
  if (from && refYmd < from) return false;
  if (to && refYmd > to) return false;
  return true;
}

/** Single entry point for grass dropdown / filter rows (list screens vs date-aware forms). */
export type GrassCatalogPickMode =
  | "all"
  /** Sales window for catalog filters: unset window → show; in-range inclusive; {@link filterGrassesForSalesCatalogWindowsOr}. */
  | "sales_window"
  /** Harvest / project product selects: OR on `refYmds` (empty → today) + {@link isGrassRowVisibleForHarvestGrassSelectOnDate}. */
  | "harvest_form_dates"
  /** Admin zone configuration grass select. */
  | "zone_config_dates";

export type PickGrassCatalogRowsArgs = {
  catalog: unknown[];
  mode: GrassCatalogPickMode;
  /** `YYYY-MM-DD` strings; meaning depends on `mode` (ignored for `all`). */
  refYmds: string[];
  /** Ids to always include from `catalog` (URL filters, edit mode). */
  pinnedGrassIds: string[];
};

/**
 * Append any `pinnedGrassIds` rows missing from `baseRows` (looked up in `fullCatalog`).
 */
export function mergePinnedGrassRowsFromCatalog(
  fullCatalog: unknown[],
  baseRows: unknown[],
  pinnedGrassIds: string[],
): unknown[] {
  const seen = new Set(
    baseRows.map((r) => {
      if (!r || typeof r !== "object") return "";
      return String((r as Record<string, unknown>).id ?? "").trim();
    }),
  );
  const out = [...baseRows];
  for (const rawId of pinnedGrassIds) {
    const id = rawId.trim();
    if (!id || seen.has(id)) continue;
    const row = fullCatalog.find(
      (g) =>
        g &&
        typeof g === "object" &&
        String((g as Record<string, unknown>).id ?? "").trim() === id,
    );
    if (row) {
      out.push(row);
      seen.add(id);
    }
  }
  return out;
}

export function pickGrassCatalogRows(args: PickGrassCatalogRowsArgs): unknown[] {
  const { catalog, mode, refYmds, pinnedGrassIds } = args;
  const dates = refYmds
    .map((s) => String(s ?? "").trim())
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));

  if (mode === "all") {
    const base = catalog.filter(
      (g) =>
        g &&
        typeof g === "object" &&
        String((g as Record<string, unknown>).id ?? "").trim() !== "",
    );
    return mergePinnedGrassRowsFromCatalog(catalog, base, pinnedGrassIds);
  }

  if (mode === "sales_window") {
    const base = filterGrassesForSalesCatalogWindowsOr(catalog, dates);
    return mergePinnedGrassRowsFromCatalog(catalog, base, pinnedGrassIds);
  }

  if (mode === "harvest_form_dates") {
    const effective = dates.length > 0 ? dates : [todayYmdLocal()];
    const base = catalog.filter((g) =>
      effective.some((ymd) => isGrassRowVisibleForHarvestGrassSelectOnDate(g, ymd)),
    );
    return mergePinnedGrassRowsFromCatalog(catalog, base, pinnedGrassIds);
  }

  if (mode === "zone_config_dates") {
    const refYmd = dates.length > 0 ? dates[0]! : todayYmdLocal();
    return grassZoneConfigSelectRowsWithPinnedIds(catalog, refYmd, pinnedGrassIds);
  }

  return [];
}

/**
 * @deprecated Prefer {@link pickGrassCatalogRows} with `mode: "harvest_form_dates"` and `refYmds: [refYmd]`.
 */
export function grassHarvestListFilterRowsWithPinnedIds(
  grasses: unknown[],
  refYmd: string,
  pinnedGrassIds: string[],
): unknown[] {
  return pickGrassCatalogRows({
    catalog: grasses,
    mode: "harvest_form_dates",
    refYmds: [refYmd],
    pinnedGrassIds,
  });
}

/** Rows allowed on `refYmd`, plus any `pinnedGrassIds` rows from the full list (e.g. active URL filter or edit form). */
export function grassSelectRowsWithPinnedIds(
  grasses: unknown[],
  refYmd: string,
  pinnedGrassIds: string[],
): unknown[] {
  return pickGrassCatalogRows({
    catalog: grasses,
    mode: "sales_window",
    refYmds: [refYmd],
    pinnedGrassIds,
  });
}

/** Harvest grass `<select>`: OR on any harvest calendar refs (fallback today); always include current `pinnedGrassId` if set. */
export function grassRowsForHarvestGrassSelect(
  grasses: unknown[],
  harvestRefYmds: string[],
  pinnedGrassId: string,
): unknown[] {
  return pickGrassCatalogRows({
    catalog: grasses,
    mode: "harvest_form_dates",
    refYmds: harvestRefYmds,
    pinnedGrassIds: pinnedGrassId.trim() ? [pinnedGrassId.trim()] : [],
  });
}
