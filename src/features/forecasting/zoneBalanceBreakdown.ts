import type { ZoneInventoryDaySnapshot } from "@/features/forecasting/forecastAvailableAtDate";

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

export function formatKg(value: number): string {
  const n = Math.round(Number.isFinite(value) ? value : 0);
  return n.toLocaleString();
}

export function formatSignedKg(value: number, sign: "+" | "−"): string {
  const n = Math.round(Math.abs(Number.isFinite(value) ? value : 0));
  if (n === 0) return "0";
  return sign === "+" ? `+${n.toLocaleString()}` : `−${n.toLocaleString()}`;
}

export function formatTimelineEntryFormula(
  entry: ZoneBalanceTimelineEntry,
  maxKg: number,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  if (entry.isOpeningDay) {
    return t("breakdownOpeningLine", { kg: formatKg(entry.endKg || maxKg) });
  }

  if (entry.isBridgeEntry) {
    return t("breakdownBridgeLine", {
      from: formatKg(entry.previousKg),
      to: formatKg(entry.endKg),
    });
  }

  const rolled =
    entry.isManualSetToday && entry.rollingBeforeManualKg != null
      ? entry.rollingBeforeManualKg
      : Math.max(0, entry.previousKg + entry.regrowthKg - entry.harvestKg);

  const formula = t("breakdownFormulaLine", {
    prev: formatKg(entry.previousKg),
    regrowth: entry.regrowthKg > 0 ? formatKg(entry.regrowthKg) : "0",
    harvest: entry.harvestKg > 0 ? formatKg(entry.harvestKg) : "0",
    result: formatKg(rolled),
  });

  if (entry.isManualSetToday && entry.manualKg != null) {
    return `${formula} · ${t("breakdownManualReplaceLine", {
      rolled: formatKg(rolled),
      manual: formatKg(entry.manualKg),
    })}`;
  }

  return formula;
}
