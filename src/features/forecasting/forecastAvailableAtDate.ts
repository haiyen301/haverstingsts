import type { ZoneConfigurationRow } from "@/features/admin/api/adminApi";
import type { ForecastHarvestRow } from "@/features/forecasting/forecastingTypes";
import type { RegrowthReferenceConfig } from "@/features/forecasting/forecastingRegrowth";
import { FORECAST_NOZONE_ZONE } from "@/features/forecasting/forecastingInventoryConversion";
import {
  buildZoneConfigurationCapacityMapAtDate,
  computeZoneCapacityMap,
  forecastZoneKeyFromParts,
  forecastZoneKeyFromRow,
  getRegrowthDateFromHarvest,
  mergeZoneCapacityMaps,
  sumConfiguredZoneCapKgForFarmProduct,
} from "@/features/forecasting/inventoryRegrowthCalculator";
import { computeRegrowthAllocationForFarmProductDate } from "@/features/forecasting/regrowthAllocation";

function rowInventoryKg(row: ForecastHarvestRow): number {
  return Number.isFinite(row.inventoryKg) ? row.inventoryKg : row.quantity;
}

export type AvailableByZoneAtDateResult = {
  availableByZone: Map<string, number>;
  /** kg exceeding configured zone caps (same as regrowth overflow). */
  overlimitKg: number;
  /** `{farmId}|{productId}` → overflow kg */
  overlimitByFarmProduct: Map<string, number>;
};

/**
 * Projected available inventory at `forecastDate`, using the same zone fill + overflow
 * rules as regrowth events (`computeRegrowthAllocationForFarmProductDate`).
 */
export function computeAllocatedAvailableByZoneAtDate(
  rows: ForecastHarvestRow[],
  regrowthConfig: RegrowthReferenceConfig,
  forecastDate: Date,
  zoneConfigs?: ZoneConfigurationRow[],
): AvailableByZoneAtDateResult {
  const harvestCaps = computeZoneCapacityMap(rows);
  const configCaps =
    zoneConfigs && zoneConfigs.length > 0
      ? buildZoneConfigurationCapacityMapAtDate(zoneConfigs, forecastDate)
      : new Map<string, number>();
  const maxByZone = mergeZoneCapacityMaps(harvestCaps, configCaps);

  const groups = new Map<string, ForecastHarvestRow[]>();
  for (const h of rows) {
    const regrowDate = getRegrowthDateFromHarvest(h, regrowthConfig);
    if (!regrowDate || regrowDate > forecastDate) continue;
    const gk = `${h.farmId}|${h.productId}`;
    const arr = groups.get(gk) ?? [];
    arr.push(h);
    groups.set(gk, arr);
  }

  const availableByZone = new Map<string, number>();
  const overlimitByFarmProduct = new Map<string, number>();
  let overlimitKg = 0;

  for (const [gk, frags] of groups) {
    const [farmIdStr, productIdStr] = gk.split("|");
    const farmId = Number(farmIdStr);
    const productId = Number(productIdStr);
    if (!Number.isFinite(farmId) || !Number.isFinite(productId)) continue;

    const hasConfiguredZones =
      sumConfiguredZoneCapKgForFarmProduct(maxByZone, farmId, productId) > 0;

    const alloc = computeRegrowthAllocationForFarmProductDate({
      farmId,
      productId,
      maxByZone,
      fragments: frags.map((f) => ({
        zoneKey: forecastZoneKeyFromRow(f),
        zoneLabel: String(f.zone ?? "").trim() || FORECAST_NOZONE_ZONE,
        qty: rowInventoryKg(f),
        inventoryKgFromNozoneSpread: f.inventoryKgFromNozoneSpread,
      })),
    });

    if (hasConfiguredZones) {
      for (const z of alloc.zoneBreakdowns) {
        if (z.creditedTotalKg <= 0) continue;
        availableByZone.set(
          z.zoneKey,
          (availableByZone.get(z.zoneKey) ?? 0) + z.creditedTotalKg,
        );
      }
      if (alloc.overflowUncreditedKg > 0) {
        overlimitKg += alloc.overflowUncreditedKg;
        overlimitByFarmProduct.set(gk, alloc.overflowUncreditedKg);
      }
    } else if (alloc.totalGrossKg > 0) {
      const nozoneKey = forecastZoneKeyFromParts(farmId, FORECAST_NOZONE_ZONE, productId);
      availableByZone.set(
        nozoneKey,
        (availableByZone.get(nozoneKey) ?? 0) + alloc.totalGrossKg,
      );
    }
  }

  return { availableByZone, overlimitKg, overlimitByFarmProduct };
}

/** Backward-compatible wrapper: available kg per zone key only. */
export function computeCappedAvailableByZoneAtDate(
  rows: ForecastHarvestRow[],
  regrowthConfig: RegrowthReferenceConfig,
  forecastDate: Date,
  zoneConfigs?: ZoneConfigurationRow[],
): Map<string, number> {
  return computeAllocatedAvailableByZoneAtDate(
    rows,
    regrowthConfig,
    forecastDate,
    zoneConfigs,
  ).availableByZone;
}
