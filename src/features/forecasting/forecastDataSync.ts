import type { ForecastCacheScope } from "@/shared/store/forecastDataStore";
import { useForecastDataStore } from "@/shared/store/forecastDataStore";
import {
  ensureForecastDataLoaded,
  reloadForecastFromCache,
} from "@/features/forecasting/forecastDataLoader";
import { queueForecastForwardRebuild } from "@/features/forecasting/forecastSnapshotApi";
import { getForecastToday, ymdFromDate } from "@/features/forecasting/forecastDateUtils";

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const pendingScopes = new Set<ForecastCacheScope>();

function flushPending(): void {
  const scopes = new Set(pendingScopes);
  pendingScopes.clear();
  void reloadForecastFromCache(scopes, false);
  if (scopes.has("harvest") || scopes.has("zones") || scopes.has("overrides") || scopes.has("rules")) {
    useForecastDataStore.getState().bumpDbSeriesRefresh();
    void queueForecastForwardRebuild(ymdFromDate(getForecastToday())).catch(() => undefined);
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
