import type { ZoneConfigurationRow } from "@/features/admin/api/adminApi";
import type { ForecastHarvestRow } from "@/features/forecasting/forecastingTypes";
import type { RegrowthReferenceConfig } from "@/features/forecasting/forecastingRegrowth";
import {
  forecastHarvestRowEffectiveM2,
  forecastHarvestRowInventoryKg,
  forecastZoneBucketKey,
  isForecastExcludedZone,
  kgPerM2ByNormalizedZoneForFarmProduct,
} from "@/features/forecasting/forecastingInventoryConversion";
import {
  forecastZoneKeyFromRow,
  getRegrowthDateFromHarvest,
  mergeZoneCapacityMapsAtDate,
} from "@/features/forecasting/inventoryRegrowthCalculator";
import { computeRegrowthAllocationForFarmProductDate } from "@/features/forecasting/regrowthAllocation";

export type ZoneBalanceM2Hint = {
  m2: number;
  kgPerM2: number;
  kg: number;
};

export type ZoneBalanceHarvestEvent = {
  rowId: string;
  harvestDateYmd: string;
  kg: number;
  label: string;
  m2Hint: ZoneBalanceM2Hint | null;
};

export type ZoneBalanceRegrowthEvent = {
  rowId: string;
  sourceHarvestDateYmd: string;
  regrowthDateYmd: string;
  creditedKg: number;
  label: string;
  m2Hint: ZoneBalanceM2Hint | null;
};

function parseYmdLocal(ymd: string): Date | null {
  const m = String(ymd).trim().slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function ymdFromDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function eventLabel(row: ForecastHarvestRow): string {
  const customer = String(row.customer ?? "").trim();
  const project = String(row.project ?? "").trim();
  if (customer && project) return `${customer} · ${project}`;
  return customer || project || String(row.id ?? "").trim();
}

function buildM2Hint(
  row: ForecastHarvestRow,
  zoneConfigs: ZoneConfigurationRow[],
): ZoneBalanceM2Hint | null {
  const m2 = forecastHarvestRowEffectiveM2(row);
  const kg = forecastHarvestRowInventoryKg(row);
  if (m2 <= 0 || kg <= 0) return null;

  const kgPerM2Map = kgPerM2ByNormalizedZoneForFarmProduct(
    zoneConfigs,
    row.farmId,
    row.productId,
  );
  const zoneBucketKey = forecastZoneBucketKey(
    String(row.zone ?? "")
      .trim()
      .toLowerCase()
      .replace(/_/g, "-")
      .replace(/\s+/g, " "),
  );
  const kgPerM2 =
    kgPerM2Map[zoneBucketKey] ??
    (m2 > 0 && kg > 0 ? kg / m2 : 0);
  if (kgPerM2 <= 0) return null;

  return {
    m2,
    kgPerM2,
    kg: Math.round(m2 * kgPerM2),
  };
}

export function buildHarvestEventsForZoneOnDate(params: {
  forecastRows: ForecastHarvestRow[];
  zoneKey: string;
  dateYmd: string;
  zoneConfigs: ZoneConfigurationRow[];
}): ZoneBalanceHarvestEvent[] {
  const onDate = parseYmdLocal(params.dateYmd);
  if (!onDate) return [];

  const events: ZoneBalanceHarvestEvent[] = [];
  for (const row of params.forecastRows) {
    if (isForecastExcludedZone(row.zone)) continue;
    if (forecastZoneKeyFromRow(row) !== params.zoneKey) continue;
    const harvestDateYmd = String(row.harvestDate ?? "").trim().slice(0, 10);
    const harvestDate = parseYmdLocal(harvestDateYmd);
    if (!harvestDate || !isSameLocalDay(harvestDate, onDate)) continue;
    const kg = Math.round(Math.max(0, forecastHarvestRowInventoryKg(row)));
    if (kg <= 0) continue;
    events.push({
      rowId: String(row.id),
      harvestDateYmd,
      kg,
      label: eventLabel(row),
      m2Hint: buildM2Hint(row, params.zoneConfigs),
    });
  }
  return events.sort((a, b) => a.label.localeCompare(b.label));
}

export function buildRegrowthEventsForZoneOnDate(params: {
  forecastRows: ForecastHarvestRow[];
  zoneKey: string;
  dateYmd: string;
  regrowthConfig: RegrowthReferenceConfig;
  zoneConfigs: ZoneConfigurationRow[];
}): ZoneBalanceRegrowthEvent[] {
  const onDate = parseYmdLocal(params.dateYmd);
  if (!onDate) return [];

  const maxByZone = mergeZoneCapacityMapsAtDate(
    params.forecastRows,
    params.zoneConfigs,
    onDate,
  );

  const groups = new Map<string, ForecastHarvestRow[]>();
  for (const row of params.forecastRows) {
    if (isForecastExcludedZone(row.zone)) continue;
    const regrowthDate = getRegrowthDateFromHarvest(row, params.regrowthConfig);
    if (!regrowthDate || !isSameLocalDay(regrowthDate, onDate)) continue;
    const gk = `${row.farmId}|${row.productId}`;
    const list = groups.get(gk) ?? [];
    list.push(row);
    groups.set(gk, list);
  }

  const events: ZoneBalanceRegrowthEvent[] = [];
  for (const frags of groups.values()) {
    if (frags.length === 0) continue;
    const farmId = frags[0].farmId;
    const productId = frags[0].productId;

    const alloc = computeRegrowthAllocationForFarmProductDate({
      farmId,
      productId,
      maxByZone,
      fragments: frags.map((f) => ({
        zoneKey: forecastZoneKeyFromRow(f),
        zoneLabel: String(f.zone ?? "").trim(),
        qty: forecastHarvestRowInventoryKg(f),
        inventoryKgFromNozoneSpread: f.inventoryKgFromNozoneSpread,
      })),
    });

    const zoneBreakdown = alloc.zoneBreakdowns.find((z) => z.zoneKey === params.zoneKey);
    const zoneCredit = zoneBreakdown?.creditedTotalKg ?? 0;
    if (zoneCredit <= 0) continue;

    const totalQty = frags.reduce(
      (sum, f) => sum + Math.max(0, forecastHarvestRowInventoryKg(f)),
      0,
    );
    if (totalQty <= 0) continue;

    let allocated = 0;
    frags.forEach((row, index) => {
      const qty = Math.max(0, forecastHarvestRowInventoryKg(row));
      const creditedKg =
        index === frags.length - 1
          ? Math.max(0, Math.round(zoneCredit - allocated))
          : Math.round(zoneCredit * (qty / totalQty));
      allocated += creditedKg;
      if (creditedKg <= 0) return;

      events.push({
        rowId: String(row.id),
        sourceHarvestDateYmd: String(row.harvestDate ?? "").trim().slice(0, 10),
        regrowthDateYmd: params.dateYmd,
        creditedKg,
        label: eventLabel(row),
        m2Hint: buildM2Hint(row, params.zoneConfigs),
      });
    });
  }

  return events.sort(
    (a, b) =>
      a.sourceHarvestDateYmd.localeCompare(b.sourceHarvestDateYmd) ||
      a.label.localeCompare(b.label),
  );
}

export function buildZoneBalanceDayEvents(params: {
  forecastRows: ForecastHarvestRow[];
  zoneKey: string;
  dateYmd: string;
  regrowthConfig: RegrowthReferenceConfig;
  zoneConfigs: ZoneConfigurationRow[];
}): {
  harvestEvents: ZoneBalanceHarvestEvent[];
  regrowthEvents: ZoneBalanceRegrowthEvent[];
} {
  return {
    harvestEvents: buildHarvestEventsForZoneOnDate(params),
    regrowthEvents: buildRegrowthEventsForZoneOnDate(params),
  };
}