/**
 * Debug: mirror inventoryForecastView.tsx chart compute against live API.
 * Run from stsrenew: npx tsx scripts/forecast-parity-debug.ts
 */
import {
  filterActiveRegrowthRules,
  filterActiveZoneConfigurations,
} from "../src/features/forecasting/forecastActiveRecords";
import { computeInventoryStyleFarmGrassDailySeriesWithBreakdown } from "../src/features/forecasting/forecastAvailableAtDate";
import {
  applyLatestZoneMaxKgToForecastRows,
  distributePlanRowToZoneFragments,
} from "../src/features/forecasting/forecastingInventoryConversion";
import { resolveRegrowthReferenceConfigFromRules } from "../src/features/forecasting/forecastingRegrowth";
import { buildForecastRowsFromHarvestRaw, compareRawHarvestPlansForNoZoneSpread, recordFragmentsOnUsedByFarmProduct } from "../src/features/forecasting/mapHarvestApiToForecastRows";
import { harvestPlanProductIdFromRaw, harvestPlanScalarFromRaw } from "../src/features/forecasting/forecastingInventoryConversion";
import type { ZoneConfigurationRow } from "../src/features/admin/api/adminApi";
import type { RegrowthRuleRow } from "../src/features/admin/api/adminApi";
import type { InventoryBalanceRow } from "../src/features/admin/api/adminApi";
import {
  inventoryBalanceOverrideStorageKey,
  normalizeInventoryBalanceDateYmd,
  type InventoryAvailableOverrideEntry,
} from "../src/shared/store/inventoryAvailableOverrideStore";
import { forecastZoneKeyFromParts } from "../src/features/forecasting/inventoryRegrowthCalculator";
import {
  buildGrassCatalogById,
  collectHiddenGrassIdsForCatalogOnDateRange,
  isGrassProductVisibleInCatalogOnDate,
} from "../src/shared/lib/harvestReferenceData";
import { kpiDateRangeFromFilter } from "../src/shared/lib/dashboardKpiProjectFilters";
import { filterActiveHarvestPlanRows } from "../src/features/forecasting/forecastActiveRecords";

const TOKEN =
  "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3ODE1ODM4NjcsImV4cCI6MTc4MTY3MDI2NywiZGF0YSI6eyJlbWFpbCI6InRoaS5uZ3V5ZW5Ac3BvcnRzdHVyZnNvbHV0aW9ucy5jb20ifX0.WzIl_yp_as8-PSn_9JJ6FZZpmoPMbmZ2iJMiFsXi6UM";
const BASE = "http://192.168.0.159/api";
const TARGET = "2026-06-16";
const EXPECTED_AVAILABLE = 4160539;
const EXPECTED_MAX = 4632706;

function parseYmdLocal(ymd: string): Date | null {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

async function getJson(path: string, params?: Record<string, string>) {
  const url = new URL(`${BASE}/${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    headers: { Authorization: TOKEN, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

function rowsFromJson(json: Record<string, unknown>): Record<string, unknown>[] {
  const raw = json.rows ?? json.data;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
}

function mapBalanceRows(rows: InventoryBalanceRow[]): Record<string, InventoryAvailableOverrideEntry> {
  const next: Record<string, InventoryAvailableOverrideEntry> = {};
  for (const row of rows) {
    const dateYmd = normalizeInventoryBalanceDateYmd(row.balance_date);
    const zoneKey = forecastZoneKeyFromParts(
      Number(row.farm_id) || 0,
      String(row.zone ?? ""),
      Number(row.grass_id) || 0,
    );
    if (!zoneKey || !dateYmd) continue;
    const entry: InventoryAvailableOverrideEntry = {
      id: Number(row.id) || 0,
      zoneKey,
      zoneConfigurationId:
        row.zone_configuration_id == null ? null : Number(row.zone_configuration_id),
      farmId: Number(row.farm_id) || 0,
      grassId: Number(row.grass_id) || 0,
      farmName: String(row.farm_name ?? "").trim(),
      turfgrass: String(row.turfgrass ?? "").trim(),
      zone: String(row.zone ?? "").trim(),
      availableKg: Number(row.available_kg) || 0,
      calculatedKg:
        row.calculated_kg == null || row.calculated_kg === ""
          ? 0
          : Number(row.calculated_kg) || 0,
      date: dateYmd,
      updatedAt: String(row.updated_at ?? row.created_at ?? "").trim(),
    };
    next[inventoryBalanceOverrideStorageKey(zoneKey, dateYmd)] = entry;
  }
  return next;
}

async function fetchAllHarvest(): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const from = "2024-06-16";
  const to = "2028-12-16";
  let page = 1;
  let totalPages = 1;
  do {
    const json = await getJson("harvesting/", {
      page: String(page),
      per_page: "200",
      actual_harvest_date_from: from,
      actual_harvest_date_to: to,
      exclude_empty_zone: "0",
      forecast_farm_scope: "1",
    });
    out.push(...rowsFromJson(json));
    totalPages = Math.max(1, Number(json.total) || 1);
    page++;
  } while (page <= totalPages && page <= 50);
  return filterActiveHarvestPlanRows(out);
}

async function main() {
  const today = parseYmdLocal(TARGET)!;
  const range = kpiDateRangeFromFilter({ preset: "next3Months" });
  const horizonEnd = parseYmdLocal(range.end) ?? addMonths(today, 3);

  const [harvestRows, zoneJson, rulesJson, balanceJson, grassesJson] = await Promise.all([
    fetchAllHarvest(),
    getJson("zone_configurations/"),
    getJson("regrowth_rules/"),
    getJson("inventory_balance/"),
    getJson("grasses/"),
  ]);

  const zoneConfigs = filterActiveZoneConfigurations(
    rowsFromJson(zoneJson) as unknown as ZoneConfigurationRow[],
  );
  const regrowthConfig = resolveRegrowthReferenceConfigFromRules(
    filterActiveRegrowthRules(rowsFromJson(rulesJson) as unknown as RegrowthRuleRow[]),
  );
  const overrides = mapBalanceRows(rowsFromJson(balanceJson) as unknown as InventoryBalanceRow[]);
  const grasses = rowsFromJson(grassesJson);
  const hiddenGrassIdSet = new Set(
    collectHiddenGrassIdsForCatalogOnDateRange(grasses, range.start, range.end),
  );
  const grassCatalogById = buildGrassCatalogById(grasses);

  const mapped = buildForecastRowsFromHarvestRaw(harvestRows, zoneConfigs, today);
  let emptyFrags = 0;
  let totalFrags = 0;
  const usedByFarmProduct = new Map<string, Map<string, number>>();
  const ordered = [...harvestRows].sort(compareRawHarvestPlansForNoZoneSpread);
  for (const r of ordered) {
    const farmId = Number(r.farm_id) || 0;
    const productId = Number(r.product_id ?? r.grass_id ?? 0) || 0;
    const fp = `${farmId}|${productId}`;
    const prior = new Map(usedByFarmProduct.get(fp) ?? []);
    const frags = distributePlanRowToZoneFragments({
      rawPlanRow: r,
      zoneConfigs,
      priorUsedKgByZoneBucket: prior,
    });
    totalFrags += frags.length;
    if (frags.length === 0) emptyFrags++;
    recordFragmentsOnUsedByFarmProduct(usedByFarmProduct, farmId, productId, frags);
  }
  const rowsWithCaps = applyLatestZoneMaxKgToForecastRows(mapped, zoneConfigs);
  const filteredRows = rowsWithCaps.filter((r) => {
    if (hiddenGrassIdSet.has(String(r.productId))) return false;
    const refYmd = String(r.deliveryDate ?? r.estimatedHarvestDate ?? r.harvestDate ?? "")
      .trim()
      .slice(0, 10);
    if (!isGrassProductVisibleInCatalogOnDate(r.productId, grassCatalogById, refYmd)) {
      return false;
    }
    return true;
  });

  const farmProductFilter = (farmId: number, productId: number) =>
    !hiddenGrassIdSet.has(String(productId));

  const series = computeInventoryStyleFarmGrassDailySeriesWithBreakdown(
    filteredRows,
    zoneConfigs,
    regrowthConfig,
    overrides,
    today,
    horizonEnd,
    farmProductFilter,
  );

  const day = series.aggregate.find((d) => d.date === TARGET);

  console.log(
    JSON.stringify(
      {
        harvestRaw: harvestRows.length,
        mapped: mapped.length,
        emptyFrags,
        totalFrags,
        filtered: filteredRows.length,
        hiddenGrass: hiddenGrassIdSet.size,
        horizonEnd: range.end,
        target: TARGET,
        available: day ? Math.round(day.availableKg) : null,
        expectedAvailable: EXPECTED_AVAILABLE,
        expectedMax: EXPECTED_MAX,
        breakdown: day
          ? {
              prev: Math.round(day.previousAvailableKg),
              regrowth: Math.round(day.regrowthKg),
              harvest: Math.round(day.harvestKg),
              raw: Math.round(day.rawAvailableKg),
              cap: Math.round(day.capacityCapKg),
            }
          : null,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
