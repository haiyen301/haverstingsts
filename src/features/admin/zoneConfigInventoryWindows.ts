import type { ZoneConfigurationRow } from "@/features/admin/api/adminApi";
import type { ForecastHarvestRow } from "@/features/forecasting/forecastingTypes";
import type { RegrowthReferenceConfig } from "@/features/forecasting/forecastingRegrowth";
import {
  forecastZoneKeyFromParts,
  mergeZoneCapacityMapsAtDate,
  ymdFromDateLocal,
} from "@/features/forecasting/inventoryRegrowthCalculator";

export type ZoneInventoryWindowStatus = "full" | "limited";

export type ZoneInventoryWindow = {
  zoneKey: string;
  zone: string;
  farmId: number;
  grassId: number;
  status: ZoneInventoryWindowStatus;
  fromYmd: string;
  toYmd: string | null;
  availableKg: number;
  maxKg: number;
};

export type ComputeZoneInventoryWindowsParams = {
  zoneConfigs: ZoneConfigurationRow[];
  forecastRows: ForecastHarvestRow[];
  regrowthConfig: RegrowthReferenceConfig;
  farmFilter?: string;
  grassFilter?: string;
  fromYmd?: string;
  toYmd?: string;
};

const DEFAULT_HORIZON_MONTHS = 12;

function parseYmdLocal(ymd: string): Date | null {
  const m = ymd.trim().slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function todayYmdLocal(): string {
  return ymdFromDateLocal(new Date());
}

function defaultScanEndYmd(fromYmd: string): string {
  const start = parseYmdLocal(fromYmd) ?? new Date();
  return ymdFromDateLocal(addMonths(start, DEFAULT_HORIZON_MONTHS));
}

function normalizeZoneLabel(zone: string): string {
  return String(zone ?? "").trim();
}

function zoneKeysForFarmProduct(
  zoneConfigs: ZoneConfigurationRow[],
  farmId: number,
  grassId: number,
): Array<{ zoneKey: string; zone: string }> {
  const seen = new Set<string>();
  const out: Array<{ zoneKey: string; zone: string }> = [];
  for (const row of zoneConfigs) {
    if (Number(row.farm_id) !== farmId || Number(row.grass_id) !== grassId) continue;
    const zone = normalizeZoneLabel(String(row.zone ?? ""));
    const zoneKey = forecastZoneKeyFromParts(farmId, zone, grassId);
    if (seen.has(zoneKey)) continue;
    const low = zone.toLowerCase().replace(/_/g, "-").replace(/\s+/g, " ");
    if (!zone || low === "nozone" || low === "no-zone" || low === "no zone") continue;
    seen.add(zoneKey);
    out.push({ zoneKey, zone });
  }
  return out;
}

type DailyStatus = {
  ymd: string;
  status: ZoneInventoryWindowStatus;
  availableKg: number;
  maxKg: number;
};

function statusForAvailableMax(availableKg: number, maxKg: number): ZoneInventoryWindowStatus | null {
  if (maxKg <= 0) return null;
  return availableKg >= maxKg ? "full" : "limited";
}

function scanDailyStatusForZoneKey(_params: {
  forecastRows: ForecastHarvestRow[];
  zoneConfigs: ZoneConfigurationRow[];
  regrowthConfig: RegrowthReferenceConfig;
  zoneKey: string;
  fromYmd: string;
  toYmd: string;
}): DailyStatus[] {
  // Client simulate removed — wire to GET /api/forecast/snapshots when this admin view ships.
  return [];
}

function scanDailyAggregateStatusForFarmProduct(_params: {
  forecastRows: ForecastHarvestRow[];
  zoneConfigs: ZoneConfigurationRow[];
  regrowthConfig: RegrowthReferenceConfig;
  farmId: number;
  grassId: number;
  fromYmd: string;
  toYmd: string;
}): DailyStatus[] {
  return [];
}

function mergeDailyStatusIntoWindows(
  days: DailyStatus[],
  meta: { zoneKey: string; zone: string; farmId: number; grassId: number },
): ZoneInventoryWindow[] {
  if (days.length === 0) return [];

  const windows: ZoneInventoryWindow[] = [];
  let cur = days[0]!;
  let curFrom = cur.ymd;
  let curTo: string | null = cur.ymd;

  for (let i = 1; i < days.length; i++) {
    const day = days[i]!;
    if (day.status === cur.status) {
      curTo = day.ymd;
      cur = { ...cur, availableKg: day.availableKg, maxKg: day.maxKg };
      continue;
    }
    windows.push({
      zoneKey: meta.zoneKey,
      zone: meta.zone,
      farmId: meta.farmId,
      grassId: meta.grassId,
      status: cur.status,
      fromYmd: curFrom,
      toYmd: curTo,
      availableKg: cur.availableKg,
      maxKg: cur.maxKg,
    });
    cur = day;
    curFrom = day.ymd;
    curTo = day.ymd;
  }

  windows.push({
    zoneKey: meta.zoneKey,
    zone: meta.zone,
    farmId: meta.farmId,
    grassId: meta.grassId,
    status: cur.status,
    fromYmd: curFrom,
    toYmd: curTo,
    availableKg: cur.availableKg,
    maxKg: cur.maxKg,
  });

  return windows;
}

function filterZoneConfigs(
  zoneConfigs: ZoneConfigurationRow[],
  farmFilter?: string,
  grassFilter?: string,
): ZoneConfigurationRow[] {
  let next = zoneConfigs;
  if (farmFilter) {
    next = next.filter((row) => String(row.farm_id) === farmFilter);
  }
  if (grassFilter) {
    next = next.filter((row) => String(row.grass_id) === grassFilter);
  }
  return next;
}

function filterForecastRows(
  forecastRows: ForecastHarvestRow[],
  farmFilter?: string,
  grassFilter?: string,
): ForecastHarvestRow[] {
  let next = forecastRows;
  if (farmFilter) {
    next = next.filter((row) => String(row.farmId) === farmFilter);
  }
  if (grassFilter) {
    next = next.filter((row) => String(row.productId) === grassFilter);
  }
  return next;
}

/** Per-zone full / limited windows — requires DB snapshots (client simulate removed). */
export function computeZoneInventoryWindows(
  params: ComputeZoneInventoryWindowsParams,
): ZoneInventoryWindow[] {
  const {
    zoneConfigs,
    forecastRows,
    regrowthConfig,
    farmFilter,
    grassFilter,
    fromYmd = todayYmdLocal(),
    toYmd = defaultScanEndYmd(fromYmd),
  } = params;

  const configs = filterZoneConfigs(zoneConfigs, farmFilter, grassFilter);
  const rows = filterForecastRows(forecastRows, farmFilter, grassFilter);
  const seen = new Set<string>();
  const windows: ZoneInventoryWindow[] = [];

  for (const row of configs) {
    const farmId = Number(row.farm_id);
    const grassId = Number(row.grass_id);
    const zone = normalizeZoneLabel(String(row.zone ?? ""));
    const zoneKey = forecastZoneKeyFromParts(farmId, zone, grassId);
    if (seen.has(zoneKey)) continue;
    seen.add(zoneKey);

    const days = scanDailyStatusForZoneKey({
      forecastRows: rows,
      zoneConfigs: zoneConfigs,
      regrowthConfig,
      zoneKey,
      fromYmd,
      toYmd,
    });
    windows.push(
      ...mergeDailyStatusIntoWindows(days, { zoneKey, zone, farmId, grassId }),
    );
  }

  return windows.sort((a, b) => {
    const zoneCmp = a.zone.localeCompare(b.zone);
    if (zoneCmp !== 0) return zoneCmp;
    const statusCmp = a.status.localeCompare(b.status);
    if (statusCmp !== 0) return statusCmp;
    return a.fromYmd.localeCompare(b.fromYmd);
  });
}

/** Aggregate farm + grass windows (sum of zones, excl. no-zone). */
export function computeAggregateInventoryWindowsForFarmProduct(params: {
  zoneConfigs: ZoneConfigurationRow[];
  forecastRows: ForecastHarvestRow[];
  regrowthConfig: RegrowthReferenceConfig;
  farmId: number;
  productId: number;
  fromYmd: string;
  toYmd?: string;
}): ZoneInventoryWindow[] {
  const {
    zoneConfigs,
    forecastRows,
    regrowthConfig,
    farmId,
    productId,
    fromYmd,
    toYmd = defaultScanEndYmd(fromYmd),
  } = params;

  const rows = forecastRows.filter(
    (r) => r.farmId === farmId && r.productId === productId,
  );

  const days = scanDailyAggregateStatusForFarmProduct({
    forecastRows: rows,
    zoneConfigs,
    regrowthConfig,
    farmId,
    grassId: productId,
    fromYmd,
    toYmd,
  });

  return mergeDailyStatusIntoWindows(days, {
    zoneKey: `${farmId}|*|${productId}`,
    zone: "",
    farmId,
    grassId: productId,
  });
}

/** Calendar marker: limited if any zone is below max; else full when at least one zone applies. */
export function inventoryStatusOnYmd(
  windows: ZoneInventoryWindow[],
  ymd: string,
): ZoneInventoryWindowStatus | null {
  const covering = windows.filter(
    (w) => w.fromYmd <= ymd && (!w.toYmd || w.toYmd >= ymd),
  );
  if (covering.length === 0) return null;
  if (covering.some((w) => w.status === "limited")) return "limited";
  return "full";
}

export function zoneInventoryWindowsForRow(
  windows: ZoneInventoryWindow[],
  row: ZoneConfigurationRow,
  fromYmd: string,
): ZoneInventoryWindow[] {
  const farmId = Number(row.farm_id);
  const grassId = Number(row.grass_id);
  const zone = normalizeZoneLabel(String(row.zone ?? ""));
  const zoneKey = forecastZoneKeyFromParts(farmId, zone, grassId);
  return windows.filter(
    (w) =>
      w.zoneKey === zoneKey &&
      (w.toYmd ?? "9999-12-31") >= fromYmd,
  );
}
