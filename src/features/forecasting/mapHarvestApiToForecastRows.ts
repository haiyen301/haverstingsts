import { parseISO } from "date-fns";

import { effectiveHarvestDateYmd } from "@/shared/lib/harvestPlanDates";
import { stsProxyGetHarvestingIndex } from "@/shared/api/stsProxyClient";
import { normalizeHarvestTypeStorageKey } from "@/shared/lib/harvestType";
import { computeReadyDateYmdFromPlanRow } from "@/features/forecasting/computeReadyDateFromPlanRow";
import {
  convertPlanRowQuantityToKgFromZones,
  DEFAULT_FALLBACK_MAX_INVENTORY_KG,
} from "@/features/forecasting/forecastingInventoryConversion";
import type { ZoneConfigurationRow } from "@/features/admin/api/adminApi";

import type { ForecastHarvestRow } from "./forecastingTypes";

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
  const farmIdRaw = Number(raw.farm_id);
  const farmId = Number.isFinite(farmIdRaw) ? Math.floor(farmIdRaw) : 0;
  const grassType = String(raw.grass_name ?? "");
  const productIdRaw = Number(raw.product_id);
  const productId = Number.isFinite(productIdRaw) ? Math.floor(productIdRaw) : 0;
  const zone = String(raw.zone ?? "").trim();
  const project = String(raw.project_name ?? raw.project ?? "").trim();
  const customer = String(raw.customer_name ?? raw.customer ?? "").trim();
  const harvestType = detectHarvestType(raw);
  const qty = Number(raw.quantity);
  const quantity = Number.isFinite(qty) ? qty : 0;
  const areaRaw = Number(raw.harvested_area);
  const harvestedAreaM2 = Number.isFinite(areaRaw) ? Math.max(0, areaRaw) : 0;

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
    isReady,
    daysUntilReady,
    uom: resolvePlanRowUom(raw),
    // Giá trị mặc định; sẽ được override ở bước `rowsToMockHarvestRows` nếu có Zone Configuration.
    inventoryKg: quantity,
    inventoryIsCapped: false,
    zoneMaxInventoryKg: DEFAULT_FALLBACK_MAX_INVENTORY_KG,
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
        exclude_empty_zone: 1,
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

  return { rows: out };
}

export function rowsToMockHarvestRows(
  rows: Record<string, unknown>[],
  today = new Date(),
  zoneConfigs?: ZoneConfigurationRow[],
): ForecastHarvestRow[] {
  const list: ForecastHarvestRow[] = [];
  for (const r of rows) {
    const m = harvestApiRowToForecastRow(r, today);
    if (!m) continue;

    if (zoneConfigs && zoneConfigs.length > 0) {
      const { quantityKg, isCapped, maxInventoryKgUsed } = convertPlanRowQuantityToKgFromZones({
        rawPlanRow: r,
        zoneConfigs,
      });
      m.inventoryKg = Number.isFinite(quantityKg) ? quantityKg : m.quantity;
      m.inventoryIsCapped = !!isCapped;
      m.zoneMaxInventoryKg = Number.isFinite(maxInventoryKgUsed)
        ? maxInventoryKgUsed
        : m.zoneMaxInventoryKg;
    }

    list.push(m);
  }
  return list;
}
