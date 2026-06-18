import type { ForecastCacheScope } from "@/shared/store/forecastDataStore";
import { useForecastDataStore } from "@/shared/store/forecastDataStore";
import {
  ensureForecastDataLoaded,
  reloadForecastFromCache,
} from "@/features/forecasting/forecastDataLoader";
import { addMonths, getForecastToday, ymdFromDate } from "@/features/forecasting/forecastDateUtils";

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const pendingScopes = new Set<ForecastCacheScope>();

function flushPending(): void {
  const scopes = new Set(pendingScopes);
  pendingScopes.clear();

  const reloadScopes = new Set<ForecastCacheScope>();
  for (const scope of scopes) {
    if (scope === "grass") {
      reloadScopes.add("reference");
      continue;
    }
    reloadScopes.add(scope);
  }
  if (reloadScopes.size > 0) {
    void reloadForecastFromCache(reloadScopes, false);
  }

  const fullRebuild =
    scopes.has("rules") || scopes.has("grass") || scopes.has("reference");
  const phpQueuedSnapshotRebuild =
    fullRebuild || scopes.has("zones") || scopes.has("overrides") || scopes.has("harvest");
  const affectsSnapshots =
    phpQueuedSnapshotRebuild ||
    scopes.has("harvest") ||
    scopes.has("overrides");

  if (affectsSnapshots) {
    useForecastDataStore.getState().setSnapshotRebuildPending(true);
  }

  if (phpQueuedSnapshotRebuild) {
    // PHP queues full or forward rebuild — poll until complete.
    return;
  }
}

function scheduleRefresh(scope: ForecastCacheScope): void {
  pendingScopes.add(scope);
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    flushPending();
  }, 150);
}

export function onForecastMutation(scope: ForecastCacheScope): void {
  scheduleRefresh(scope);
}

export function onForecastMutations(scopes: ForecastCacheScope[]): void {
  for (const scope of scopes) {
    pendingScopes.add(scope);
  }
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    flushPending();
  }, 150);
}

type GrassCatalogForecastRow = {
  status?: string | null;
  sales_from?: string | null;
  sales_to?: string | null;
};

function normalizeGrassForecastField(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw || raw.startsWith("0000-00-00")) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const status = raw.toLowerCase();
  if (["inactive", "0", "false", "disabled"].includes(status)) return "inactive";
  if (status === "active") return "active";
  return raw;
}

/** Parity Grasses.php::grassMutationAffectsForecast — status / sales window only. */
export function grassCatalogMutationAffectsForecast(
  before: GrassCatalogForecastRow | null | undefined,
  after: GrassCatalogForecastRow,
): boolean {
  if (before == null) return true;

  for (const key of ["status", "sales_from", "sales_to"] as const) {
    if (
      normalizeGrassForecastField(before[key]) !== normalizeGrassForecastField(after[key])
    ) {
      return true;
    }
  }

  return false;
}

export function onGrassCatalogForecastMutation(): void {
  onForecastMutation("grass");
}

const ZONE_FORECAST_DATA_START = "2019-01-01";

export type ZoneConfigForecastRow = {
  farm_id?: number | string | null;
  grass_id?: number | string | null;
  zone?: string | null;
  size_m2?: number | string | null;
  inventory_kg_per_m2?: number | string | null;
  max_inventory_kg?: number | string | null;
  effective_from?: string | null;
  effective_to?: string | null;
  status?: string | null;
};

function normalizeZoneConfigDate(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw || raw.startsWith("0000-00-00")) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return raw;
}

function normalizeZoneConfigField(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    const s = value.toFixed(6);
    return s.replace(/\.?0+$/, "");
  }
  return String(value).trim();
}

/** Parity Zone_configurations.php::zoneMutationAffectsForecast */
export function zoneMutationAffectsForecast(
  before: ZoneConfigForecastRow | null | undefined,
  after: ZoneConfigForecastRow,
): boolean {
  if (before == null) return true;

  for (const key of [
    "farm_id",
    "grass_id",
    "zone",
    "size_m2",
    "inventory_kg_per_m2",
    "max_inventory_kg",
    "effective_from",
    "effective_to",
    "status",
  ] as const) {
    if (normalizeZoneConfigField(before[key]) !== normalizeZoneConfigField(after[key])) {
      return true;
    }
  }

  return false;
}

function zoneConfigIsOpenEnded(row: ZoneConfigForecastRow): boolean {
  const from = normalizeZoneConfigDate(row.effective_from);
  const to = normalizeZoneConfigDate(row.effective_to);
  return !from && !to;
}

function addDayYmd(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Parity ForecastAffectedDateResolver::zoneConfigurationRebuildPlan */
export function zoneConfigurationRebuildPlanClient(
  before: ZoneConfigForecastRow | null | undefined,
  after: ZoneConfigForecastRow | null | undefined,
): { kind: "full" } | { kind: "forward"; fromDate: string } | { kind: "range"; fromDate: string; toDate: string } {
  const today = ymdFromDate(getForecastToday());
  const horizonEnd = ymdFromDate(addMonths(getForecastToday(), 12));

  for (const row of [before, after]) {
    if (!row) continue;
    if (zoneConfigIsOpenEnded(row)) {
      return { kind: "full" };
    }
  }

  const fromCandidates: string[] = [];
  const toCandidates: string[] = [];
  let openRight = false;

  for (const row of [before, after]) {
    if (!row) continue;
    const from = normalizeZoneConfigDate(row.effective_from);
    const to = normalizeZoneConfigDate(row.effective_to);

    if (from) {
      fromCandidates.push(from);
    } else if (to) {
      fromCandidates.push(ZONE_FORECAST_DATA_START);
    }

    if (to) {
      toCandidates.push(to);
      fromCandidates.push(addDayYmd(to));
    } else {
      openRight = true;
    }
  }

  if (fromCandidates.length === 0) {
    return { kind: "full" };
  }

  let fromDate = fromCandidates.reduce((a, b) => (a < b ? a : b));
  if (fromDate > today) fromDate = today;
  if (fromDate < ZONE_FORECAST_DATA_START) fromDate = ZONE_FORECAST_DATA_START;

  if (openRight || toCandidates.length === 0) {
    return { kind: "forward", fromDate };
  }

  let toDate = toCandidates.reduce((a, b) => (a > b ? a : b));
  if (toDate < fromDate) toDate = fromDate;
  if (toDate < today) toDate = today;
  if (toDate > horizonEnd) toDate = horizonEnd;

  return { kind: "range", fromDate, toDate };
}

export function onZoneConfigurationForecastMutation(): void {
  onForecastMutation("zones");
}

/** Parity ForecastAffectedDateResolver::fromInventoryBalanceMutation */
export function inventoryBalanceRebuildFromDate(
  beforeDate: string | null | undefined,
  afterDate: string | null | undefined,
): string {
  const today = ymdFromDate(getForecastToday());
  const dates: string[] = [];

  for (const raw of [beforeDate, afterDate]) {
    const ymd = String(raw ?? "").trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      dates.push(ymd);
    }
  }

  if (dates.length === 0) return today;

  const minDate = dates.reduce((a, b) => (a < b ? a : b));
  return minDate > today ? today : minDate;
}

export function onInventoryBalanceForecastMutation(): void {
  onForecastMutation("overrides");
}

/** Farm/zone catalog delete — PHP queues full-history rebuild; poll until complete. */
export function onForecastFullRebuildMutation(): void {
  onForecastMutation("reference");
}

/** Harvest plan mutations — PHP queues rebuild on save; client only invalidates cache + poll. */
export function onHarvestForecastMutation(): void {
  onForecastMutation("harvest");
}

/** Earliest forward-rebuild day for a pace planned-harvest window. */
export function harvestPlanRebuildFromPaceSpan(
  span: { firstYmd: string; lastYmd: string } | null | undefined,
  seedDates?: Array<string | null | undefined>,
): string {
  const today = ymdFromDate(getForecastToday());
  const dates: string[] = [];

  const first = String(span?.firstYmd ?? "").trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(first)) {
    dates.push(first);
  }

  for (const raw of seedDates ?? []) {
    const ymd = String(raw ?? "").trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      dates.push(ymd);
    }
  }

  if (dates.length === 0) return today;

  const minDate = dates.reduce((a, b) => (a < b ? a : b));
  return minDate > today ? today : minDate;
}

/** Whether a project row save can affect harvest forecast numbers. */
export function rowDataAffectsHarvest(row: Record<string, unknown>): boolean {
  function hasValue(v: unknown): boolean {
    if (v == null) return false;
    const s = String(v).trim();
    return s.length > 0 && s !== "0";
  }

  if (
    hasValue(row.farm_id) ||
    hasValue(row.farmId) ||
    hasValue(row.zone) ||
    hasValue(row.product_id) ||
    hasValue(row.productId) ||
    hasValue(row.grass_id) ||
    hasValue(row.grassId)
  ) {
    return true;
  }

  if (
    hasValue(row.quantity_kg) ||
    hasValue(row.quantityKg) ||
    hasValue(row.quantity_m2) ||
    hasValue(row.quantityM2) ||
    hasValue(row.harvested_area) ||
    hasValue(row.harvestedArea)
  ) {
    return true;
  }

  const subs = row.subitems ?? row.sub_items;
  return Array.isArray(subs) && subs.length > 0;
}

export async function notifyForecastRefresh(
  scopes: Set<ForecastCacheScope>,
): Promise<void> {
  await reloadForecastFromCache(scopes, false);
}

export async function ensureForecastReady(): Promise<void> {
  await ensureForecastDataLoaded({
    scopes: new Set<ForecastCacheScope>([
      "overrides",
      "harvest",
      "zones",
      "rules",
      "reference",
    ]),
  });
}
