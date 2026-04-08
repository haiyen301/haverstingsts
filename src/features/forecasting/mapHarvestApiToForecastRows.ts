import { parseISO } from "date-fns";

import { effectiveHarvestDateYmd } from "@/shared/lib/harvestPlanDates";
import { stsProxyGetHarvestingIndex } from "@/shared/api/stsProxyClient";
import { computeReadyDateYmdFromPlanRow } from "@/features/forecasting/computeReadyDateFromPlanRow";

import type { ForecastHarvestRow } from "./forecastingTypes";

function turfToHarvestType(raw: unknown): "sod" | "sprig" {
  const t = String(raw ?? "")
    .toLowerCase()
    .trim();
  if (t.includes("sprig")) return "sprig";
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
  const grassType = String(raw.grass_name ?? "");
  const harvestType = turfToHarvestType(raw.turf_type);
  const qty = Number(raw.quantity);
  const quantity = Number.isFinite(qty) ? qty : 0;

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
    farm,
    grassType,
    harvestType,
    harvestDate: harvestDateYmd,
    readyDate: readyDateYmd,
    quantity,
    isReady,
    daysUntilReady,
    uom: String(raw.uom ?? "KG").trim() || "KG",
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
): ForecastHarvestRow[] {
  const list: ForecastHarvestRow[] = [];
  for (const r of rows) {
    const m = harvestApiRowToForecastRow(r, today);
    if (m) list.push(m);
  }
  return list;
}
