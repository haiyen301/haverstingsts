import type { EnrichedZoneBalanceTimelineEntry } from "@/features/forecasting/InventoryZoneBalanceBreakdownPanel";
import type {
  ZoneBalanceHarvestEvent,
  ZoneBalanceRegrowthEvent,
} from "@/features/forecasting/zoneBalanceDayEvents";
import type { ZoneBalanceTimelineEntry } from "@/features/forecasting/zoneBalanceBreakdown";

export type DbSnapshotZoneEventContext = {
  farmName?: string;
  turfgrass?: string;
  zone?: string;
};

export function formatDbSnapshotEventLabel(ctx?: DbSnapshotZoneEventContext): string {
  if (!ctx) return "";
  const parts = [
    ctx.farmName,
    ctx.turfgrass,
    ctx.zone ? `Z${ctx.zone}` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

export function dbSnapshotFallbackHarvestEvent(
  entry: ZoneBalanceTimelineEntry,
  ctx?: DbSnapshotZoneEventContext,
): ZoneBalanceHarvestEvent {
  return {
    rowId: `db-harvest-${entry.dateYmd}`,
    harvestDateYmd: entry.dateYmd,
    kg: entry.harvestKg,
    label: formatDbSnapshotEventLabel(ctx),
    m2Hint: null,
  };
}

export function dbSnapshotFallbackRegrowthEvent(
  entry: ZoneBalanceTimelineEntry,
  ctx?: DbSnapshotZoneEventContext,
): ZoneBalanceRegrowthEvent {
  return {
    rowId: `db-regrowth-${entry.dateYmd}`,
    sourceHarvestDateYmd: entry.dateYmd,
    regrowthDateYmd: entry.dateYmd,
    creditedKg: entry.regrowthKg,
    label: formatDbSnapshotEventLabel(ctx),
    m2Hint: null,
  };
}

/** Build harvest/regrowth lines from DB snapshot totals when day_detail is unavailable. */
export function enrichZoneBalanceTimelineFromDbSnapshots(
  timeline: ZoneBalanceTimelineEntry[],
  ctx?: DbSnapshotZoneEventContext,
): EnrichedZoneBalanceTimelineEntry[] {
  return timeline.map((entry) => {
    if (entry.isOpeningDay || entry.isBridgeEntry) {
      return {
        ...entry,
        harvestEvents: [] as ZoneBalanceHarvestEvent[],
        regrowthEvents: [] as ZoneBalanceRegrowthEvent[],
      };
    }

    const harvestEvents: ZoneBalanceHarvestEvent[] =
      entry.harvestKg > 0 ? [dbSnapshotFallbackHarvestEvent(entry, ctx)] : [];

    const regrowthEvents: ZoneBalanceRegrowthEvent[] =
      entry.regrowthKg > 0 ? [dbSnapshotFallbackRegrowthEvent(entry, ctx)] : [];

    return {
      ...entry,
      harvestEvents,
      regrowthEvents,
    };
  });
}
