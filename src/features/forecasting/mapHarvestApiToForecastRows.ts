import { parseISO } from "date-fns";

import { fetchMondayProjectRowsFromServer } from "@/entities/projects";
import {
  effectiveHarvestDateYmd,
  harvestDateStringToYmd,
  isValidHarvestDateString,
} from "@/shared/lib/harvestPlanDates";
import { stsProxyGetHarvestingIndex } from "@/shared/api/stsProxyClient";
import { computeReadyDateYmdFromPlanRow } from "@/features/forecasting/computeReadyDateFromPlanRow";
import { setForecastZoneCatalog } from "@/features/forecasting/zoneKeyNormalization";
import type { FarmZoneReferenceRow } from "@/shared/lib/harvestReferenceData";
import {
  convertPlanRowQuantityToKgFromZones,
  distributePlanRowToZoneFragments,
  forecastZoneBucketKey,
  harvestPlanEffectiveMagnitudeFromRaw,
  harvestPlanHarvestedAreaFromRaw,
  harvestPlanQuantityFromRaw,
  harvestPlanProductIdFromRaw,
  harvestPlanInventoryKgFromRaw,
  harvestPlanScalarFromRaw,
  resolveForecastPlanRowKgPerM2,
  resolvePlanRowHarvestTypeForForecast,
  resolvePlanRowUomFromRaw,
  type ZoneInventoryFragment,
} from "@/features/forecasting/forecastingInventoryConversion";
import type { ZoneConfigurationRow } from "@/features/admin/api/adminApi";
import {
  filterActiveHarvestPlanRows,
  filterActiveZoneConfigurations,
  isStsRecordDeleted,
} from "@/features/forecasting/forecastActiveRecords";

import type { ForecastHarvestRow } from "./forecastingTypes";
import {
  buildRequirementFarmByProjectProduct,
  enrichHarvestRowsWithResolvedFarm,
} from "./resolveHarvestPlanFarm";

/** Plan có cột zone (không trống) xử lý trước để phần no-zone spread thấy headroom đã bị plan có zone chiếm. */
export function compareRawHarvestPlansForNoZoneSpread(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): number {
  const aHas = !!String(a.zone ?? "").trim();
  const bHas = !!String(b.zone ?? "").trim();
  if (aHas !== bHas) return aHas ? -1 : 1;
  return harvestPlanScalarFromRaw(a.id) - harvestPlanScalarFromRaw(b.id);
}

export function recordFragmentsOnUsedByFarmProduct(
  usedByFarmProduct: Map<string, Map<string, number>>,
  farmId: number,
  productId: number,
  fragments: ZoneInventoryFragment[],
) {
  if (farmId <= 0 || productId <= 0) return;
  const fp = `${farmId}|${productId}`;
  const inner = usedByFarmProduct.get(fp) ?? new Map<string, number>();
  for (const frag of fragments) {
    const bk = forecastZoneBucketKey(String(frag.zone ?? "").trim().toLowerCase());
    inner.set(bk, (inner.get(bk) ?? 0) + frag.inventoryKg);
  }
  usedByFarmProduct.set(fp, inner);
}

/** UOM as returned by plan / index JSON (`uom`, `unit`, camelCase variants). */
export function resolvePlanRowUom(raw: Record<string, unknown>): string {
  return resolvePlanRowUomFromRaw(raw);
}

/**
 * Map một dòng `project_harvesting_plan` (API harvesting index) → hàng forecast.
 * `readyDate` theo UOM Kg/M2 như `Grass_forecasting::processRegrowthByUom` (qua grassRegrowthPhp).
 */
export function harvestApiRowToForecastRow(
  raw: Record<string, unknown>,
  today: Date,
  zoneConfigs?: ZoneConfigurationRow[],
): ForecastHarvestRow | null {
  const id = raw.id;
  if (id === undefined || id === null) return null;
  if (isStsRecordDeleted(raw)) return null;

  const harvestDateYmd = effectiveHarvestDateYmd(raw);
  if (!harvestDateYmd) return null;

  const farm = String(raw.farm_name ?? "");
  const farmIdRaw = harvestPlanScalarFromRaw(raw.farm_id);
  const farmId = farmIdRaw > 0 ? Math.floor(farmIdRaw) : 0;
  const grassType = String(raw.grass_name ?? "");
  const productId = harvestPlanProductIdFromRaw(raw);
  const zone = String(raw.zone ?? "").trim();
  const project = String(
    raw.project_name ?? raw.project ?? raw.alias_title ?? raw.title ?? "",
  ).trim();
  const customer = String(
    raw.customer_name ?? raw.customer ?? raw.client_name ?? "",
  ).trim();
  const harvestType = resolvePlanRowHarvestTypeForForecast(raw);
  const uom = resolvePlanRowUom(raw);
  const harvestedAreaM2 = harvestPlanHarvestedAreaFromRaw(raw, {
    zoneConfigs: zoneConfigs ?? [],
  });
  const quantity = harvestPlanEffectiveMagnitudeFromRaw(raw);
  const inventoryKgEst = harvestPlanInventoryKgFromRaw(raw, {
    zoneConfigs: zoneConfigs ?? [],
  });
  const kgPerM2 = resolveForecastPlanRowKgPerM2(raw, harvestType, {
    zoneConfigs: zoneConfigs ?? [],
    harvestedAreaM2,
    inventoryKgEst,
  });

  const readyDateYmd =
    computeReadyDateYmdFromPlanRow(raw, harvestDateYmd) ?? harvestDateYmd;
  const readyD = parseISO(readyDateYmd);
  const isReady = !Number.isNaN(readyD.getTime()) && readyD <= today;
  const daysUntilReady = Number.isNaN(readyD.getTime())
    ? 0
    : isReady
      ? 0
      : Math.ceil(
          (readyD.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
        );

  return {
    id: String(id),
    farmId,
    productId,
    farm,
    grassType,
    zone,
    project,
    customer,
    harvestType,
    harvestDate: harvestDateYmd,
    estimatedHarvestDate: harvestDateStringToYmd(raw.estimated_harvest_date) ?? undefined,
    actualHarvestDate: harvestDateStringToYmd(raw.actual_harvest_date) ?? undefined,
    deliveryDate: harvestDateStringToYmd(raw.delivery_harvest_date) ?? undefined,
    readyDate: readyDateYmd,
    quantity,
    planQuantityRaw: harvestPlanQuantityFromRaw(raw),
    harvestedAreaM2,
    kgPerM2,
    isReady,
    daysUntilReady,
    uom: resolvePlanRowUom(raw),
    // Giá trị mặc định; sẽ được override ở bước `rowsToMockHarvestRows` nếu có Zone Configuration.
    inventoryKg: quantity,
    inventoryIsCapped: false,
    zoneMaxInventoryKg: 0,
    inventoryKgFromNozoneSpread: undefined,
  };
}

/**
 * Lấy toàn bộ dòng harvesting trong khoảng ngày (CASE actual/estimated như PHP).
 * Gọi lặp `page` cho đến khi hết hoặc đạt `maxPages`.
 */
/**
 * Lấy toàn bộ dòng harvesting trong khoảng ngày (CASE actual/estimated như PHP).
 * Page 1 trước; các trang còn lại fetch song song (concurrency 3).
 */
async function fetchHarvestPage(
  page: number,
  params: {
    perPage: number;
    actual_harvest_date_from: string;
    actual_harvest_date_to: string;
    country_id?: string;
  },
): Promise<{
  rows: Record<string, unknown>[];
  isLast: boolean;
  totalPages: number;
}> {
  const q: Record<string, string | number | undefined> = {
    page,
    per_page: params.perPage,
    actual_harvest_date_from: params.actual_harvest_date_from,
    actual_harvest_date_to: params.actual_harvest_date_to,
    exclude_empty_zone: 0,
    forecast_farm_scope: 1,
    view_all_data_module: "forecasting",
  };
  if (params.country_id) q.country_id = params.country_id;

  const res = await stsProxyGetHarvestingIndex(q);
  const batch = res.rows.filter(
    (x): x is Record<string, unknown> =>
      !!x && typeof x === "object" && !Array.isArray(x),
  );
  const totalPages = Math.max(1, res.totalPages);
  const isLast = page >= totalPages || batch.length < params.perPage;
  return { rows: batch, isLast, totalPages };
}

async function fetchHarvestPagesParallel(
  startPage: number,
  endPage: number,
  params: {
    perPage: number;
    actual_harvest_date_from: string;
    actual_harvest_date_to: string;
    country_id?: string;
  },
  concurrency = 3,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let batchStart = startPage; batchStart <= endPage; batchStart += concurrency) {
    const batchEnd = Math.min(batchStart + concurrency - 1, endPage);
    const pages = Array.from({ length: batchEnd - batchStart + 1 }, (_, i) => batchStart + i);
    const results = await Promise.all(pages.map((page) => fetchHarvestPage(page, params)));
    for (const result of results) {
      out.push(...result.rows);
    }
    if (results.some((r) => r.isLast)) break;
  }
  return out;
}

export async function fetchHarvestRowsForForecasting(params: {
  actual_harvest_date_from: string;
  actual_harvest_date_to: string;
  country_id?: string;
  perPage?: number;
  maxPages?: number;
  /** STS farm reference rows for resolving `farm_name` after grass-requirement fallback. */
  farms?: unknown[];
  /** When false, skip reading farm from project grass requirements. Default: true. */
  resolveFarmFromGrassRequirements?: boolean;
}): Promise<{ rows: Record<string, unknown>[]; error?: string }> {
  const perPage = params.perPage ?? 200;
  const maxPages = params.maxPages ?? 50;

  try {
    const first = await fetchHarvestPage(1, {
      perPage,
      actual_harvest_date_from: params.actual_harvest_date_from,
      actual_harvest_date_to: params.actual_harvest_date_to,
      country_id: params.country_id,
    });
    const out = [...first.rows];
    const lastPageToFetch = Math.min(first.totalPages, maxPages);
    if (lastPageToFetch > 1) {
      const rest = await fetchHarvestPagesParallel(2, lastPageToFetch, {
        perPage,
        actual_harvest_date_from: params.actual_harvest_date_from,
        actual_harvest_date_to: params.actual_harvest_date_to,
        country_id: params.country_id,
      });
      out.push(...rest);
    }

    const resolveFarm = params.resolveFarmFromGrassRequirements !== false;
    const needsGrassFarmFallback =
      resolveFarm &&
      out.some(
        (r) =>
          harvestPlanScalarFromRaw(r.farm_id) <= 0 &&
          String(r.project_id ?? "").trim() !== "",
      );

    const activeRows = filterActiveHarvestPlanRows(out);

    if (!needsGrassFarmFallback) {
      return { rows: activeRows };
    }

    try {
      const projectRes = await fetchMondayProjectRowsFromServer({ page: 1, perPage: 500 });
      const requirementFarmByProjectProduct = buildRequirementFarmByProjectProduct(
        projectRes.rows,
      );
      if (requirementFarmByProjectProduct.size === 0) {
        return { rows: activeRows };
      }
      return {
        rows: filterActiveHarvestPlanRows(
          enrichHarvestRowsWithResolvedFarm(
            activeRows,
            requirementFarmByProjectProduct,
            params.farms ?? [],
          ),
        ),
      };
    } catch {
      return { rows: activeRows };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load harvesting data";
    return { rows: [], error: msg };
  }
}

export function rowsToMockHarvestRows(
  rows: Record<string, unknown>[],
  today = new Date(),
  zoneConfigs?: ZoneConfigurationRow[],
  farmZones?: FarmZoneReferenceRow[],
): ForecastHarvestRow[] {
  if (farmZones?.length) {
    setForecastZoneCatalog(farmZones);
  }
  const list: ForecastHarvestRow[] = [];
  const usedByFarmProduct = new Map<string, Map<string, number>>();
  const orderedRows =
    zoneConfigs && zoneConfigs.length > 0
      ? [...rows].sort(compareRawHarvestPlansForNoZoneSpread)
      : rows;

  for (const r of orderedRows) {
    const m = harvestApiRowToForecastRow(r, today, zoneConfigs);
    if (!m) continue;

    if (zoneConfigs && zoneConfigs.length > 0) {
      /** Plan không gán zone: phân bổ qua `distributePlanRowToZoneFragments` (forecastingInventoryConversion). Regrowth UI: `computeRegrowthAllocationForFarmProductDate` (regrowthAllocation.ts). */
      const fp = `${m.farmId}|${m.productId}`;
      const prior = new Map(usedByFarmProduct.get(fp) ?? []);
      const fragments = distributePlanRowToZoneFragments({
        rawPlanRow: r,
        zoneConfigs,
        priorUsedKgByZoneBucket: prior,
      });
      fragments.forEach((frag, idx) => {
        const row: ForecastHarvestRow = {
          ...m,
          id: fragments.length === 1 ? m.id : `${m.id}~z${idx}`,
          zone: frag.zone,
          inventoryKg: frag.inventoryKg,
          inventoryIsCapped: frag.inventoryIsCapped,
          zoneMaxInventoryKg: frag.zoneMaxInventoryKg,
          inventoryKgFromNozoneSpread:
            frag.inventoryKgFromNozoneSpread && frag.inventoryKgFromNozoneSpread > 0
              ? frag.inventoryKgFromNozoneSpread
              : undefined,
        };
        list.push(row);
      });
      recordFragmentsOnUsedByFarmProduct(usedByFarmProduct, m.farmId, m.productId, fragments);
    } else {
      const { quantityKg, isCapped, maxInventoryKgUsed } = convertPlanRowQuantityToKgFromZones({
        rawPlanRow: r,
        zoneConfigs: [],
      });
      m.inventoryKg = Number.isFinite(quantityKg) ? Math.max(0, quantityKg) : 0;
      m.inventoryIsCapped = !!isCapped;
      m.zoneMaxInventoryKg = Number.isFinite(maxInventoryKgUsed)
        ? maxInventoryKgUsed
        : m.zoneMaxInventoryKg;
      list.push(m);
    }
  }
  return list;
}

/** Single entry to map API plans → forecast rows (m²→kg, zone id, Sod quantity fallback). */
export function buildForecastRowsFromHarvestRaw(
  harvestRowsRaw: Record<string, unknown>[] | null | undefined,
  zoneConfigs: ZoneConfigurationRow[] | null | undefined,
  today = new Date(),
  farmZones?: FarmZoneReferenceRow[],
): ForecastHarvestRow[] {
  if (!harvestRowsRaw?.length) return [];
  const activeHarvest = filterActiveHarvestPlanRows(harvestRowsRaw);
  const activeZones = filterActiveZoneConfigurations(zoneConfigs ?? []);
  return rowsToMockHarvestRows(activeHarvest, today, activeZones, farmZones);
}
