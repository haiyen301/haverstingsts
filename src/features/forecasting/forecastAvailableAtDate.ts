import type { ZoneConfigurationRow } from "@/features/admin/api/adminApi";
import type { ForecastHarvestRow } from "@/features/forecasting/forecastingTypes";
import {
  computeRegrowthDaysForHarvest,
  type RegrowthReferenceConfig,
} from "@/features/forecasting/forecastingRegrowth";
import {
  applyLatestZoneMaxKgToForecastRows,
  forecastHarvestRowInventoryKg,
  isForecastExcludedZone,
  isMappedForecastZoneKey,
} from "@/features/forecasting/forecastingInventoryConversion";
import {
  applyInventoryAvailableOverrideToZone,
  pickInventoryOverrideForAsOf,
} from "@/features/forecasting/inventoryAvailableOverrides";
import type { InventoryAvailableOverrideEntry } from "@/shared/store/inventoryAvailableOverrideStore";
import {
  buildZoneConfigurationCapacityMapAtDate,
  farmProductHasMappedZoneConfigAtYmd,
  forecastZoneKeyFromRow,
  getRegrowthDateFromHarvest,
  mergeZoneCapacityMapsAtDate,
  sumConfiguredZoneCapKgForFarmProduct,
  zoneConfigIsActiveAtYmd,
} from "@/features/forecasting/inventoryRegrowthCalculator";
import { computeRegrowthAllocationForFarmProductDate } from "@/features/forecasting/regrowthAllocation";

const DAY_MS = 1000 * 60 * 60 * 24;

function rowInventoryKg(row: ForecastHarvestRow): number {
  return forecastHarvestRowInventoryKg(row);
}

function normalizeLocalDayMs(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function parseHarvestDateFromRow(row: ForecastHarvestRow): Date | null {
  const ymd = String(row.harvestDate ?? "").trim().slice(0, 10);
  const match = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return normalizeLocalDayMs(a) === normalizeLocalDayMs(b);
}

function ymdFromDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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

function farmProductCapAtDate(
  allRows: ForecastHarvestRow[],
  groupKey: string,
  asOf: Date,
  zoneConfigs: ZoneConfigurationRow[] | undefined,
): number {
  if (groupKey === "__unassigned__") return 0;
  const [farmIdStr, productIdStr] = groupKey.split("|");
  const farmId = Number(farmIdStr);
  const productId = Number(productIdStr);
  if (!Number.isFinite(farmId) || !Number.isFinite(productId)) return 0;
  const maxByZone = mergeZoneCapacityMapsAtDate(allRows, zoneConfigs ?? [], asOf);
  return sumConfiguredZoneCapKgForFarmProduct(maxByZone, farmId, productId);
}

/**
 * Opening balance at calendar start: assume zones start full (cap), pre-roll harvest/regrowth
 * from plans before `startDate`, then cap.
 */
function computeGroupOpeningAvailableKg(
  allRows: ForecastHarvestRow[],
  groupKey: string,
  groupRows: ForecastHarvestRow[],
  startDate: Date,
  regrowthConfig: RegrowthReferenceConfig,
  zoneConfigs: ZoneConfigurationRow[] | undefined,
): number {
  const cap = farmProductCapAtDate(allRows, groupKey, startDate, zoneConfigs);
  const baseline = cap > 0 ? cap : 0;

  const dayBeforeStart = addDays(startDate, -1);
  const simStart = addMonths(startDate, -24);
  if (dayBeforeStart.getTime() < simStart.getTime()) {
    return baseline;
  }

  const preSeries = computeRollingDailyAvailableSeries(
    groupRows,
    regrowthConfig,
    simStart,
    dayBeforeStart,
    zoneConfigs,
    baseline,
  );
  const lastDay = preSeries[preSeries.length - 1];
  const raw = lastDay?.availableKg ?? baseline;
  return cap > 0 ? Math.min(Math.max(0, raw), cap) : Math.max(0, raw);
}

function diffDaysInclusive(start: Date, end: Date): number {
  const startMs = normalizeLocalDayMs(start);
  const endMs = normalizeLocalDayMs(end);
  return Math.max(1, Math.floor((endMs - startMs) / DAY_MS) + 1);
}

function sumAvailableByZone(availableByZone: Map<string, number>): number {
  return Array.from(availableByZone.values()).reduce((sum, kg) => sum + kg, 0);
}

function harvestKgOnDate(rows: ForecastHarvestRow[], onDate: Date): number {
  let sum = 0;
  for (const row of rows) {
    const harvestDate = parseHarvestDateFromRow(row);
    if (!harvestDate || !isSameLocalDay(harvestDate, onDate)) continue;
    sum += Math.max(0, rowInventoryKg(row));
  }
  return sum;
}

function harvestKgByZoneOnDate(rows: ForecastHarvestRow[], onDate: Date): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    if (isForecastExcludedZone(row.zone)) continue;
    const harvestDate = parseHarvestDateFromRow(row);
    if (!harvestDate || !isSameLocalDay(harvestDate, onDate)) continue;
    const zoneKey = forecastZoneKeyFromRow(row);
    if (!isMappedForecastZoneKey(zoneKey)) continue;
    out.set(zoneKey, (out.get(zoneKey) ?? 0) + Math.max(0, rowInventoryKg(row)));
  }
  return out;
}

function parseYmdLocal(ymd: string): Date | null {
  const m = String(ymd).trim().slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const parsed = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function farmProductFromZoneKey(
  zoneKey: string,
): { farmId: number; productId: number } | null {
  const parts = zoneKey.split("|");
  if (parts.length !== 3) return null;
  const farmId = Number(parts[0]);
  const productId = Number(parts[2]);
  if (!Number.isFinite(farmId) || !Number.isFinite(productId) || farmId <= 0 || productId <= 0) {
    return null;
  }
  return { farmId, productId };
}

function collectActiveZoneKeysForDay(
  maxByZone: Map<string, number>,
  overridesByZone: Record<string, InventoryAvailableOverrideEntry>,
  farmProductFilter?: (farmId: number, productId: number) => boolean,
): string[] {
  const keys = new Set<string>();
  for (const key of maxByZone.keys()) {
    if (!isMappedForecastZoneKey(key)) continue;
    const fp = farmProductFromZoneKey(key);
    if (fp && farmProductFilter && !farmProductFilter(fp.farmId, fp.productId)) continue;
    keys.add(key);
  }
  for (const entry of Object.values(overridesByZone)) {
    if (farmProductFilter && !farmProductFilter(entry.farmId, entry.grassId)) continue;
    if (entry.zoneKey && isMappedForecastZoneKey(entry.zoneKey)) keys.add(entry.zoneKey);
  }
  return Array.from(keys);
}

/** Manual balance for one zone saved exactly on `asOf` (not before/after). */
function manualOverrideForZoneOnExactDate(
  overridesByZone: Record<string, InventoryAvailableOverrideEntry>,
  zoneKey: string,
  asOf: Date,
): InventoryAvailableOverrideEntry | null {
  const asOfYmd = ymdFromDate(asOf);
  for (const entry of Object.values(overridesByZone)) {
    if (entry.zoneKey !== zoneKey) continue;
    const d = String(entry.date ?? "").trim().slice(0, 10);
    if (d !== asOfYmd) continue;
    return entry;
  }
  return null;
}

function computeInventorySeriesLoopStart(
  startDate: Date,
  overridesByZone: Record<string, InventoryAvailableOverrideEntry>,
  farmProductFilter?: (farmId: number, productId: number) => boolean,
): Date {
  let earliest = startDate;
  for (const entry of Object.values(overridesByZone)) {
    if (farmProductFilter && !farmProductFilter(entry.farmId, entry.grassId)) continue;
    const d = parseYmdLocal(entry.date);
    if (d && d.getTime() < earliest.getTime()) earliest = d;
  }
  return earliest;
}

/** Roll inventory from zone-config max caps through history before the chart horizon (24 months). */
function computeInventorySeriesLoopStartWithHistory(
  startDate: Date,
  overridesByZone: Record<string, InventoryAvailableOverrideEntry>,
  farmProductFilter?: (farmId: number, productId: number) => boolean,
): Date {
  const fromOverrides = computeInventorySeriesLoopStart(
    startDate,
    overridesByZone,
    farmProductFilter,
  );
  const simStart = addMonths(startDate, -24);
  return fromOverrides.getTime() < simStart.getTime() ? fromOverrides : simStart;
}

type RegrowthAllocationMode = "on-or-before" | "on-exact";

function allocateRegrowthCreditsAtDate(
  rows: ForecastHarvestRow[],
  regrowthConfig: RegrowthReferenceConfig,
  onDate: Date,
  zoneConfigs: ZoneConfigurationRow[] | undefined,
  mode: RegrowthAllocationMode,
): AvailableByZoneAtDateResult {
  const maxByZone =
    zoneConfigs && zoneConfigs.length > 0
      ? buildZoneConfigurationCapacityMapAtDate(zoneConfigs, onDate)
      : new Map<string, number>();

  const groups = new Map<string, ForecastHarvestRow[]>();
  for (const h of rows) {
    const regrowDate = getRegrowthDateFromHarvest(h, regrowthConfig);
    if (!regrowDate) continue;
    const include =
      mode === "on-exact"
        ? isSameLocalDay(regrowDate, onDate)
        : normalizeLocalDayMs(regrowDate) <= normalizeLocalDayMs(onDate);
    if (!include) continue;
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
      fragments: frags
        .filter((f) => !isForecastExcludedZone(f.zone))
        .map((f) => ({
          zoneKey: forecastZoneKeyFromRow(f),
          zoneLabel: String(f.zone ?? "").trim(),
          qty: rowInventoryKg(f),
          inventoryKgFromNozoneSpread: f.inventoryKgFromNozoneSpread,
        })),
    });

    if (hasConfiguredZones) {
      for (const z of alloc.zoneBreakdowns) {
        if (z.creditedTotalKg <= 0) continue;
        if (!isMappedForecastZoneKey(z.zoneKey)) continue;
        availableByZone.set(
          z.zoneKey,
          (availableByZone.get(z.zoneKey) ?? 0) + z.creditedTotalKg,
        );
      }
      if (alloc.overflowUncreditedKg > 0) {
        overlimitKg += alloc.overflowUncreditedKg;
        overlimitByFarmProduct.set(gk, alloc.overflowUncreditedKg);
      }
    }
  }

  return { availableByZone, overlimitKg, overlimitByFarmProduct };
}

/**
 * Harvesting Portal `getAvailableQuantityAt` parity:
 * - before harvest: full plan kg
 * - on harvest day during regrowth: 0 kg (linear regrowth from harvest date)
 * - after regrowth: full plan kg again
 */
export function getAvailableQuantityAtForRow(
  row: ForecastHarvestRow,
  forecastDate: Date,
  regrowthConfig: RegrowthReferenceConfig,
): number {
  const qty = rowInventoryKg(row);
  const harvestDate = parseHarvestDateFromRow(row);
  if (!harvestDate) return qty;

  const forecastMs = normalizeLocalDayMs(forecastDate);
  const harvestMs = normalizeLocalDayMs(harvestDate);
  if (harvestMs > forecastMs) return qty;

  const regrowDays = computeRegrowthDaysForHarvest(regrowthConfig, row);
  if (!Number.isFinite(regrowDays) || regrowDays <= 0) return qty;

  const regrowMs = harvestMs + regrowDays * DAY_MS;
  if (regrowMs <= forecastMs) return qty;

  const elapsedDays = (forecastMs - harvestMs) / DAY_MS;
  const progress = Math.max(0, Math.min(elapsedDays / regrowDays, 1));
  return qty * progress;
}

export type AvailableByZoneAtDateResult = {
  availableByZone: Map<string, number>;
  /** kg exceeding configured zone caps (same as regrowth overflow). */
  overlimitKg: number;
  /** `{farmId}|{productId}` → overflow kg */
  overlimitByFarmProduct: Map<string, number>;
};

export type PortalStyleAvailableResult = AvailableByZoneAtDateResult & {
  /** Sum of per-row linear available before zone caps. */
  rawAvailableKg: number;
  /** Sum of plan inventory kg in scope. */
  totalQuantityKg: number;
  /** `totalQuantityKg - rawAvailableKg` (Harvesting Portal regrowing metric). */
  regrowingKg: number;
};

/**
 * Harvesting Portal aggregate (`ForecastingPage` forecastData):
 * sum `getAvailableQuantityAt` per plan row, cap once at total configured capacity.
 */
export function computePortalStyleAvailableByZoneAtDate(
  rows: ForecastHarvestRow[],
  regrowthConfig: RegrowthReferenceConfig,
  forecastDate: Date,
  zoneConfigs?: ZoneConfigurationRow[],
): PortalStyleAvailableResult {
  const maxByZone =
    zoneConfigs && zoneConfigs.length > 0
      ? buildZoneConfigurationCapacityMapAtDate(zoneConfigs, forecastDate)
      : new Map<string, number>();

  const availableByZone = new Map<string, number>();
  let totalQuantityKg = 0;
  let rawAvailableKg = 0;

  for (const row of rows) {
    const qty = rowInventoryKg(row);
    totalQuantityKg += qty;
    const available = getAvailableQuantityAtForRow(row, forecastDate, regrowthConfig);
    rawAvailableKg += available;
    const zoneKey = forecastZoneKeyFromRow(row);
    availableByZone.set(zoneKey, (availableByZone.get(zoneKey) ?? 0) + available);
  }

  const totalCapacity = Array.from(maxByZone.values()).reduce((sum, cap) => sum + cap, 0);
  const overlimitKg =
    totalCapacity > 0 ? Math.max(0, rawAvailableKg - totalCapacity) : 0;

  return {
    availableByZone,
    overlimitKg,
    overlimitByFarmProduct: new Map<string, number>(),
    rawAvailableKg,
    totalQuantityKg,
    regrowingKg: Math.max(0, totalQuantityKg - rawAvailableKg),
  };
}

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
  return allocateRegrowthCreditsAtDate(
    rows,
    regrowthConfig,
    forecastDate,
    zoneConfigs,
    "on-or-before",
  );
}

/** Full credited regrowth kg landing on `onDate` (no linear partial regrowth). */
export function computeRegrowthCreditedOnDate(
  rows: ForecastHarvestRow[],
  regrowthConfig: RegrowthReferenceConfig,
  onDate: Date,
  zoneConfigs?: ZoneConfigurationRow[],
): AvailableByZoneAtDateResult & { creditedKg: number } {
  const result = allocateRegrowthCreditsAtDate(
    rows,
    regrowthConfig,
    onDate,
    zoneConfigs,
    "on-exact",
  );
  return { ...result, creditedKg: sumAvailableByZone(result.availableByZone) };
}

export type RollingDailyAvailableDay = {
  date: string;
  previousAvailableKg: number;
  regrowthKg: number;
  harvestKg: number;
  /** `previousAvailableKg + regrowthKg` before today's harvest deduction. */
  beforeHarvestKg: number;
  /** After `min(raw, farm+grass zone cap)` when cap > 0. */
  availableKg: number;
  /** Rolling sum per farm+grass before the capacity cap. */
  rawAvailableKg: number;
  /** Σ configured zone max kg (excl. nozone) for each farm+grass group on this day. */
  capacityCapKg: number;
  overlimitKg: number;
};

function groupRowsByFarmProduct(rows: ForecastHarvestRow[]): Map<string, ForecastHarvestRow[]> {
  const groups = new Map<string, ForecastHarvestRow[]>();
  const unassigned: ForecastHarvestRow[] = [];
  for (const row of rows) {
    if (row.farmId <= 0 || row.productId <= 0) {
      unassigned.push(row);
      continue;
    }
    const key = `${row.farmId}|${row.productId}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  if (unassigned.length > 0) {
    groups.set("__unassigned__", unassigned);
  }
  return groups;
}

/** Σ zone-config capacity caps for each distinct farm+grass in `rows` (excl. nozone bucket). */
export function sumFarmProductCapacityCapsAtDate(
  rows: ForecastHarvestRow[],
  zoneConfigs: ZoneConfigurationRow[] | undefined,
  asOf: Date,
): number {
  const maxByZone = mergeZoneCapacityMapsAtDate(rows, zoneConfigs ?? [], asOf);
  let sum = 0;
  for (const key of groupRowsByFarmProduct(rows).keys()) {
    if (key === "__unassigned__") continue;
    const [farmIdStr, productIdStr] = key.split("|");
    const farmId = Number(farmIdStr);
    const productId = Number(productIdStr);
    if (!Number.isFinite(farmId) || !Number.isFinite(productId)) continue;
    sum += sumConfiguredZoneCapKgForFarmProduct(maxByZone, farmId, productId);
  }
  return sum;
}

function capRollingDayForFarmProductGroups(
  rows: ForecastHarvestRow[],
  groupSeries: Map<string, RollingDailyAvailableDay[]>,
  dayIndex: number,
  zoneConfigs: ZoneConfigurationRow[] | undefined,
): RollingDailyAvailableDay {
  const firstSeries = groupSeries.values().next().value;
  if (!firstSeries?.[dayIndex]) {
    return {
      date: "",
      previousAvailableKg: 0,
      regrowthKg: 0,
      harvestKg: 0,
      beforeHarvestKg: 0,
      availableKg: 0,
      rawAvailableKg: 0,
      capacityCapKg: 0,
      overlimitKg: 0,
    };
  }

  const template = firstSeries[dayIndex];
  const dateParts = template.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const dateObj = dateParts
    ? new Date(Number(dateParts[1]), Number(dateParts[2]) - 1, Number(dateParts[3]))
    : new Date();
  const maxByZone = mergeZoneCapacityMapsAtDate(rows, zoneConfigs ?? [], dateObj);

  let rawAvailableKg = 0;
  let availableKg = 0;
  let capacityCapKg = 0;
  let harvestKg = 0;
  let regrowthKg = 0;
  let overlimitKg = 0;
  let previousAvailableKg = 0;
  let beforeHarvestKg = 0;

  for (const [groupKey, series] of groupSeries) {
    const day = series[dayIndex];
    if (!day) continue;
    const raw = Math.max(0, day.availableKg);
    const cap =
      groupKey === "__unassigned__"
        ? 0
        : (() => {
            const [farmIdStr, productIdStr] = groupKey.split("|");
            return sumConfiguredZoneCapKgForFarmProduct(
              maxByZone,
              Number(farmIdStr),
              Number(productIdStr),
            );
          })();
    const capped = cap > 0 ? Math.min(raw, cap) : raw;

    rawAvailableKg += raw;
    availableKg += capped;
    capacityCapKg += cap;
    harvestKg += day.harvestKg;
    regrowthKg += day.regrowthKg;
    overlimitKg += day.overlimitKg + (cap > 0 ? Math.max(0, raw - capped) : 0);
    previousAvailableKg += day.previousAvailableKg;
    beforeHarvestKg += day.beforeHarvestKg;
  }

  return {
    date: template.date,
    previousAvailableKg,
    regrowthKg,
    harvestKg,
    beforeHarvestKg,
    rawAvailableKg,
    capacityCapKg,
    availableKg,
    overlimitKg,
  };
}

/**
 * Daily rolling available:
 * `today = max(0, yesterday + full regrowth credit on today − harvest on today)`.
 *
 * Regrowth is credited in full on the regrowth date only (not linearly between harvest and regrowth).
 */
export function computeRollingDailyAvailableSeries(
  rows: ForecastHarvestRow[],
  regrowthConfig: RegrowthReferenceConfig,
  startDate: Date,
  endDate: Date,
  zoneConfigs?: ZoneConfigurationRow[],
  initialAvailableKg = 0,
): RollingDailyAvailableDay[] {
  const start = new Date(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate(),
  );
  const end =
    endDate < start
      ? start
      : new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  const totalDays = diffDaysInclusive(start, end);
  const days: RollingDailyAvailableDay[] = [];
  let previousAvailableKg = Math.max(0, initialAvailableKg);

  for (let i = 0; i < totalDays; i++) {
    const date = addDays(start, i);
    const dateStr = ymdFromDate(date);
    const regrowth = computeRegrowthCreditedOnDate(
      rows,
      regrowthConfig,
      date,
      zoneConfigs,
    );
    const regrowthKg = regrowth.creditedKg;
    const harvestKg = harvestKgOnDate(rows, date);
    const beforeHarvestKg = previousAvailableKg + regrowthKg;
    const availableKg = Math.max(0, beforeHarvestKg - harvestKg);

    days.push({
      date: dateStr,
      previousAvailableKg,
      regrowthKg,
      harvestKg,
      beforeHarvestKg,
      rawAvailableKg: availableKg,
      capacityCapKg: 0,
      availableKg,
      overlimitKg: regrowth.overlimitKg,
    });

    previousAvailableKg = availableKg;
  }

  return days;
}

/**
 * Rolling available per farm+grass from plan harvest rows, then:
 * `displayed = min(rolling, Σ zone-config max)` for each farm+grass group (summed).
 */
export function computeCappedRollingDailyAvailableSeries(
  rows: ForecastHarvestRow[],
  regrowthConfig: RegrowthReferenceConfig,
  startDate: Date,
  endDate: Date,
  zoneConfigs?: ZoneConfigurationRow[],
): RollingDailyAvailableDay[] {
  const groups = groupRowsByFarmProduct(rows);
  if (groups.size === 0) {
    return computeRollingDailyAvailableSeries(
      rows,
      regrowthConfig,
      startDate,
      endDate,
      zoneConfigs,
      0,
    );
  }

  const groupSeries = new Map<string, RollingDailyAvailableDay[]>();
  for (const [key, groupRows] of groups) {
    const opening = computeGroupOpeningAvailableKg(
      rows,
      key,
      groupRows,
      startDate,
      regrowthConfig,
      zoneConfigs,
    );
    groupSeries.set(
      key,
      computeRollingDailyAvailableSeries(
        groupRows,
        regrowthConfig,
        startDate,
        endDate,
        zoneConfigs,
        opening,
      ),
    );
  }

  const firstSeries = groupSeries.values().next().value;
  if (!firstSeries?.length) return [];

  return firstSeries.map((_, dayIndex) =>
    capRollingDayForFarmProductGroups(rows, groupSeries, dayIndex, zoneConfigs),
  );
}

function sumZoneMapKgForFarmProduct(
  byZone: Map<string, number>,
  farmId: number,
  productId: number,
): number {
  const prefix = `${farmId}|`;
  const suffix = `|${productId}`;
  let sum = 0;
  for (const [key, kg] of byZone) {
    if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
    const zoneSeg = key.slice(prefix.length, key.length - suffix.length);
    if (isForecastExcludedZone(zoneSeg)) continue;
    if (!Number.isFinite(kg)) continue;
    sum += kg;
  }
  return sum;
}

function collectFarmProductKeysAtYmd(
  forecastRows: ForecastHarvestRow[],
  zoneConfigs: ZoneConfigurationRow[],
  ymd: string,
  farmProductFilter?: (farmId: number, productId: number) => boolean,
): Set<string> {
  const keys = new Set<string>();
  for (const row of zoneConfigs) {
    if (!zoneConfigIsActiveAtYmd(row, ymd)) continue;
    if (isForecastExcludedZone(row.zone)) continue;
    const farmId = Number(row.farm_id);
    const productId = Number(row.grass_id);
    if (!Number.isFinite(farmId) || !Number.isFinite(productId) || farmId <= 0 || productId <= 0) {
      continue;
    }
    if (farmProductFilter && !farmProductFilter(farmId, productId)) continue;
    keys.add(`${farmId}|${productId}`);
  }
  for (const row of forecastRows) {
    if (row.farmId <= 0 || row.productId <= 0) continue;
    if (isForecastExcludedZone(row.zone)) continue;
    if (farmProductFilter && !farmProductFilter(row.farmId, row.productId)) continue;
    if (!farmProductHasMappedZoneConfigAtYmd(zoneConfigs, row.farmId, row.productId, ymd)) {
      continue;
    }
    const zoneKey = forecastZoneKeyFromRow(row);
    if (!isMappedForecastZoneKey(zoneKey)) continue;
    keys.add(`${row.farmId}|${row.productId}`);
  }
  return keys;
}

/** Σ zone-config max kg for distinct farm+grass groups active on `asOf` (excl. nozone). */
export function sumFarmProductCapacityCapsFromZoneConfigAtDate(
  zoneConfigs: ZoneConfigurationRow[],
  asOf: Date,
  farmProductFilter?: (farmId: number, productId: number) => boolean,
): number {
  const ymd = ymdFromDate(asOf);
  const configCaps = buildZoneConfigurationCapacityMapAtDate(zoneConfigs, asOf);
  const keys = collectFarmProductKeysAtYmd([], zoneConfigs, ymd, farmProductFilter);
  let sum = 0;
  for (const key of keys) {
    const [farmIdStr, productIdStr] = key.split("|");
    sum += sumConfiguredZoneCapKgForFarmProduct(
      configCaps,
      Number(farmIdStr),
      Number(productIdStr),
    );
  }
  return sum;
}

export type DailySeriesResult = {
  aggregate: RollingDailyAvailableDay[];
  byFarmProduct: Map<string, Map<string, RollingDailyAvailableDay>>;
};

function farmProductKeyFromZoneKey(zoneKey: string): string | null {
  const parts = zoneKey.split("|");
  if (parts.length < 3) return null;
  const farmId = Number(parts[0]);
  const productId = Number(parts[2]);
  if (!Number.isFinite(farmId) || !Number.isFinite(productId) || farmId <= 0 || productId <= 0) {
    return null;
  }
  return `${farmId}|${productId}`;
}

/**
 * Per-zone rolling balance at `asOf` — same rules as Inventory Forecast daily series:
 * open at zone max cap, then `previous + regrowth − harvest`; manual balance on `balance_date`
 * replaces that zone for that day only.
 */
export function computeInventoryStyleAvailableByZoneAtDate(
  forecastRows: ForecastHarvestRow[],
  zoneConfigs: ZoneConfigurationRow[],
  regrowthConfig: RegrowthReferenceConfig,
  overridesByZone: Record<string, InventoryAvailableOverrideEntry>,
  asOf: Date,
  farmProductFilter?: (farmId: number, productId: number) => boolean,
): Map<string, number> {
  const asOfDay = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  const loopStart = computeInventorySeriesLoopStartWithHistory(
    asOfDay,
    overridesByZone,
    farmProductFilter,
  );
  const totalDays = diffDaysInclusive(loopStart, asOfDay);
  const zonePrev = new Map<string, number>();

  const rowsWithCapsByYmd = new Map<string, ForecastHarvestRow[]>();
  const maxByZoneCache = new Map<string, Map<string, number>>();
  const regrowthByZoneCache = new Map<string, Map<string, number>>();
  const harvestByZoneCache = new Map<string, Map<string, number>>();

  const rowsWithCapsFor = (ymd: string, date: Date): ForecastHarvestRow[] => {
    const cached = rowsWithCapsByYmd.get(ymd);
    if (cached) return cached;
    const next = applyLatestZoneMaxKgToForecastRows(forecastRows, zoneConfigs, ymd);
    rowsWithCapsByYmd.set(ymd, next);
    return next;
  };

  const maxByZoneFor = (ymd: string, date: Date): Map<string, number> => {
    const cached = maxByZoneCache.get(ymd);
    if (cached) return cached;
    const next = mergeZoneCapacityMapsAtDate(rowsWithCapsFor(ymd, date), zoneConfigs, date);
    maxByZoneCache.set(ymd, next);
    return next;
  };

  const regrowthFor = (ymd: string, date: Date): Map<string, number> => {
    const cached = regrowthByZoneCache.get(ymd);
    if (cached) return cached;
    const next = computeRegrowthCreditedOnDate(
      rowsWithCapsFor(ymd, date),
      regrowthConfig,
      date,
      zoneConfigs,
    ).availableByZone;
    regrowthByZoneCache.set(ymd, next);
    return next;
  };

  const harvestFor = (ymd: string, date: Date): Map<string, number> => {
    const cached = harvestByZoneCache.get(ymd);
    if (cached) return cached;
    const next = harvestKgByZoneOnDate(rowsWithCapsFor(ymd, date), date);
    harvestByZoneCache.set(ymd, next);
    return next;
  };

  for (let i = 0; i < totalDays; i++) {
    const date = addDays(loopStart, i);
    const dateStr = ymdFromDate(date);
    const maxByZone = maxByZoneFor(dateStr, date);
    const regrowthByZone = regrowthFor(dateStr, date);
    const harvestByZone = harvestFor(dateStr, date);
    const zoneKeys = collectActiveZoneKeysForDay(maxByZone, overridesByZone, farmProductFilter);

    for (const zoneKey of zoneKeys) {
      const maxKg = maxByZone.get(zoneKey) ?? 0;
      let prev = zonePrev.get(zoneKey);
      if (prev === undefined) {
        prev = maxKg > 0 ? maxKg : 0;
      }

      const dayRegrowth = regrowthByZone.get(zoneKey) ?? 0;
      const dayHarvest = harvestByZone.get(zoneKey) ?? 0;
      let rolling = Math.max(0, prev + dayRegrowth - dayHarvest);

      const exactOverride = manualOverrideForZoneOnExactDate(overridesByZone, zoneKey, date);
      if (exactOverride) {
        rolling = Math.max(0, Number(exactOverride.availableKg) || 0);
      }

      zonePrev.set(zoneKey, rolling);
    }
  }

  return zonePrev;
}

export type ZoneInventoryDaySnapshot = {
  previousKg: number;
  regrowthKg: number;
  harvestKg: number;
  /** Rolling after +/- before exact-day manual replace (only when manual saved today). */
  rollingBeforeManualSetKg: number | null;
  /** Rolling system balance (same basis as /inventory `calculatedKg`). */
  calculatedKg: number;
  /** Display balance after manual override (same as /inventory `currentKg`). */
  effectiveKg: number;
  maxKg: number;
  pct: number;
  isManualOverrideActive: boolean;
  manualOverrideDate: string | null;
  manualOverrideKg: number | null;
  exactManualSetToday: boolean;
  isOpeningDay: boolean;
};

/**
 * Per-zone balance for each day in `[startDate, endDate]` — same rules as `/inventory`:
 * open at zone max, then `previous + regrowth − harvest`; manual balance on `balance_date`
 * replaces display value; system subtitle uses rolling calculated kg.
 */
export function computeInventoryStyleZoneDailySnapshots(
  forecastRows: ForecastHarvestRow[],
  zoneConfigs: ZoneConfigurationRow[],
  regrowthConfig: RegrowthReferenceConfig,
  overridesByZone: Record<string, InventoryAvailableOverrideEntry>,
  startDate: Date,
  endDate: Date,
  options?: {
    farmProductFilter?: (farmId: number, productId: number) => boolean;
    /** When false, manual kg stays fixed (inventory status table). Default false. */
    applyRecovery?: boolean;
  },
): Map<string, Map<string, ZoneInventoryDaySnapshot>> {
  const farmProductFilter = options?.farmProductFilter;
  const applyRecovery = options?.applyRecovery ?? false;
  const start = new Date(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate(),
  );
  const end =
    endDate < start
      ? start
      : new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  const loopStart = computeInventorySeriesLoopStartWithHistory(
    start,
    overridesByZone,
    farmProductFilter,
  );
  const totalDays = diffDaysInclusive(loopStart, end);
  const byDate = new Map<string, Map<string, ZoneInventoryDaySnapshot>>();
  const zonePrev = new Map<string, number>();

  const rowsWithCapsByYmd = new Map<string, ForecastHarvestRow[]>();
  const maxByZoneCache = new Map<string, Map<string, number>>();
  const regrowthByZoneCache = new Map<string, Map<string, number>>();
  const harvestByZoneCache = new Map<string, Map<string, number>>();

  const rowsWithCapsFor = (ymd: string, date: Date): ForecastHarvestRow[] => {
    const cached = rowsWithCapsByYmd.get(ymd);
    if (cached) return cached;
    const next = applyLatestZoneMaxKgToForecastRows(forecastRows, zoneConfigs, ymd);
    rowsWithCapsByYmd.set(ymd, next);
    return next;
  };

  const maxByZoneFor = (ymd: string, date: Date): Map<string, number> => {
    const cached = maxByZoneCache.get(ymd);
    if (cached) return cached;
    const next = mergeZoneCapacityMapsAtDate(rowsWithCapsFor(ymd, date), zoneConfigs, date);
    maxByZoneCache.set(ymd, next);
    return next;
  };

  const regrowthFor = (ymd: string, date: Date): Map<string, number> => {
    const cached = regrowthByZoneCache.get(ymd);
    if (cached) return cached;
    const next = computeRegrowthCreditedOnDate(
      rowsWithCapsFor(ymd, date),
      regrowthConfig,
      date,
      zoneConfigs,
    ).availableByZone;
    regrowthByZoneCache.set(ymd, next);
    return next;
  };

  const harvestFor = (ymd: string, date: Date): Map<string, number> => {
    const cached = harvestByZoneCache.get(ymd);
    if (cached) return cached;
    const next = harvestKgByZoneOnDate(rowsWithCapsFor(ymd, date), date);
    harvestByZoneCache.set(ymd, next);
    return next;
  };

  for (let i = 0; i < totalDays; i++) {
    const date = addDays(loopStart, i);
    const dateStr = ymdFromDate(date);
    const maxByZone = maxByZoneFor(dateStr, date);
    const regrowthByZone = regrowthFor(dateStr, date);
    const harvestByZone = harvestFor(dateStr, date);
    const zoneKeys = collectActiveZoneKeysForDay(maxByZone, overridesByZone, farmProductFilter);
    const daySnapshots = new Map<string, ZoneInventoryDaySnapshot>();

    for (const zoneKey of zoneKeys) {
      const maxKg = maxByZone.get(zoneKey) ?? 0;
      let prev = zonePrev.get(zoneKey);
      const isOpeningDay = prev === undefined;
      if (prev === undefined) {
        prev = maxKg > 0 ? maxKg : 0;
      }

      const previousKg = Math.round(Math.max(0, prev));
      const dayRegrowth = Math.round(regrowthByZone.get(zoneKey) ?? 0);
      const dayHarvest = Math.round(harvestByZone.get(zoneKey) ?? 0);
      const rollingBeforeManualSetKg = Math.max(0, prev + dayRegrowth - dayHarvest);
      let rolling = rollingBeforeManualSetKg;

      const exactOverride = manualOverrideForZoneOnExactDate(overridesByZone, zoneKey, date);
      const exactManualSetToday = !!exactOverride;
      let rollingBeforeManualSet: number | null = null;
      if (exactOverride) {
        rollingBeforeManualSet = Math.round(rollingBeforeManualSetKg);
        rolling = Math.max(0, Number(exactOverride.availableKg) || 0);
      }

      zonePrev.set(zoneKey, rolling);

      if (date.getTime() < start.getTime()) continue;

      const calculatedKg = Math.round(Math.min(maxKg, Math.max(0, rolling)));
      const override = pickInventoryOverrideForAsOf(overridesByZone, zoneKey, date);
      const applied = applyInventoryAvailableOverrideToZone({
        calculatedKg: rolling,
        maxKg,
        asOf: date,
        override,
        overrideRecoveryDays: regrowthConfig.overrideRecoveryDays,
        applyRecovery,
      });
      const effectiveKg = Math.round(
        Math.max(0, applied ? applied.effectiveKg : rolling),
      );
      const pct = maxKg > 0 ? Math.round((effectiveKg / maxKg) * 100) : 0;

      daySnapshots.set(zoneKey, {
        previousKg,
        regrowthKg: dayRegrowth,
        harvestKg: dayHarvest,
        rollingBeforeManualSetKg: rollingBeforeManualSet,
        calculatedKg,
        effectiveKg,
        maxKg,
        pct,
        isManualOverrideActive: !!applied,
        manualOverrideDate: applied?.override.date ?? null,
        manualOverrideKg: applied ? Math.round(Math.max(0, applied.override.availableKg)) : null,
        exactManualSetToday,
        isOpeningDay,
      });
    }

    if (date.getTime() >= start.getTime()) {
      byDate.set(dateStr, daySnapshots);
    }
  }

  return byDate;
}

export function computeInventoryStyleFarmGrassDailySeriesWithBreakdown(
  forecastRows: ForecastHarvestRow[],
  zoneConfigs: ZoneConfigurationRow[],
  regrowthConfig: RegrowthReferenceConfig,
  overridesByZone: Record<string, InventoryAvailableOverrideEntry>,
  startDate: Date,
  endDate: Date,
  farmProductFilter?: (farmId: number, productId: number) => boolean,
): DailySeriesResult {
  const start = new Date(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate(),
  );
  const end =
    endDate < start
      ? start
      : new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  const loopStart = computeInventorySeriesLoopStartWithHistory(
    start,
    overridesByZone,
    farmProductFilter,
  );
  const totalDays = diffDaysInclusive(loopStart, end);
  const days: RollingDailyAvailableDay[] = [];
  const byFarmProduct = new Map<string, Map<string, RollingDailyAvailableDay>>();
  const zonePrev = new Map<string, number>();
  const fpLastAvailableKg = new Map<string, number>();
  let lastAvailableKg = 0;

  const rowsWithCapsByYmd = new Map<string, ForecastHarvestRow[]>();
  const maxByZoneCache = new Map<string, Map<string, number>>();
  const regrowthByZoneCache = new Map<string, Map<string, number>>();
  const harvestByZoneCache = new Map<string, Map<string, number>>();

  const rowsWithCapsFor = (ymd: string, date: Date): ForecastHarvestRow[] => {
    const cached = rowsWithCapsByYmd.get(ymd);
    if (cached) return cached;
    const next = applyLatestZoneMaxKgToForecastRows(forecastRows, zoneConfigs, ymd);
    rowsWithCapsByYmd.set(ymd, next);
    return next;
  };

  const maxByZoneFor = (ymd: string, date: Date): Map<string, number> => {
    const cached = maxByZoneCache.get(ymd);
    if (cached) return cached;
    const next = mergeZoneCapacityMapsAtDate(rowsWithCapsFor(ymd, date), zoneConfigs, date);
    maxByZoneCache.set(ymd, next);
    return next;
  };

  const regrowthFor = (ymd: string, date: Date): Map<string, number> => {
    const cached = regrowthByZoneCache.get(ymd);
    if (cached) return cached;
    const next = computeRegrowthCreditedOnDate(
      rowsWithCapsFor(ymd, date),
      regrowthConfig,
      date,
      zoneConfigs,
    ).availableByZone;
    regrowthByZoneCache.set(ymd, next);
    return next;
  };

  const harvestFor = (ymd: string, date: Date): Map<string, number> => {
    const cached = harvestByZoneCache.get(ymd);
    if (cached) return cached;
    const next = harvestKgByZoneOnDate(rowsWithCapsFor(ymd, date), date);
    harvestByZoneCache.set(ymd, next);
    return next;
  };

  for (let i = 0; i < totalDays; i++) {
    const date = addDays(loopStart, i);
    const dateStr = ymdFromDate(date);
    const maxByZone = maxByZoneFor(dateStr, date);
    const regrowthByZone = regrowthFor(dateStr, date);
    const harvestByZone = harvestFor(dateStr, date);
    const zoneKeys = collectActiveZoneKeysForDay(maxByZone, overridesByZone, farmProductFilter);

    let rawAvailableKg = 0;
    let availableKg = 0;
    let capacityCapKg = 0;
    let regrowthKg = 0;
    let harvestKg = 0;
    let hasExactOverrideToday = false;
    const fpHasExactOverride = new Set<string>();

    const fpRawRollingKg = new Map<string, number>();
    const fpCapCounted = new Set<string>();

    for (const zoneKey of zoneKeys) {
      const maxKg = maxByZone.get(zoneKey) ?? 0;
      let prev = zonePrev.get(zoneKey);
      if (prev === undefined) {
        prev = maxKg > 0 ? maxKg : 0;
      }

      const dayRegrowth = regrowthByZone.get(zoneKey) ?? 0;
      const dayHarvest = harvestByZone.get(zoneKey) ?? 0;
      regrowthKg += dayRegrowth;
      harvestKg += dayHarvest;

      let rolling = Math.max(0, prev + dayRegrowth - dayHarvest);

      const exactOverride = manualOverrideForZoneOnExactDate(overridesByZone, zoneKey, date);
      if (exactOverride) {
        hasExactOverrideToday = true;
        rolling = Math.max(0, Number(exactOverride.availableKg) || 0);
      }

      zonePrev.set(zoneKey, rolling);

      const zoneRolling = Math.max(0, rolling);
      rawAvailableKg += zoneRolling;

      const fpKey = farmProductKeyFromZoneKey(zoneKey);
      if (fpKey != null) {
        fpRawRollingKg.set(fpKey, (fpRawRollingKg.get(fpKey) ?? 0) + zoneRolling);
        if (exactOverride) {
          fpHasExactOverride.add(fpKey);
        }
      }
    }

    for (const [fpKey, fpRaw] of fpRawRollingKg) {
      const [farmIdStr, productIdStr] = fpKey.split("|");
      const farmId = Number(farmIdStr);
      const productId = Number(productIdStr);
      if (!Number.isFinite(farmId) || !Number.isFinite(productId)) continue;

      const fpCapKg = sumConfiguredZoneCapKgForFarmProduct(maxByZone, farmId, productId);
      if (fpCapKg > 0 && !fpCapCounted.has(fpKey)) {
        capacityCapKg += fpCapKg;
        fpCapCounted.add(fpKey);
      }

      const fpTotal = Math.max(0, fpRaw);
      if (fpHasExactOverride.has(fpKey)) {
        hasExactOverrideToday = true;
      }
      if (fpCapKg > 0) {
        availableKg += Math.min(fpTotal, fpCapKg);
      } else if (fpHasExactOverride.has(fpKey)) {
        availableKg += fpTotal;
      }
    }

    const fpKeysToday = new Set<string>();
    for (const zoneKey of zoneKeys) {
      const fpKey = farmProductKeyFromZoneKey(zoneKey);
      if (fpKey) fpKeysToday.add(fpKey);
    }

    const fpDaysToday = new Map<string, RollingDailyAvailableDay>();

    for (const fpKey of fpKeysToday) {
      const [farmIdStr, productIdStr] = fpKey.split("|");
      const farmId = Number(farmIdStr);
      const productId = Number(productIdStr);
      if (!Number.isFinite(farmId) || !Number.isFinite(productId)) continue;

      const fpCapKg = sumConfiguredZoneCapKgForFarmProduct(maxByZone, farmId, productId);
      const fpHasOverride = fpHasExactOverride.has(fpKey);
      if (fpCapKg <= 0 && !fpHasOverride) continue;

      const fpRegrowthKg = sumZoneMapKgForFarmProduct(regrowthByZone, farmId, productId);
      const fpHarvestKg = sumZoneMapKgForFarmProduct(harvestByZone, farmId, productId);
      const fpRawTotal = Math.max(0, fpRawRollingKg.get(fpKey) ?? 0);

      let fpAvailableKg: number;
      let fpPreviousKg: number;
      if (fpHasOverride) {
        fpAvailableKg = fpCapKg > 0 ? Math.min(fpRawTotal, fpCapKg) : fpRawTotal;
        fpPreviousKg = fpLastAvailableKg.get(fpKey) ?? fpCapKg;
      } else {
        const fpConfigCapKg = sumConfiguredZoneCapKgForFarmProduct(
          maxByZone,
          farmId,
          productId,
        );
        const fpOpeningCapKg = fpConfigCapKg > 0 ? fpConfigCapKg : fpCapKg;
        fpPreviousKg =
          (fpLastAvailableKg.get(fpKey) ?? 0) > 0 || i > 0
            ? (fpLastAvailableKg.get(fpKey) ?? 0)
            : fpOpeningCapKg;
        fpAvailableKg = Math.max(0, fpPreviousKg + fpRegrowthKg - fpHarvestKg);
        if (fpCapKg > 0) {
          fpAvailableKg = Math.min(fpAvailableKg, fpCapKg);
        }
      }

      fpLastAvailableKg.set(fpKey, fpAvailableKg);

      if (date.getTime() >= start.getTime()) {
        fpDaysToday.set(fpKey, {
          date: dateStr,
          previousAvailableKg: fpPreviousKg,
          regrowthKg: fpRegrowthKg,
          harvestKg: fpHarvestKg,
          beforeHarvestKg: fpPreviousKg + fpRegrowthKg,
          rawAvailableKg: fpAvailableKg,
          capacityCapKg: fpCapKg,
          availableKg: fpAvailableKg,
          overlimitKg: 0,
        });
      }
    }

    const configCapacityCapKg = sumFarmProductCapacityCapsFromZoneConfigAtDate(
      zoneConfigs,
      date,
      farmProductFilter,
    );
    const reportedCapacityCapKg =
      configCapacityCapKg > 0 ? configCapacityCapKg : capacityCapKg;

    const aggregateBaseKg =
      lastAvailableKg > 0 || i > 0
        ? lastAvailableKg
        : reportedCapacityCapKg > 0
          ? reportedCapacityCapKg
          : capacityCapKg;

    const displayAvailableKg = hasExactOverrideToday
      ? availableKg
      : Math.max(0, aggregateBaseKg + regrowthKg - harvestKg);

    if (date.getTime() < start.getTime()) {
      lastAvailableKg = displayAvailableKg;
      continue;
    }

    const beforeHarvestKg = aggregateBaseKg + regrowthKg;

    days.push({
      date: dateStr,
      previousAvailableKg: aggregateBaseKg,
      regrowthKg,
      harvestKg,
      beforeHarvestKg,
      rawAvailableKg,
      capacityCapKg: reportedCapacityCapKg,
      availableKg: displayAvailableKg,
      overlimitKg: 0,
    });

    for (const [fpKey, fpDay] of fpDaysToday) {
      const inner = byFarmProduct.get(fpKey) ?? new Map<string, RollingDailyAvailableDay>();
      inner.set(dateStr, fpDay);
      byFarmProduct.set(fpKey, inner);
    }

    lastAvailableKg = displayAvailableKg;
  }

  return { aggregate: days, byFarmProduct };
}

/**
 * Daily available per zone, aggregated for charting:
 * - Opening per zone = zone max cap (active that day)
 * - Each day: prev + regrowth (on regrowth date) − harvest (on harvest date)
 * - Manual balance on `balance_date` replaces that zone's balance on that day only
 *   (full saved kg is credited — same rule as /inventory status table)
 * - Following days roll the previous credited total: `previous + regrowth − harvest`
 *   (zone-level state still tracks regrowth/harvest per zone for the next balance_date)
 */
export function computeInventoryStyleFarmGrassDailySeries(
  forecastRows: ForecastHarvestRow[],
  zoneConfigs: ZoneConfigurationRow[],
  regrowthConfig: RegrowthReferenceConfig,
  overridesByZone: Record<string, InventoryAvailableOverrideEntry>,
  startDate: Date,
  endDate: Date,
  farmProductFilter?: (farmId: number, productId: number) => boolean,
): RollingDailyAvailableDay[] {
  return computeInventoryStyleFarmGrassDailySeriesWithBreakdown(
    forecastRows,
    zoneConfigs,
    regrowthConfig,
    overridesByZone,
    startDate,
    endDate,
    farmProductFilter,
  ).aggregate;
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
