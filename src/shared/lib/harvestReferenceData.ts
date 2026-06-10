/**
 * Helpers to turn STS API reference payloads into select options.
 * Shapes align with STSPortal React app (e.g. FilterTool: project.title, farms use `name`).
 */

export type HarvestSelectOption = { id: string; label: string };
export type FarmZoneReferenceRow = {
  id?: string | number;
  /** Comma-separated farm ids, e.g. `"1,2,3"`. */
  farm_id?: string | number;
  is_global?: boolean;
  farm_name?: string | null;
  farm_names?: string[];
  country_name?: string | null;
  zone_name?: string | null;
  label?: string | null;
  /** Legacy Flutter / constant-map key when present on API rows. */
  legacy_key?: string | null;
};

export function parseFarmIdCsv(value: string | number | null | undefined): string[] {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "0") return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "" && part !== "0");
}

export type KeyAreaReferenceRow = {
  id: string;
  title: string;
  sort_order?: number;
};

export function parseFarmIdsFromMeta(value: string | null | undefined): string[] {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .map((x) => String(x).trim())
        .filter((id) => id !== "" && id !== "0");
    }
  } catch {
    /* fall through to comma-separated */
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== "0");
}

/** First farm id from user meta that exists in the farm catalog (select value). */
export function resolveDefaultFarmSelectId(
  farmOptions: HarvestSelectOption[],
  farmUserMeta: string | null | undefined,
): string {
  const ids = parseFarmIdsFromMeta(farmUserMeta);
  if (ids.length === 0) return "";
  const optionIds = new Set(farmOptions.map((o) => o.id));
  for (const id of ids) {
    if (optionIds.has(id)) return id;
  }
  return ids[0] ?? "";
}

/** Match project catalog row by internal `id` or business `project_id`. */
export function findProjectRowBySelectId(
  projects: unknown[],
  selectId: string,
): Record<string, unknown> | undefined {
  const normalized = selectId.trim();
  if (!normalized) return undefined;
  for (const item of projects) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const rowId = String(row.id ?? "").trim();
    const rowProjectId = String(row.project_id ?? "").trim();
    if (rowId === normalized || rowProjectId === normalized) return row;
  }
  return undefined;
}

export function projectSelectIdFromRow(row: Record<string, unknown>): string {
  return String(row.id ?? row.project_id ?? "").trim();
}

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
    const id = String(r.id ?? "").trim();
    const zoneName = String(r.zone_name ?? r.label ?? "").trim();
    if (!zoneName && !id) continue;
    const displayName = zoneName || id;
    const legacyKey =
      r.legacy_key != null && String(r.legacy_key).trim() !== ""
        ? String(r.legacy_key).trim()
        : null;
    const farmNamesRaw = Array.isArray(r.farm_names) ? r.farm_names : [];
    const farmNames = farmNamesRaw
      .map((value) => String(value ?? "").trim())
      .filter((value) => value !== "");
    out.push({
      id: id || undefined,
      farm_id: r.farm_id as string | number | undefined,
      is_global: Boolean(r.is_global),
      farm_name: r.farm_name != null ? String(r.farm_name) : null,
      farm_names: farmNames.length ? farmNames : undefined,
      country_name: r.country_name != null ? String(r.country_name) : null,
      zone_name: displayName,
      label: String(r.label ?? r.zone_name ?? displayName).trim() || displayName,
      legacy_key: legacyKey,
    });
  }

  return out;
}

/** Admin `/api/keyareas` rows for id → title resolution. */
export function normalizeKeyAreaRows(raw: unknown): KeyAreaReferenceRow[] {
  const rows = Array.isArray(raw) ? raw : [];
  const out: KeyAreaReferenceRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = String(r.id ?? "").trim();
    const title = String(r.title ?? "").trim();
    if (!id || !title) continue;
    out.push({
      id,
      title,
      sort_order: Number(r.sort_order ?? 0),
    });
  }
  return out.sort(
    (a, b) =>
      Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) ||
      a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
  );
}

/** Resolve stored key-area id or legacy title slug to admin catalog title. */
export function keyAreaIdOrKeyToLabel(
  raw: string | null | undefined,
  catalog: KeyAreaReferenceRow[],
): string {
  const key = String(raw ?? "").trim();
  if (!key) return "";
  const byId = catalog.find((r) => r.id === key);
  if (byId) return byId.title;
  const norm = normalizeText(key);
  const byTitle = catalog.find((r) => normalizeText(r.title) === norm);
  if (byTitle) return byTitle.title;
  return key;
}

/** Harvest / plan rows may persist zone under `zone` or `zone_id`. */
export function harvestRecordZoneStoredValue(
  record: Record<string, unknown>,
): string {
  return String(record.zone ?? record.zone_id ?? "").trim();
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

    return parseFarmIdCsv(row.farm_id).includes(farmKey);
  });
}

export type CountrySelectOption = { id: string; name: string };

/** Whether `sts_countries.active` is enabled (1 / true / "active"). */
export function isCountryRowActive(row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  const active = r.active;
  if (active === true || active === 1 || active === "1") return true;
  const text = String(active ?? "").trim().toLowerCase();
  return text === "true" || text === "yes" || text === "active";
}

/** Rows with `active = 1` for dropdowns and filters. */
export function filterActiveCountryRows(countries: unknown[]): unknown[] {
  return countries.filter(isCountryRowActive);
}

const INACTIVE_GRASS_STATUS_VALUES = new Set(["inactive", "0", "false", "disabled"]);

/** Whether `sts_grasses.status` is active (missing status defaults to active). */
export function isGrassRowActive(row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  const status = String(r.status ?? "active").trim().toLowerCase();
  return !INACTIVE_GRASS_STATUS_VALUES.has(status);
}

/** Grass catalog rows with `status = active` for dropdowns and forecasting filters. */
export function filterActiveGrassRows(grasses: unknown[]): unknown[] {
  return grasses.filter(isGrassRowActive);
}

function countryRowToSelectOption(row: unknown): CountrySelectOption | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const id = String(r.id ?? "").trim();
  const name = String(r.country_name ?? r.name ?? r.title ?? "").trim();
  if (!id || !name) return null;
  return { id, name };
}

/**
 * Select options from active countries only.
 * `pinnedCountryId` keeps the current value visible on edit when it is no longer active.
 */
export function buildCountrySelectOptions(
  countries: unknown[],
  pinnedCountryId?: string | null,
): CountrySelectOption[] {
  const seen = new Set<string>();
  const out: CountrySelectOption[] = [];

  for (const row of filterActiveCountryRows(countries)) {
    const opt = countryRowToSelectOption(row);
    if (!opt || seen.has(opt.id)) continue;
    seen.add(opt.id);
    out.push(opt);
  }

  const pinned = String(pinnedCountryId ?? "").trim();
  if (pinned && !seen.has(pinned)) {
    for (const row of countries) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      if (String(r.id ?? "").trim() !== pinned) continue;
      const opt = countryRowToSelectOption(row);
      if (opt) {
        out.push(opt);
        seen.add(opt.id);
      }
      break;
    }
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
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
  const exact = farmZones.find((row) => farmZoneRowMatchesStoredValue(row, key));
  if (!exact) return null;
  const id = String(exact.id ?? "").trim();
  return id || null;
}

function farmZoneRowMatchesStoredValue(
  row: FarmZoneReferenceRow,
  stored: string,
): boolean {
  const key = normalizeText(stored);
  if (!key) return false;
  return (
    normalizeText(String(row.id ?? "")) === key ||
    normalizeText(String(row.zone_name ?? "")) === key ||
    normalizeText(String(row.label ?? "")) === key ||
    normalizeText(String(row.legacy_key ?? "")) === key
  );
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

  const exact = farmZones.find((row) => farmZoneRowMatchesStoredValue(row, key));
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
