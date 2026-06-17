import {
  filterActiveRegrowthRules,
  filterActiveZoneConfigurations,
} from "@/features/forecasting/forecastActiveRecords";
import {
  buildForecastRowsFromHarvestRaw,
  fetchHarvestRowsForForecasting,
} from "@/features/forecasting/mapHarvestApiToForecastRows";
import { setForecastZoneCatalog } from "@/features/forecasting/zoneKeyNormalization";
import {
  resolveRegrowthReferenceConfigFromRules,
} from "@/features/forecasting/forecastingRegrowth";
import {
  forecastHarvestDateRange,
  getForecastToday,
} from "@/features/forecasting/forecastDateUtils";
import {
  type ForecastCacheScope,
  FORECAST_DATA_SCOPES,
  forecastStoreHasCoreData,
  useForecastDataStore,
} from "@/shared/store/forecastDataStore";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { useInventoryAvailableOverrideStore } from "@/shared/store/inventoryAvailableOverrideStore";

let loadToken = 0;
let harvestFetchPromise: Promise<{ rows: Record<string, unknown>[]; error?: string }> | null =
  null;
let harvestFetchKey = "";

export type EnsureLoadedOptions = {
  scopes?: Set<ForecastCacheScope>;
  force?: boolean;
  showLoading?: boolean;
};

/** Sync catalog rows already held in `harvestingDataStore` — never hits the network. */
function syncReferenceFromHarvestingStore(): void {
  const harvestStore = useHarvestingDataStore.getState();
  setForecastZoneCatalog(harvestStore.farmZones);
  useForecastDataStore.getState().markValid("reference");
}

async function loadReference(_force: boolean): Promise<void> {
  syncReferenceFromHarvestingStore();
}

async function loadZones(token: number): Promise<void> {
  const rows = filterActiveZoneConfigurations(
    useHarvestingDataStore.getState().zoneConfigurations,
  );
  if (token !== loadToken) return;
  const store = useForecastDataStore.getState();
  store.setZoneConfigs(rows);
  store.markValid("zones");
}

async function loadRules(token: number): Promise<void> {
  const rules = filterActiveRegrowthRules(
    useHarvestingDataStore.getState().regrowthRules,
  );
  if (token !== loadToken) return;
  useForecastDataStore
    .getState()
    .setRegrowthConfig(resolveRegrowthReferenceConfigFromRules(rules));
  useForecastDataStore.getState().markValid("rules");
}

async function loadOverrides(token: number): Promise<void> {
  await useInventoryAvailableOverrideStore.getState().fetchOverrides();
  if (token !== loadToken) return;
  useForecastDataStore.getState().markValid("overrides");
}

async function fetchHarvestRowsDeduped(
  from: string,
  to: string,
  farms: unknown[],
): Promise<{ rows: Record<string, unknown>[]; error?: string }> {
  const key = `${from}|${to}`;
  if (harvestFetchPromise && harvestFetchKey === key) {
    return harvestFetchPromise;
  }
  harvestFetchKey = key;
  harvestFetchPromise = fetchHarvestRowsForForecasting({
    actual_harvest_date_from: from,
    actual_harvest_date_to: to,
    perPage: 500,
    maxPages: 400,
    farms,
  }).finally(() => {
    if (harvestFetchPromise) {
      harvestFetchPromise = null;
      harvestFetchKey = "";
    }
  });
  return harvestFetchPromise;
}

async function loadHarvest(token: number): Promise<void> {
  const { from, to } = forecastHarvestDateRange();
  const farms = useHarvestingDataStore.getState().farms;
  const res = await fetchHarvestRowsDeduped(from, to, farms);
  if (token !== loadToken) return;

  const store = useForecastDataStore.getState();
  const zoneConfigs = store.zoneConfigs ?? [];
  const today = getForecastToday();
  const farmZones = useHarvestingDataStore.getState().farmZones;
  const forecastRows = buildForecastRowsFromHarvestRaw(
    res.rows,
    zoneConfigs,
    today,
    farmZones,
  );

  store.setHarvestData({
    harvestRowsRaw: res.rows,
    harvestError: res.error ?? null,
    forecastRows,
    harvestDateFrom: from,
    harvestDateTo: to,
  });
  store.markValid("harvest");

  if (res.error) {
    store.setLoadState({ error: res.error });
  }
}

/** Re-map forecast rows when zones arrive after harvest (or zones refresh). */
function remapForecastRowsIfNeeded(): void {
  const store = useForecastDataStore.getState();
  const { harvestRowsRaw, zoneConfigs } = store;
  if (!harvestRowsRaw?.length || !zoneConfigs?.length) return;
  const today = getForecastToday();
  const farmZones = useHarvestingDataStore.getState().farmZones;
  const mapped = buildForecastRowsFromHarvestRaw(
    harvestRowsRaw,
    zoneConfigs,
    today,
    farmZones,
  );
  store.setHarvestData({
    harvestRowsRaw,
    harvestError: store.harvestError,
    forecastRows: mapped,
    harvestDateFrom: store.harvestDateFrom ?? forecastHarvestDateRange().from,
    harvestDateTo: store.harvestDateTo ?? forecastHarvestDateRange().to,
  });
}

export async function ensureForecastDataLoaded(
  options: EnsureLoadedOptions = {},
): Promise<void> {
  const scopes =
    options.scopes ??
    new Set<ForecastCacheScope>([...FORECAST_DATA_SCOPES, "reference"]);
  const force = options.force ?? false;
  const showLoading = options.showLoading ?? true;

  const store = useForecastDataStore.getState();
  const needed = store.scopesNeedingFetch(scopes, force);
  if (needed.size === 0) return;

  const token = ++loadToken;
  const hadSnapshot = store.hasSnapshot;

  store.setLoadState({
    isLoading: showLoading && !hadSnapshot,
    isRefreshing: hadSnapshot,
    error: null,
  });

  const futures: Promise<void>[] = [];

  if (needed.has("reference")) {
    futures.push(loadReference(force));
  }
  if (needed.has("zones")) {
    futures.push(loadZones(token));
  }
  if (needed.has("harvest")) {
    futures.push(loadHarvest(token));
  }
  if (needed.has("rules")) {
    futures.push(loadRules(token));
  }
  if (needed.has("overrides")) {
    futures.push(loadOverrides(token));
  }

  try {
    await Promise.all(futures);

    if (token !== loadToken) return;

    if (needed.has("zones") || needed.has("harvest")) {
      remapForecastRowsIfNeeded();
    }

    const next = useForecastDataStore.getState();
    next.setLoadState({
      isLoading: false,
      isRefreshing: false,
      hasSnapshot: forecastStoreHasCoreData() || next.forecastRows != null,
    });
  } catch (e) {
    if (token !== loadToken) return;
    useForecastDataStore.getState().setLoadState({
      isLoading: false,
      isRefreshing: false,
      error: e instanceof Error ? e.message : "Failed to load forecast data",
    });
  }
}

/** Forecast/inventory screens read reference catalog from Zustand — never bootstrap here. */
export const HARVEST_REFERENCE_STORE_ONLY_PATH_PREFIXES = [
  "/forecasting",
  "/inventory",
  "/inventory-import",
] as const;

export function isHarvestReferenceStoreOnlyPath(pathname: string): boolean {
  const path = pathname.split("?")[0] ?? pathname;
  return HARVEST_REFERENCE_STORE_ONLY_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

const FORECAST_PREFETCH_PATH_PREFIXES = [
  "/dashboard",
  ...HARVEST_REFERENCE_STORE_ONLY_PATH_PREFIXES,
] as const;

/** Routes that benefit from warming the forecast harvest cache in the background. */
export function isForecastHarvestPrefetchPath(pathname: string): boolean {
  const path = pathname.split("?")[0] ?? pathname;
  return FORECAST_PREFETCH_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/** Warm cache when idle (e.g. from dashboard). */
export async function prefetchForecastDataIfIdle(): Promise<void> {
  const store = useForecastDataStore.getState();
  if (store.hasSnapshot && store.isFresh("harvest")) return;
  await ensureForecastDataLoaded({
    scopes: new Set([...FORECAST_DATA_SCOPES, "reference"]),
    showLoading: false,
  });
}

export async function reloadForecastFromCache(
  scopes: Set<ForecastCacheScope>,
  showLoading = false,
): Promise<void> {
  for (const scope of scopes) {
    useForecastDataStore.getState().invalidate(scope);
  }
  await ensureForecastDataLoaded({ scopes, force: true, showLoading });
}
