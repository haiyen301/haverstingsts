import { DEFAULT_FALLBACK_INVENTORY_KG_PER_M2 } from "@/features/forecasting/forecastingInventoryConversion";
import type { ZoneInventoryDaySnapshot } from "@/features/forecasting/forecastAvailableAtDate";

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
  return {
    dateYmd,
    previousKg: snap.previousKg,
    regrowthKg: snap.regrowthKg,
    harvestKg: snap.harvestKg,
    endKg: snap.calculatedKg,
    manualKg: snap.exactManualSetToday ? snap.manualOverrideKg : null,
    isOpeningDay: snap.isOpeningDay,
    isManualSetToday: snap.exactManualSetToday,
    rollingBeforeManualKg: snap.rollingBeforeManualSetKg,
  };
}

export function buildZoneBalanceTimeline(
  snapshotsByDate: Map<string, Map<string, ZoneInventoryDaySnapshot>>,
  zoneKey: string,
): ZoneBalanceTimelineEntry[] {
  const entries: ZoneBalanceTimelineEntry[] = [];
  const dates = Array.from(snapshotsByDate.keys()).sort();
  for (const dateYmd of dates) {
    const snap = snapshotsByDate.get(dateYmd)?.get(zoneKey);
    if (!snap) continue;
    const hasActivity =
      snap.isOpeningDay ||
      snap.regrowthKg > 0 ||
      snap.harvestKg > 0 ||
      snap.exactManualSetToday;
    if (!hasActivity) continue;
    entries.push(snapToTimelineEntry(snap, dateYmd));
  }
  return entries;
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
    const snap = snapshotsByDate.get(dateYmd)?.get(zoneKey);
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
      snap.regrowthKg > 0 || snap.harvestKg > 0 || snap.exactManualSetToday;
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
  const firstActivity = activityEntries[0];

  if (
    firstActivity &&
    Math.round(firstActivity.previousKg) !== Math.round(openingEntry.endKg)
  ) {
    result.push({
      dateYmd: firstActivity.dateYmd,
      previousKg: openingEntry.endKg,
      regrowthKg: 0,
      harvestKg: 0,
      endKg: firstActivity.previousKg,
      manualKg: null,
      isOpeningDay: false,
      isManualSetToday: false,
      rollingBeforeManualKg: null,
      isBridgeEntry: true,
    });
  }

  for (const entry of activityEntries) {
    if (entry.isOpeningDay) continue;
    result.push(entry);
  }

  return result;
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

  const rolled =
    entry.isManualSetToday && entry.rollingBeforeManualKg != null
      ? entry.rollingBeforeManualKg
      : Math.max(0, entry.previousKg + entry.regrowthKg - entry.harvestKg);

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

  if (entry.isManualSetToday && entry.manualKg != null) {
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
    if (entry.isManualSetToday && entry.manualKg != null) {
      const rolled =
        entry.rollingBeforeManualKg ??
        Math.max(0, entry.previousKg + entry.regrowthKg - entry.harvestKg);
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
