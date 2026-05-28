import type { ZoneConfigurationRow } from "@/features/admin/api/adminApi";
import {
  computeInventoryStyleFarmGrassDailySeriesWithBreakdown,
  type DailySeriesResult,
  type RollingDailyAvailableDay,
} from "@/features/forecasting/forecastAvailableAtDate";
import type { ForecastHarvestRow } from "@/features/forecasting/forecastingTypes";
import type { RegrowthReferenceConfig } from "@/features/forecasting/forecastingRegrowth";
import type { InventoryAvailableOverrideEntry } from "@/shared/store/inventoryAvailableOverrideStore";

export type ForecastComputeWorkerRequest = {
  id: number;
  forecastRows: ForecastHarvestRow[];
  zoneConfigs: ZoneConfigurationRow[];
  regrowthConfig: RegrowthReferenceConfig;
  overridesByZone: Record<string, InventoryAvailableOverrideEntry>;
  startDateMs: number;
  endDateMs: number;
  debouncedFarmIds: string[];
  debouncedGrassIds: string[];
};

export type ForecastComputeWorkerResponse = {
  id: number;
  aggregate: RollingDailyAvailableDay[];
  byFarmProduct: Record<string, Record<string, RollingDailyAvailableDay>>;
};

export function serializeDailySeriesResult(result: DailySeriesResult): Omit<
  ForecastComputeWorkerResponse,
  "id"
> {
  const byFarmProduct: Record<string, Record<string, RollingDailyAvailableDay>> = {};
  for (const [fpKey, inner] of result.byFarmProduct) {
    byFarmProduct[fpKey] = Object.fromEntries(inner);
  }
  return {
    aggregate: result.aggregate,
    byFarmProduct,
  };
}

export function deserializeDailySeriesResult(
  payload: Omit<ForecastComputeWorkerResponse, "id">,
): DailySeriesResult {
  const byFarmProduct = new Map<string, Map<string, RollingDailyAvailableDay>>();
  for (const [fpKey, innerObj] of Object.entries(payload.byFarmProduct)) {
    byFarmProduct.set(fpKey, new Map(Object.entries(innerObj)));
  }
  return { aggregate: payload.aggregate, byFarmProduct };
}

export function runForecastDailySeriesCompute(
  input: Omit<ForecastComputeWorkerRequest, "id">,
): Omit<ForecastComputeWorkerResponse, "id"> {
  const farmIdSet = new Set(input.debouncedFarmIds);
  const grassIdSet = new Set(input.debouncedGrassIds);
  const farmProductFilter = (farmId: number, productId: number) => {
    if (farmIdSet.size > 0 && !farmIdSet.has(String(farmId))) return false;
    if (grassIdSet.size > 0 && !grassIdSet.has(String(productId))) return false;
    return true;
  };

  const result = computeInventoryStyleFarmGrassDailySeriesWithBreakdown(
    input.forecastRows,
    input.zoneConfigs,
    input.regrowthConfig,
    input.overridesByZone,
    new Date(input.startDateMs),
    new Date(input.endDateMs),
    farmProductFilter,
  );

  return serializeDailySeriesResult(result);
}
