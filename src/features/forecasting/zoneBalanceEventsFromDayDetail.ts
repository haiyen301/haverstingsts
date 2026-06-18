import type { EnrichedZoneBalanceTimelineEntry } from "@/features/forecasting/InventoryZoneBalanceBreakdownPanel";
import type { ForecastDayDetailRow } from "@/features/forecasting/forecastSnapshotApi";
import { fetchForecastDayDetail } from "@/features/forecasting/forecastSnapshotApi";
import {
  forecastZoneKeyFromParts,
  forecastZoneKeysEqual,
} from "@/features/forecasting/inventoryRegrowthCalculator";
import type {
  ZoneBalanceHarvestEvent,
  ZoneBalanceM2Hint,
  ZoneBalanceRegrowthEvent,
} from "@/features/forecasting/zoneBalanceDayEvents";
import type { ZoneBalanceTimelineEntry } from "@/features/forecasting/zoneBalanceBreakdown";
import {
  type DbSnapshotZoneEventContext,
  dbSnapshotFallbackHarvestEvent,
  dbSnapshotFallbackRegrowthEvent,
} from "@/features/forecasting/zoneBalanceEventsFromDbSnapshot";

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function detailRowZoneKey(row: ForecastDayDetailRow): string {
  const zone = str(row.zone) || str(row.db_zone);
  return forecastZoneKeyFromParts(num(row.farm_id), zone, num(row.product_id));
}

function rowMatchesZone(row: ForecastDayDetailRow, zoneKey: string): boolean {
  return forecastZoneKeysEqual(detailRowZoneKey(row), zoneKey);
}

function buildM2HintFromDetail(
  row: ForecastDayDetailRow,
  kg: number,
): ZoneBalanceM2Hint | null {
  const m2 = num(row.area_m2);
  const kgPerM2 = num(row.kg_per_m2);
  if (m2 <= 0 || kgPerM2 <= 0 || kg <= 0) return null;
  return {
    m2: Math.round(m2),
    kgPerM2,
    kg: Math.round(kg),
  };
}

function loadTypeFromDetail(row: ForecastDayDetailRow): string {
  return str(row.type);
}

function formatEventLabel(row: ForecastDayDetailRow): string {
  const parts = [
    str(row.project),
    str(row.customer),
    str(row.farm),
    str(row.grass),
    str(row.zone) ? `Z${str(row.zone)}` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

function formatQtyLine(row: ForecastDayDetailRow): string {
  const qty = num(row.qty);
  const uom = str(row.uom) || "kg";
  if (qty <= 0) return "";
  return `${qty.toLocaleString()} ${uom}`;
}

function usesZoneConfigNote(note: string): boolean {
  return note.includes("zone config") || note.includes("DB zone blank");
}

function conversionNoteFromDetail(row: ForecastDayDetailRow): {
  note?: string;
  usesZoneConfig: boolean;
} {
  const m2Note = str(row.m2_conversion_note);
  const zoneConfigLine = str(row.zone_config_line);
  const m2 = num(row.area_m2);
  const rate = num(row.kg_per_m2);

  if (zoneConfigLine) {
    return { note: zoneConfigLine, usesZoneConfig: true };
  }

  if (m2Note && usesZoneConfigNote(m2Note) && m2 > 0 && rate > 0) {
    return {
      note: `${m2.toLocaleString()} m² × ${rate} kg/m² = ${Math.round(m2 * rate).toLocaleString()} kg (zone config)`,
      usesZoneConfig: true,
    };
  }

  if (m2 > 0 && rate > 0) {
    return {
      note: `${m2.toLocaleString()} m² × ${rate} kg/m² = ${Math.round(m2 * rate).toLocaleString()} kg`,
      usesZoneConfig: m2Note.includes("zone config"),
    };
  }

  if (m2Note) {
    return { note: m2Note, usesZoneConfig: usesZoneConfigNote(m2Note) };
  }

  return { usesZoneConfig: false };
}

export function mapHarvestDetailRowsToZoneEvents(
  rows: ForecastDayDetailRow[],
  zoneKey: string,
  dateYmd: string,
): ZoneBalanceHarvestEvent[] {
  const events: ZoneBalanceHarvestEvent[] = [];
  for (const row of rows) {
    if (!rowMatchesZone(row, zoneKey)) continue;
    const kg = Math.round(Math.max(0, num(row.inventory_kg)));
    if (kg <= 0) continue;
    const { note, usesZoneConfig } = conversionNoteFromDetail(row);
    events.push({
      rowId: str(row.fragment_id) || str(row.plan_id) || `${dateYmd}-harvest`,
      harvestDateYmd: str(row.harvest_date) || dateYmd,
      kg,
      label: formatEventLabel(row),
      loadType: loadTypeFromDetail(row) || undefined,
      m2Hint: buildM2HintFromDetail(row, kg),
      qtyLine: formatQtyLine(row),
      conversionNote: note,
      usesZoneConfig,
    });
  }
  return events.sort((a, b) => a.label.localeCompare(b.label));
}

export function mapRegrowthDetailRowsToZoneEvents(
  rows: ForecastDayDetailRow[],
  zoneKey: string,
  dateYmd: string,
): ZoneBalanceRegrowthEvent[] {
  const events: ZoneBalanceRegrowthEvent[] = [];
  for (const row of rows) {
    if (!rowMatchesZone(row, zoneKey)) continue;
    const creditedKg = Math.round(Math.max(0, num(row.credited_kg)));
    if (creditedKg <= 0) continue;
    const { note, usesZoneConfig } = conversionNoteFromDetail(row);
    events.push({
      rowId: str(row.fragment_id) || str(row.plan_id) || `${dateYmd}-regrowth`,
      sourceHarvestDateYmd: str(row.harvest_date) || dateYmd,
      regrowthDateYmd: str(row.regrowth_date) || dateYmd,
      creditedKg,
      label: formatEventLabel(row),
      loadType: loadTypeFromDetail(row) || undefined,
      m2Hint: buildM2HintFromDetail(row, creditedKg),
      qtyLine: formatQtyLine(row),
      conversionNote: note,
      usesZoneConfig,
    });
  }
  return events.sort(
    (a, b) =>
      a.sourceHarvestDateYmd.localeCompare(b.sourceHarvestDateYmd) ||
      a.label.localeCompare(b.label),
  );
}

export async function fetchZoneBalanceDayDetailsForTimeline(
  entries: Array<{ dateYmd: string; harvestKg: number; regrowthKg: number }>,
  anchorDate: string,
): Promise<{
  harvestByDate: Map<string, ForecastDayDetailRow[]>;
  regrowthByDate: Map<string, ForecastDayDetailRow[]>;
}> {
  const harvestByDate = new Map<string, ForecastDayDetailRow[]>();
  const regrowthByDate = new Map<string, ForecastDayDetailRow[]>();
  const harvestDates = new Set<string>();
  const regrowthDates = new Set<string>();

  for (const entry of entries) {
    if (entry.harvestKg > 0) harvestDates.add(entry.dateYmd);
    if (entry.regrowthKg > 0) regrowthDates.add(entry.dateYmd);
  }

  const allDates = [...new Set([...harvestDates, ...regrowthDates])].sort();
  const chunkSize = 6;

  for (let i = 0; i < allDates.length; i += chunkSize) {
    const chunk = allDates.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async (date) => {
        const needHarvest = harvestDates.has(date);
        const needRegrowth = regrowthDates.has(date);
        const [harvestRes, regrowthRes] = await Promise.all([
          needHarvest
            ? fetchForecastDayDetail({ date, kind: "harvest", anchorDate }).catch(() => null)
            : null,
          needRegrowth
            ? fetchForecastDayDetail({ date, kind: "regrowth", anchorDate }).catch(() => null)
            : null,
        ]);
        if (needHarvest && harvestRes?.rows) {
          harvestByDate.set(date, harvestRes.rows);
        }
        if (needRegrowth && regrowthRes?.rows) {
          regrowthByDate.set(date, regrowthRes.rows);
        }
      }),
    );
  }

  return { harvestByDate, regrowthByDate };
}

/** DB timeline + day_detail rows for activity days only (load type, qty, plan lines). */
export async function enrichZoneBalanceTimelineForBreakdown(
  timeline: ZoneBalanceTimelineEntry[],
  zoneKey: string,
  anchorDate: string,
  dbCtx?: DbSnapshotZoneEventContext,
): Promise<EnrichedZoneBalanceTimelineEntry[]> {
  const activityEntries = timeline.filter(
    (entry) =>
      !entry.isOpeningDay &&
      !entry.isBridgeEntry &&
      (entry.harvestKg > 0 || entry.regrowthKg > 0),
  );

  const { harvestByDate, regrowthByDate } = await fetchZoneBalanceDayDetailsForTimeline(
    activityEntries.map((entry) => ({
      dateYmd: entry.dateYmd,
      harvestKg: entry.harvestKg,
      regrowthKg: entry.regrowthKg,
    })),
    anchorDate,
  );

  return timeline.map((entry) => {
    if (entry.isOpeningDay || entry.isBridgeEntry) {
      return {
        ...entry,
        harvestEvents: [],
        regrowthEvents: [],
      };
    }

    let harvestEvents =
      entry.harvestKg > 0
        ? mapHarvestDetailRowsToZoneEvents(
            harvestByDate.get(entry.dateYmd) ?? [],
            zoneKey,
            entry.dateYmd,
          )
        : [];
    let regrowthEvents =
      entry.regrowthKg > 0
        ? mapRegrowthDetailRowsToZoneEvents(
            regrowthByDate.get(entry.dateYmd) ?? [],
            zoneKey,
            entry.dateYmd,
          )
        : [];

    if (harvestEvents.length === 0 && entry.harvestKg > 0) {
      harvestEvents = [dbSnapshotFallbackHarvestEvent(entry, dbCtx)];
    }
    if (regrowthEvents.length === 0 && entry.regrowthKg > 0) {
      regrowthEvents = [dbSnapshotFallbackRegrowthEvent(entry, dbCtx)];
    }

    return {
      ...entry,
      harvestEvents,
      regrowthEvents,
    };
  });
}
