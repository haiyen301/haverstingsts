import { DEFAULT_FALLBACK_INVENTORY_KG_PER_M2 } from "@/features/forecasting/forecastingInventoryConversion";
import type { ZoneInventoryDaySnapshot } from "@/features/forecasting/forecastDbTypes";
import type { DbSnapshotRow } from "@/features/forecasting/forecastSnapshotApi";
import {
  dbSnapshotToZoneInventoryDaySnapshot,
  filterSnapshotRowsForZoneKey,
} from "@/features/forecasting/inventoryDbSnapshots";
import {
  canonicalForecastZoneKey,
  forecastZoneKeysEqual,
} from "@/features/forecasting/inventoryRegrowthCalculator";
import type { InventoryAvailableOverrideEntry } from "@/shared/store/inventoryAvailableOverrideStore";

export type BalanceBreakdownDisplayUnit = "kg" | "m2";

export type BalanceBreakdownFormulaOptions = {
  unit: BalanceBreakdownDisplayUnit;
  kgPerM2: number;
};

export type ZoneBalanceTimelineEntry = {
  dateYmd: string;
  previousKg: number;
  regrowthKg: number;
  harvestKg: number;
  endKg: number;
  manualKg: number | null;
  isOpeningDay: boolean;
  isManualSetToday: boolean;
  rollingBeforeManualKg: number | null;
  /** Fills gap when history window starts after zone opened at max. */
  isBridgeEntry?: boolean;
};

function snapToTimelineEntry(
  snap: ZoneInventoryDaySnapshot,
  dateYmd: string,
): ZoneBalanceTimelineEntry {
  const systemRolled = Math.max(
    0,
    snap.previousKg + snap.regrowthKg - snap.harvestKg,
  );
  const hasActivity = snap.regrowthKg > 0 || snap.harvestKg > 0;
  const provisionalManualKg = snap.exactManualSetToday ? snap.manualOverrideKg : null;
  const provisional: ZoneBalanceTimelineEntry = {
    dateYmd,
    previousKg: snap.previousKg,
    regrowthKg: snap.regrowthKg,
    harvestKg: snap.harvestKg,
    endKg: hasActivity ? systemRolled : snap.calculatedKg,
    manualKg: provisionalManualKg,
    isOpeningDay: snap.isOpeningDay,
    isManualSetToday: snap.exactManualSetToday,
    rollingBeforeManualKg: snap.rollingBeforeManualSetKg,
  };
  const manualOverride = hasManualBalanceOverride(provisional);
  const manualKg = manualOverride ? provisionalManualKg : null;
  const endKg =
    manualOverride && manualKg != null
      ? manualKg
      : hasActivity
        ? systemRolled
        : snap.calculatedKg;
  return {
    ...provisional,
    endKg,
    manualKg,
    isManualSetToday: manualOverride,
  };
}

export type ZoneBalanceSource = "manual";

/** System balance after applying this day's regrowth − harvest. */
export function systemRolledKg(entry: ZoneBalanceTimelineEntry): number {
  const harvestKg = Math.max(0, entry.harvestKg);
  const regrowthKg = Math.max(0, entry.regrowthKg);
  return Math.max(0, entry.previousKg + regrowthKg - harvestKg);
}

export function rolledKgBeforeManual(entry: ZoneBalanceTimelineEntry): number {
  return systemRolledKg(entry);
}

/** True only when user manual balance differs from the system-rolled value. */
export function hasManualBalanceOverride(entry: ZoneBalanceTimelineEntry): boolean {
  if (!entry.isManualSetToday || entry.manualKg == null) return false;
  const rolled = rolledKgBeforeManual(entry);
  if (Math.round(entry.manualKg) === Math.round(rolled)) return false;
  if (
    entry.harvestKg > 0 &&
    Math.round(entry.manualKg) === Math.round(entry.previousKg)
  ) {
    return false;
  }
  return true;
}

/** Manual badge only on days with a real manual override. */
export function resolveZoneBalanceSource(
  entry: ZoneBalanceTimelineEntry,
): ZoneBalanceSource | null {
  if (entry.isOpeningDay || entry.isBridgeEntry) return null;
  if (hasManualBalanceOverride(entry)) return "manual";
  return null;
}

export function hasBalanceTimelineImpact(entry: ZoneBalanceTimelineEntry): boolean {
  if (entry.isOpeningDay || entry.isBridgeEntry) return true;

  const harvestKg = Math.max(0, entry.harvestKg);
  const regrowthKg = Math.max(0, entry.regrowthKg);
  if (harvestKg > 0 || regrowthKg > 0) return true;

  return hasManualBalanceOverride(entry);
}

/** Drop days with no harvest, regrowth, or manual balance change. Keeps opening/bridge/today. */
export function filterZoneBalanceTimelineToImpactDays(
  entries: ZoneBalanceTimelineEntry[],
  todayYmd?: string,
): ZoneBalanceTimelineEntry[] {
  return entries.filter((entry) => {
    if (todayYmd && entry.dateYmd === todayYmd) return true;
    return hasBalanceTimelineImpact(entry);
  });
}

function rechainTimelineEntry(
  entry: ZoneBalanceTimelineEntry,
  priorClosingKg: number,
): ZoneBalanceTimelineEntry {
  const previousKg = priorClosingKg;
  const regrowthKg = Math.max(0, entry.regrowthKg);
  const harvestKg = Math.max(0, entry.harvestKg);
  const provisional: ZoneBalanceTimelineEntry = {
    ...entry,
    previousKg,
    regrowthKg,
    harvestKg,
  };
  const manualOverride = hasManualBalanceOverride(provisional);
  const endKg =
    manualOverride && entry.manualKg != null
      ? entry.manualKg
      : systemRolledKg(provisional);

  return {
    ...entry,
    previousKg,
    regrowthKg,
    harvestKg,
    endKg,
    isManualSetToday:
      entry.manualKg != null &&
      hasManualBalanceOverride({ ...entry, previousKg, regrowthKg, harvestKg, endKg }),
  };
}

/** Carry closing balance forward on history days. Today keeps DB snapshot fields. */
export function rechainZoneBalanceTimelineForDisplay(
  entries: ZoneBalanceTimelineEntry[],
  params: { todayYmd?: string } = {},
): ZoneBalanceTimelineEntry[] {
  let closingKg = 0;
  const out: ZoneBalanceTimelineEntry[] = [];

  for (const entry of entries) {
    if (entry.isOpeningDay) {
      out.push(entry);
      closingKg = entry.endKg;
      continue;
    }
    if (entry.isBridgeEntry) {
      out.push(entry);
      closingKg = entry.endKg;
      continue;
    }

    const isToday =
      params.todayYmd != null && entry.dateYmd === params.todayYmd;
    if (isToday) {
      out.push(entry);
      closingKg = entry.endKg;
      continue;
    }

    const rechained = rechainTimelineEntry(entry, closingKg);
    out.push(rechained);
    closingKg = rechained.endKg;
  }

  return out;
}

function snapHasBalanceImpact(
  snap: ZoneInventoryDaySnapshot,
  dateYmd: string,
): boolean {
  return hasBalanceTimelineImpact(snapToTimelineEntry(snap, dateYmd));
}

export function buildZoneBalanceTimeline(
  snapshotsByDate: Map<string, Map<string, ZoneInventoryDaySnapshot>>,
  zoneKey: string,
): ZoneBalanceTimelineEntry[] {
  const entries: ZoneBalanceTimelineEntry[] = [];
  const dates = Array.from(snapshotsByDate.keys()).sort();
  for (const dateYmd of dates) {
    const snap = lookupZoneSnapshotForDate(snapshotsByDate, dateYmd, zoneKey);
    if (!snap) continue;
    const hasActivity =
      snap.isOpeningDay ||
      snapHasBalanceImpact(snap, dateYmd);
    if (!hasActivity) continue;
    entries.push(snapToTimelineEntry(snap, dateYmd));
  }
  return entries;
}

function lookupZoneSnapshotForDate(
  snapshotsByDate: Map<string, Map<string, ZoneInventoryDaySnapshot>>,
  dateYmd: string,
  zoneKey: string,
): ZoneInventoryDaySnapshot | undefined {
  const dayMap = snapshotsByDate.get(dateYmd);
  if (!dayMap) return undefined;
  const canonical = canonicalForecastZoneKey(zoneKey);
  if (dayMap.has(canonical)) return dayMap.get(canonical);
  for (const [key, snap] of dayMap) {
    if (forecastZoneKeysEqual(key, zoneKey)) return snap;
  }
  return undefined;
}

/** Full display timeline: always opens at zone max, then every activity day in range. */
export function buildZoneBalanceTimelineForDisplay(
  snapshotsByDate: Map<string, Map<string, ZoneInventoryDaySnapshot>>,
  zoneKey: string,
  maxKg: number,
  periodStartYmd: string,
): ZoneBalanceTimelineEntry[] {
  const dates = Array.from(snapshotsByDate.keys()).sort();
  const activityEntries: ZoneBalanceTimelineEntry[] = [];
  let simOpeningEntry: ZoneBalanceTimelineEntry | null = null;

  for (const dateYmd of dates) {
    const snap = lookupZoneSnapshotForDate(snapshotsByDate, dateYmd, zoneKey);
    if (!snap) continue;

    if (snap.isOpeningDay) {
      simOpeningEntry = {
        ...snapToTimelineEntry(snap, dateYmd),
        isOpeningDay: true,
        endKg: maxKg > 0 ? maxKg : snap.calculatedKg,
      };
      continue;
    }

    const hasActivity =
      snap.regrowthKg > 0 ||
      snap.harvestKg > 0 ||
      snap.exactManualSetToday ||
      snapHasBalanceImpact(snap, dateYmd);
    if (hasActivity) {
      activityEntries.push(snapToTimelineEntry(snap, dateYmd));
    }
  }

  const openingEntry: ZoneBalanceTimelineEntry = {
    ...(simOpeningEntry ?? {
      dateYmd: periodStartYmd,
      previousKg: 0,
      regrowthKg: 0,
      harvestKg: 0,
      endKg: maxKg,
      manualKg: null,
      isOpeningDay: true,
      isManualSetToday: false,
      rollingBeforeManualKg: null,
    }),
    isOpeningDay: true,
    endKg: maxKg > 0 ? maxKg : (simOpeningEntry?.endKg ?? 0),
  };

  const result: ZoneBalanceTimelineEntry[] = [openingEntry];

  for (const entry of activityEntries) {
    if (entry.isOpeningDay) continue;
    result.push(entry);
  }

  return result;
}

/** Balance breakdown timeline built only from `inventory_daily_snapshots` rows (no client simulate). */
export function buildZoneBalanceTimelineFromDbSnapshotRows(
  snapshotRows: DbSnapshotRow[],
  zoneKey: string,
  maxKg: number,
  periodStartYmd: string,
  overridesByZone: Record<string, InventoryAvailableOverrideEntry>,
): ZoneBalanceTimelineEntry[] {
  const zoneRows = filterSnapshotRowsForZoneKey(snapshotRows, zoneKey).sort((a, b) =>
    String(a.snapshot_date ?? "").localeCompare(String(b.snapshot_date ?? "")),
  );

  const openingEntry: ZoneBalanceTimelineEntry = {
    dateYmd: periodStartYmd,
    previousKg: 0,
    regrowthKg: 0,
    harvestKg: 0,
    endKg: maxKg > 0 ? maxKg : 0,
    manualKg: null,
    isOpeningDay: true,
    isManualSetToday: false,
    rollingBeforeManualKg: null,
  };

  const result: ZoneBalanceTimelineEntry[] = [openingEntry];
  let priorClosingKg = openingEntry.endKg;

  for (const row of zoneRows) {
    const dateYmd = String(row.snapshot_date ?? "").trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) continue;

    const snap = dbSnapshotToZoneInventoryDaySnapshot(row, overridesByZone, dateYmd);
    const entry = snapToTimelineEntry(snap, dateYmd);
    const hasEventColumns =
      entry.harvestKg > 0 ||
      entry.regrowthKg > 0 ||
      snap.exactManualSetToday ||
      hasManualBalanceOverride(entry) ||
      Boolean(row.has_manual_override);
    const closingKg = entry.endKg;
    const balanceChanged = Math.round(closingKg) !== Math.round(priorClosingKg);
    const dbChainBreak = Math.round(entry.previousKg) !== Math.round(priorClosingKg);

    if (!hasEventColumns && !balanceChanged && !dbChainBreak) continue;

    result.push(entry);
    priorClosingKg = closingKg;
  }

  return result;
}

/**
 * When today's DB `previousKg` differs from the last displayed closing (e.g. regrowth
 * landed on days omitted from the sparse timeline), insert a bridge so Today does not
 * inherit a fake lump-sum regrowth from the gap.
 */
export function insertGapBridgeBeforeToday(
  entries: ZoneBalanceTimelineEntry[],
  todayYmd: string,
): ZoneBalanceTimelineEntry[] {
  if (!todayYmd) return entries;
  const todayIdx = entries.findIndex(
    (e) => e.dateYmd === todayYmd && !e.isOpeningDay && !e.isBridgeEntry,
  );
  if (todayIdx <= 0) return entries;

  const todayEntry = entries[todayIdx]!;
  const priorClosing = entries[todayIdx - 1]!.endKg;

  if (Math.round(todayEntry.previousKg) === Math.round(priorClosing)) return entries;

  const bridge: ZoneBalanceTimelineEntry = {
    dateYmd: todayYmd,
    previousKg: priorClosing,
    regrowthKg: 0,
    harvestKg: 0,
    endKg: todayEntry.previousKg,
    manualKg: null,
    isOpeningDay: false,
    isManualSetToday: false,
    rollingBeforeManualKg: null,
    isBridgeEntry: true,
  };

  const result = [...entries];
  result.splice(todayIdx, 0, bridge);
  return result;
}

/** Newest day first (today at top, opening at bottom). */
export function reverseZoneBalanceTimelineForDisplay(
  entries: ZoneBalanceTimelineEntry[],
): ZoneBalanceTimelineEntry[] {
  return [...entries].reverse();
}

export function formatShortDateYmd(ymd: string | null | undefined): string {
  if (!ymd) return "";
  const m = String(ymd).trim().slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(ymd);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function resolveBalanceKgPerM2(kgPerM2: number): number {
  return kgPerM2 > 0 ? kgPerM2 : DEFAULT_FALLBACK_INVENTORY_KG_PER_M2;
}

export function balanceKgToM2(kg: number, kgPerM2: number): number {
  if (kg <= 0) return 0;
  return Math.max(0, Math.round(kg / resolveBalanceKgPerM2(kgPerM2)));
}

export function formatKgPerM2Rate(rate: number): string {
  const resolved = resolveBalanceKgPerM2(rate);
  const rounded = Math.round(resolved * 100) / 100;
  return rounded.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function formatKg(value: number): string {
  const n = Math.round(Number.isFinite(value) ? value : 0);
  return n.toLocaleString();
}

export function formatM2(value: number): string {
  const n = Math.round(Number.isFinite(value) ? value : 0);
  return n.toLocaleString();
}

export function formatSignedKg(value: number, sign: "+" | "−"): string {
  const n = Math.round(Math.abs(Number.isFinite(value) ? value : 0));
  if (n === 0) return "0";
  return sign === "+" ? `+${n.toLocaleString()}` : `−${n.toLocaleString()}`;
}

export function formatSignedM2(value: number, sign: "+" | "−"): string {
  const n = Math.round(Math.abs(Number.isFinite(value) ? value : 0));
  if (n === 0) return "0";
  return sign === "+" ? `+${n.toLocaleString()}` : `−${n.toLocaleString()}`;
}

export function formatTimelineEntryFormula(
  entry: ZoneBalanceTimelineEntry,
  maxKg: number,
  t: (key: string, values?: Record<string, string | number>) => string,
  options?: BalanceBreakdownFormulaOptions,
): string {
  const useM2 = options?.unit === "m2";
  const rate = options ? resolveBalanceKgPerM2(options.kgPerM2) : 0;
  const toDisplay = (kg: number) =>
    useM2 ? formatM2(balanceKgToM2(kg, rate)) : formatKg(kg);

  if (entry.isOpeningDay) {
    const kg = entry.endKg || maxKg;
    return useM2
      ? t("breakdownOpeningLineM2", {
          m2: toDisplay(kg),
          kg: formatKg(kg),
          rate: formatKgPerM2Rate(rate),
        })
      : t("breakdownOpeningLine", { kg: formatKg(kg) });
  }

  if (entry.isBridgeEntry) {
    return useM2
      ? t("breakdownBridgeLineM2", {
          from: toDisplay(entry.previousKg),
          to: toDisplay(entry.endKg),
        })
      : t("breakdownBridgeLine", {
          from: formatKg(entry.previousKg),
          to: formatKg(entry.endKg),
        });
  }

  const rolled = rolledKgBeforeManual(entry);

  const formula = useM2
    ? t("breakdownFormulaLineM2", {
        prev: toDisplay(entry.previousKg),
        regrowth: entry.regrowthKg > 0 ? toDisplay(entry.regrowthKg) : "0",
        harvest: entry.harvestKg > 0 ? toDisplay(entry.harvestKg) : "0",
        result: toDisplay(rolled),
      })
    : t("breakdownFormulaLine", {
        prev: formatKg(entry.previousKg),
        regrowth: entry.regrowthKg > 0 ? formatKg(entry.regrowthKg) : "0",
        harvest: entry.harvestKg > 0 ? formatKg(entry.harvestKg) : "0",
        result: formatKg(rolled),
      });

  if (hasManualBalanceOverride(entry) && entry.manualKg != null) {
    const manualPart = useM2
      ? t("breakdownManualReplaceLineM2", {
          rolled: toDisplay(rolled),
          manual: toDisplay(entry.manualKg),
        })
      : t("breakdownManualReplaceLine", {
          rolled: formatKg(rolled),
          manual: formatKg(entry.manualKg),
        });
    return `${formula} · ${manualPart}`;
  }

  return formula;
}

export type ZoneBalanceChangeSummary = {
  configMaxKg: number;
  openingKg: number;
  currentKg: number;
  totalRegrowthKg: number;
  totalHarvestKg: number;
  manualAdjustmentKg: number;
  netChangeKg: number;
  regrowthEventCount: number;
  harvestEventCount: number;
  manualEventCount: number;
};

export function computeZoneBalanceChangeSummary(params: {
  timelineEntries: ZoneBalanceTimelineEntry[];
  maxKg: number;
  currentKg: number;
  harvestEventCount?: number;
  regrowthEventCount?: number;
}): ZoneBalanceChangeSummary {
  const { timelineEntries, maxKg, currentKg } = params;
  const openingEntry = timelineEntries.find((e) => e.isOpeningDay);
  const openingKg = openingEntry?.endKg ?? (maxKg > 0 ? maxKg : currentKg);

  let totalRegrowthKg = 0;
  let totalHarvestKg = 0;
  let manualAdjustmentKg = 0;
  let manualEventCount = 0;

  for (const entry of timelineEntries) {
    if (entry.isOpeningDay || entry.isBridgeEntry) continue;
    totalRegrowthKg += Math.max(0, entry.regrowthKg);
    totalHarvestKg += Math.max(0, entry.harvestKg);
    if (hasManualBalanceOverride(entry) && entry.manualKg != null) {
      const rolled = rolledKgBeforeManual(entry);
      manualAdjustmentKg += entry.manualKg - rolled;
      manualEventCount += 1;
    }
  }

  return {
    configMaxKg: maxKg,
    openingKg,
    currentKg,
    totalRegrowthKg,
    totalHarvestKg,
    manualAdjustmentKg,
    netChangeKg: currentKg - openingKg,
    regrowthEventCount: params.regrowthEventCount ?? 0,
    harvestEventCount: params.harvestEventCount ?? 0,
    manualEventCount,
  };
}
