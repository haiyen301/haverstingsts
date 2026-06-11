import type { ZoneConfigurationRow } from "@/features/admin/api/adminApi";
import type { ForecastHarvestRow } from "@/features/forecasting/forecastingTypes";
import {
  forecastHarvestRowInventoryKg,
  isForecastExcludedZone,
} from "@/features/forecasting/forecastingInventoryConversion";
import type { RegrowthReferenceConfig } from "@/features/forecasting/forecastingRegrowth";
import {
  buildZoneConfigurationCapacityMapAtDate,
  forecastZoneKeyFromRow,
  getRegrowthDateFromHarvest,
} from "@/features/forecasting/inventoryRegrowthCalculator";
import { computeRegrowthAllocationForFarmProductDate } from "@/features/forecasting/regrowthAllocation";

export type OverlimitSourceRow = {
  rowId: string;
  projectLabel: string;
  zoneLabel: string;
  harvestDateYmd: string;
  regrowthDateYmd: string;
  kg: number;
  fromNozoneSpreadKg: number;
};

export type OverlimitZoneLine = {
  zoneKey: string;
  zoneLabel: string;
  capKg: number;
  grossKg: number;
  creditedKg: number;
  overflowKg: number;
  nozoneFillKg: number;
};

export type InventoryOverlimitBreakdown = {
  farmProductKey: string;
  farmId: number;
  grassId: number;
  farmName: string;
  turfgrass: string;
  asOfYmd: string;
  farmProductCapKg: number;
  totalGrossKg: number;
  totalCreditedKg: number;
  overlimitKg: number;
  nozoneInputKg: number;
  otherOverflowKg: number;
  zoneLines: OverlimitZoneLine[];
  sourceRows: OverlimitSourceRow[];
};

function ymdFromDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeLocalDayMs(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function rowInventoryKg(row: ForecastHarvestRow): number {
  return Math.max(0, forecastHarvestRowInventoryKg(row));
}

/** Regrowth fragments included in today's inventory overlimit allocation (`on-or-before`). */
export function buildInventoryOverlimitBreakdown(params: {
  farmId: number;
  grassId: number;
  farmName: string;
  turfgrass: string;
  asOf: Date;
  forecastRows: ForecastHarvestRow[];
  zoneConfigurations: ZoneConfigurationRow[];
  regrowthConfig: RegrowthReferenceConfig;
}): InventoryOverlimitBreakdown | null {
  const { farmId, grassId, farmName, turfgrass, asOf, forecastRows, zoneConfigurations, regrowthConfig } =
    params;
  const asOfMs = normalizeLocalDayMs(asOf);
  const asOfYmd = ymdFromDate(asOf);

  const fragments: ForecastHarvestRow[] = [];
  for (const row of forecastRows) {
    if (row.farmId !== farmId || row.productId !== grassId) continue;
    if (isForecastExcludedZone(row.zone)) continue;
    const regrowDate = getRegrowthDateFromHarvest(row, regrowthConfig);
    if (!regrowDate) continue;
    if (normalizeLocalDayMs(regrowDate) > asOfMs) continue;
    fragments.push(row);
  }

  if (fragments.length === 0) return null;

  const maxByZone = buildZoneConfigurationCapacityMapAtDate(zoneConfigurations, asOf);
  const alloc = computeRegrowthAllocationForFarmProductDate({
    farmId,
    productId: grassId,
    maxByZone,
    fragments: fragments.map((row) => ({
      zoneKey: forecastZoneKeyFromRow(row),
      zoneLabel: String(row.zone ?? "").trim(),
      qty: rowInventoryKg(row),
      inventoryKgFromNozoneSpread: row.inventoryKgFromNozoneSpread,
    })),
  });

  const overlimitKg = Math.round(alloc.overflowUncreditedKg);
  if (overlimitKg <= 0) return null;

  const zoneLines: OverlimitZoneLine[] = alloc.zoneBreakdowns.map((z) => ({
    zoneKey: z.zoneKey,
    zoneLabel: z.zoneLabel,
    capKg: Math.round(z.capKg),
    grossKg: Math.round(z.totalIntoZoneKg),
    creditedKg: Math.round(z.creditedTotalKg),
    overflowKg: Math.round(z.zoneOverflowKg),
    nozoneFillKg: Math.round(z.nozoneFillKg),
  }));

  const sumZoneOverflow = zoneLines.reduce((s, z) => s + z.overflowKg, 0);
  const otherOverflowKg = Math.max(0, Math.round(alloc.overflowUncreditedKg - sumZoneOverflow));

  const sourceRows: OverlimitSourceRow[] = fragments
    .map((row) => {
      const regrowDate = getRegrowthDateFromHarvest(row, regrowthConfig);
      const spread = Number.isFinite(row.inventoryKgFromNozoneSpread)
        ? Math.max(0, Number(row.inventoryKgFromNozoneSpread))
        : 0;
      return {
        rowId: row.id,
        projectLabel: String(row.project ?? row.customer ?? "").trim() || "—",
        zoneLabel: String(row.zone ?? "").trim() || "—",
        harvestDateYmd: String(row.harvestDate ?? "").trim().slice(0, 10),
        regrowthDateYmd: regrowDate ? ymdFromDate(regrowDate) : "",
        kg: Math.round(rowInventoryKg(row)),
        fromNozoneSpreadKg: Math.round(Math.min(spread, rowInventoryKg(row))),
      };
    })
    .sort(
      (a, b) =>
        a.regrowthDateYmd.localeCompare(b.regrowthDateYmd) ||
        a.harvestDateYmd.localeCompare(b.harvestDateYmd) ||
        a.projectLabel.localeCompare(b.projectLabel),
    );

  return {
    farmProductKey: `${farmId}|${grassId}`,
    farmId,
    grassId,
    farmName,
    turfgrass,
    asOfYmd,
    farmProductCapKg: Math.round(alloc.farmProductCapKg),
    totalGrossKg: Math.round(alloc.totalGrossKg),
    totalCreditedKg: Math.round(alloc.totalCreditedMappedKg),
    overlimitKg,
    nozoneInputKg: Math.round(alloc.nozoneInputKg),
    otherOverflowKg,
    zoneLines,
    sourceRows,
  };
}
