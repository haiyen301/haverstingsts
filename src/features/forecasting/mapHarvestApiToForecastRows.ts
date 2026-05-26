import { parseISO } from "date-fns";

import { fetchMondayProjectRowsFromServer } from "@/entities/projects";
import { effectiveHarvestDateYmd } from "@/shared/lib/harvestPlanDates";
import { stsProxyGetHarvestingIndex } from "@/shared/api/stsProxyClient";
import { normalizeHarvestTypeStorageKey } from "@/shared/lib/harvestType";
import { computeReadyDateYmdFromPlanRow } from "@/features/forecasting/computeReadyDateFromPlanRow";
import {
  convertPlanRowQuantityToKgFromZones,
  DEFAULT_FALLBACK_MAX_INVENTORY_KG,
  distributePlanRowToZoneFragments,
  forecastZoneBucketKey,
  harvestPlanProductIdFromRaw,
  harvestPlanQuantityFromRaw,
  harvestPlanScalarFromRaw,
  harvestQuantityCellPresent,
  type ZoneInventoryFragment,
} from "@/features/forecasting/forecastingInventoryConversion";
import type { ZoneConfigurationRow } from "@/features/admin/api/adminApi";

import type { ForecastHarvestRow } from "./forecastingTypes";
import {
  buildRequirementFarmByProjectProduct,
  enrichHarvestRowsWithResolvedFarm,
} from "./resolveHarvestPlanFarm";

/** Plan có cột zone (không trống) xử lý trước để phần no-zone spread thấy headroom đã bị plan có zone chiếm. */
function compareRawHarvestPlansForNoZoneSpread(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): number {
  const aHas = !!String(a.zone ?? "").trim();
  const bHas = !!String(b.zone ?? "").trim();
  if (aHas !== bHas) return aHas ? -1 : 1;
  return harvestPlanScalarFromRaw(a.id) - harvestPlanScalarFromRaw(b.id);
}

function recordFragmentsOnUsedByFarmProduct(
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
  const keys = [
    "uom",
    "UOM",
    "unit",
    "Unit",
    "quantity_uom",
    "quantityUom",
  ] as const;
  for (const k of keys) {
    const v = raw[k];
    const s = String(v ?? "").trim();
    if (s) return s;
  }
  return "";
}

function detectHarvestType(
  raw: Record<string, unknown>,
): "sod" | "sprig" | "sod_for_sprig" {
  const candidates = [raw.harvest_type, raw.load_type, raw.turf_type, raw.type];
  const normalized = candidates
    .map((v) => normalizeHarvestTypeStorageKey(v))
    .find(Boolean);
  if (normalized === "sod_to_sprig") return "sod_for_sprig";
  if (normalized === "sprig") return "sprig";
  if (normalized === "sod") return "sod";

  const uom = resolvePlanRowUom(raw).toLowerCase();
  if (uom === "kg" || uom === "kgs" || uom === "kilogram" || uom === "kilograms") {
    return "sprig";
  }

  return "sod";
}

/**
 * Map một dòng `project_harvesting_plan` (API harvesting index) → hàng forecast.
 * `readyDate` theo UOM Kg/M2 như `Grass_forecasting::processRegrowthByUom` (qua grassRegrowthPhp).
 */
export function harvestApiRowToForecastRow(
  raw: Record<string, unknown>,
  today: Date,
): ForecastHarvestRow | null {
  const id = raw.id;
  if (id === undefined || id === null) return null;

  const harvestDateYmd = effectiveHarvestDateYmd(raw);
  if (!harvestDateYmd) return null;

  const farm = String(raw.farm_name ?? "");
  const farmIdRaw = harvestPlanScalarFromRaw(raw.farm_id);
  const farmId = farmIdRaw > 0 ? Math.floor(farmIdRaw) : 0;
  const grassType = String(raw.grass_name ?? "");
  const productId = harvestPlanProductIdFromRaw(raw);
  const zone = String(raw.zone ?? "").trim();
  const project = String(raw.project_name ?? raw.project ?? "").trim();
  const customer = String(raw.customer_name ?? raw.customer ?? "").trim();
  const harvestType = detectHarvestType(raw);
  const quantity = harvestPlanQuantityFromRaw(raw);
  const harvestedAreaM2 = harvestQuantityCellPresent(raw.harvested_area)
    ? Math.max(0, harvestPlanScalarFromRaw(raw.harvested_area))
    : 0;
  const kgPerM2Raw = Number(raw.kg_per_m2);
  const kgPerM2 =
    Number.isFinite(kgPerM2Raw) && kgPerM2Raw > 0
      ? kgPerM2Raw
      : harvestedAreaM2 > 0
        ? quantity / harvestedAreaM2
        : 0;

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
    readyDate: readyDateYmd,
    quantity,
    harvestedAreaM2,
    kgPerM2,
    isReady,
    daysUntilReady,
    uom: resolvePlanRowUom(raw),
    // Giá trị mặc định; sẽ được override ở bước `rowsToMockHarvestRows` nếu có Zone Configuration.
    inventoryKg: quantity,
    inventoryIsCapped: false,
    zoneMaxInventoryKg: DEFAULT_FALLBACK_MAX_INVENTORY_KG,
    inventoryKgFromNozoneSpread: undefined,
  };
}

/**
 * Lấy toàn bộ dòng harvesting trong khoảng ngày (CASE actual/estimated như PHP).
 * Gọi lặp `page` cho đến khi hết hoặc đạt `maxPages`.
 */
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
  const out: Record<string, unknown>[] = [];

  for (let page = 1; page <= maxPages; page++) {
    try {
      const q: Record<string, string | number | undefined> = {
        page,
        per_page: perPage,
        actual_harvest_date_from: params.actual_harvest_date_from,
        actual_harvest_date_to: params.actual_harvest_date_to,
        /** Include plans with blank zone so we can allocate them across configured zones / `nozone`. */
        exclude_empty_zone: 0,
        /**
         * STSPortal `Project_harvesting_plan_model::_build_created_by_scope_where`:
         * all plans on farms assigned to the user (not only `created_by` = self), so regrowth totals
         * match farm reality (e.g. multiple plan ids same day / grass).
         */
        forecast_farm_scope: 1,
      };
      if (params.country_id) q.country_id = params.country_id;

      const res = await stsProxyGetHarvestingIndex(q);
      const batch = res.rows.filter(
        (x): x is Record<string, unknown> =>
          !!x && typeof x === "object" && !Array.isArray(x),
      );
      out.push(...batch);
      if (batch.length < perPage) break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load harvesting data";
      return { rows: out, error: msg };
    }
  }

  const resolveFarm = params.resolveFarmFromGrassRequirements !== false;
  const needsGrassFarmFallback =
    resolveFarm &&
    out.some(
      (r) =>
        harvestPlanScalarFromRaw(r.farm_id) <= 0 &&
        String(r.project_id ?? "").trim() !== "",
    );

  if (!needsGrassFarmFallback) {
    return { rows: out };
  }

  try {
    const projectRes = await fetchMondayProjectRowsFromServer({ page: 1, perPage: 500 });
    const requirementFarmByProjectProduct = buildRequirementFarmByProjectProduct(
      projectRes.rows,
    );
    if (requirementFarmByProjectProduct.size === 0) {
      return { rows: out };
    }
    return {
      rows: enrichHarvestRowsWithResolvedFarm(
        out,
        requirementFarmByProjectProduct,
        params.farms ?? [],
      ),
    };
  } catch {
    return { rows: out };
  }
}

export function rowsToMockHarvestRows(
  rows: Record<string, unknown>[],
  today = new Date(),
  zoneConfigs?: ZoneConfigurationRow[],
): ForecastHarvestRow[] {
  const list: ForecastHarvestRow[] = [];
  const usedByFarmProduct = new Map<string, Map<string, number>>();
  const orderedRows =
    zoneConfigs && zoneConfigs.length > 0
      ? [...rows].sort(compareRawHarvestPlansForNoZoneSpread)
      : rows;

  for (const r of orderedRows) {
    const m = harvestApiRowToForecastRow(r, today);
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
      m.inventoryKg = Number.isFinite(quantityKg) ? quantityKg : m.quantity;
      m.inventoryIsCapped = !!isCapped;
      m.zoneMaxInventoryKg = Number.isFinite(maxInventoryKgUsed)
        ? maxInventoryKgUsed
        : m.zoneMaxInventoryKg;
      list.push(m);
    }
  }
  return list;
}
