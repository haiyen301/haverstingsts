import type { ForecastDayDetailRow } from "@/features/forecasting/forecastSnapshotApi";

export type RegrowthScheduleEntry = {
  dateYmd: string;
  days: number;
  harvestType: string;
};

export type DevForecastCalendarHarvestPlan = {
  planId: string;
  project: string;
  customer: string;
  harvestType: string;
  rawQty: number;
  rawUom: string;
  kg: number;
  zones: string[];
  regrowthDates: string[];
  regrowthSchedule: RegrowthScheduleEntry[];
};

export type SourceAuditRow = {
  planId: string;
  forecastRowIds: string[];
  project: string;
  customer: string;
  doSoNumber: string;
  farm: string;
  farmId: number;
  grass: string;
  productId: number;
  harvestType: string;
  harvestDate: string;
  harvestDateSource: string;
  regrowthDate: string;
  regrowthDays: number;
  dbZone: string;
  mappedZones: string[];
  rawQty: number;
  rawUom: string;
  m2ConversionRows: {
    forecastRowId: string;
    zoneLabel: string;
    rawM2: number;
    inputM2: number;
    kgPerM2: number;
    multipliedKg: number;
    normalizedKg: number;
    maxKg: number;
    configSizeM2: number;
    configSizeCapacityKg: number;
    configIds: string[];
    configCount: number;
    sourceNote: string;
    overMaxKg: number;
  }[];
  normalizedKg: number;
  creditedKg: number;
  notCountedKg: number;
  spreadKg: number;
  hasCappedFragment: boolean;
  notes: string[];
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  return String(v ?? "").trim();
}

export function mapHarvestDetailRowsToPlans(
  rows: ForecastDayDetailRow[],
): DevForecastCalendarHarvestPlan[] {
  const byPlan = new Map<string, DevForecastCalendarHarvestPlan>();

  for (const row of rows) {
    const planId = str(row.plan_id) || str(row.fragment_id);
    if (!planId) continue;

    const kg = num(row.inventory_kg);
    const zone = str(row.zone) || "nozone";
    const existing = byPlan.get(planId);
    if (!existing) {
      byPlan.set(planId, {
        planId,
        project: str(row.project),
        customer: str(row.customer),
        harvestType: str(row.type),
        rawQty: num(row.qty),
        rawUom: str(row.uom) || "kg",
        kg,
        zones: [zone],
        regrowthDates: [],
        regrowthSchedule: [],
      });
      continue;
    }

    existing.kg += kg;
    if (!existing.zones.includes(zone)) existing.zones.push(zone);
    if (!existing.harvestType && str(row.type)) existing.harvestType = str(row.type);
    if (!existing.project && str(row.project)) existing.project = str(row.project);
  }

  return Array.from(byPlan.values()).sort((a, b) => b.kg - a.kg || a.planId.localeCompare(b.planId));
}

export function enrichHarvestPlansWithRegrowthSchedules(
  harvestByDate: Map<string, DevForecastCalendarHarvestPlan[]>,
  regrowthByDate: Map<string, SourceAuditRow[]>,
): Map<string, DevForecastCalendarHarvestPlan[]> {
  const scheduleByHarvestDayPlan = new Map<string, RegrowthScheduleEntry[]>();

  for (const sources of regrowthByDate.values()) {
    for (const src of sources) {
      if (!src.harvestDate || !src.planId) continue;
      const key = `${src.harvestDate}|${src.planId}`;
      const entry: RegrowthScheduleEntry = {
        dateYmd: src.regrowthDate,
        days: src.regrowthDays,
        harvestType: src.harvestType || "Sprig",
      };
      const list = scheduleByHarvestDayPlan.get(key) ?? [];
      if (!list.some((e) => e.dateYmd === entry.dateYmd && e.days === entry.days)) {
        list.push(entry);
        scheduleByHarvestDayPlan.set(key, list);
      }
    }
  }

  const out = new Map<string, DevForecastCalendarHarvestPlan[]>();
  for (const [harvestDay, plans] of harvestByDate) {
    out.set(
      harvestDay,
      plans.map((plan) => {
        const schedule = scheduleByHarvestDayPlan.get(`${harvestDay}|${plan.planId}`) ?? [];
        if (schedule.length === 0) return plan;
        return {
          ...plan,
          regrowthDates: schedule.map((e) => e.dateYmd),
          regrowthSchedule: [...schedule].sort((a, b) => a.dateYmd.localeCompare(b.dateYmd)),
        };
      }),
    );
  }
  return out;
}

export function mapRegrowthDetailRowsToSources(rows: ForecastDayDetailRow[]): SourceAuditRow[] {
  return rows.map((row) => {
    const planId = str(row.plan_id) || str(row.fragment_id);
    const m2Line = str(row.zone_config_line);
    const m2ConversionRows =
      m2Line && num(row.gross_kg) > 0
        ? [
            {
              forecastRowId: str(row.fragment_id),
              zoneLabel: str(row.zone),
              rawM2: num(row.area_m2),
              inputM2: num(row.area_m2),
              kgPerM2: num(row.kg_per_m2),
              multipliedKg: num(row.gross_kg),
              normalizedKg: num(row.gross_kg),
              maxKg: num(row.zone_max_kg),
              configSizeM2: 0,
              configSizeCapacityKg: 0,
              configIds: [],
              configCount: 0,
              sourceNote: m2Line,
              overMaxKg: num(row.not_credited_kg),
            },
          ]
        : [];

    const notes: string[] = [];
    const m2Note = str(row.m2_conversion_note);
    const rule = str(row.regrowth_rule);
    const overNote = str(row.overlimit_note);
    if (rule) notes.push(rule);
    if (m2Note) notes.push(m2Note);
    else if (m2ConversionRows.length === 0 && num(row.gross_kg) > 0) {
      notes.push("inventory kg, no m2 zone conversion");
    }
    if (overNote) notes.push(overNote);
    if (num(row.not_credited_kg) > 0 && !overNote) {
      notes.push("Fragment exceeds configured capacity");
    }

    return {
      planId,
      forecastRowIds: [str(row.fragment_id)].filter(Boolean),
      project: str(row.project),
      customer: "",
      doSoNumber: str(row.do_so_number),
      farm: str(row.farm),
      farmId: num(row.farm_id),
      grass: str(row.grass),
      productId: num(row.product_id),
      harvestType: str(row.type),
      harvestDate: str(row.harvest_date).slice(0, 10),
      harvestDateSource: str(row.harvest_date_source) || "harvestDate",
      regrowthDate: str(row.regrowth_date).slice(0, 10),
      regrowthDays: num(row.regrowth_days),
      dbZone: str(row.db_zone) || str(row.zone),
      mappedZones: [str(row.zone)].filter(Boolean),
      rawQty: num(row.qty),
      rawUom: str(row.uom),
      m2ConversionRows,
      normalizedKg: num(row.gross_kg),
      creditedKg: num(row.credited_kg),
      notCountedKg: num(row.not_credited_kg),
      spreadKg: 0,
      hasCappedFragment: num(row.not_credited_kg) > 0,
      notes,
    };
  });
}
