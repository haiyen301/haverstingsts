import {
  processRegrowthItemPhp,
  parseHarvestDateM2Php,
  parseHarvestDateKgLoosePhp,
  type GrassUomPhp,
  type RegrowthDailyItemPhp,
} from "@/shared/lib/grassRegrowthPhp";
import { isValidHarvestDateString } from "@/shared/lib/harvestPlanDates";

/** Số tháng cộng cho M2 trên plan (khớp bản tính tay trước đây: +1 tháng). */
const DEFAULT_MONTHS_M2_PLAN = 1;

function rawUomToGrassUom(raw: Record<string, unknown>): GrassUomPhp {
  const u = String(raw.uom ?? "")
    .trim()
    .toUpperCase();
  return u === "M2" ? "M2" : "Kg";
}

/**
 * Chuẩn hoá `Y-m-d` cho `processRegrowthItemPhp`:
 * M2 ưu tiên strict; fallback loose (giữ hành vi cũ).
 */
function normalizeHarvestYmdForPlanRow(
  harvestYmd: string,
  grassUom: GrassUomPhp,
): string | null {
  if (grassUom === "M2") {
    const strict = parseHarvestDateM2Php(harvestYmd);
    if (strict) return strict.date;
    const loose = parseHarvestDateKgLoosePhp(harvestYmd);
    return loose?.date ?? null;
  }
  const loose = parseHarvestDateKgLoosePhp(harvestYmd);
  return loose?.date ?? null;
}

/**
 * Ngày regrowth xong — **gọi trực tiếp** `processRegrowthItemPhp` (cùng nhánh
 * `Grass_forecasting::processRegrowthByUom`), không nhân đôi công thức.
 */
export function computeReadyDateYmdFromPlanRow(
  raw: Record<string, unknown>,
  harvestYmd: string,
): string | null {
  const grassUom = rawUomToGrassUom(raw);
  const dateNorm = normalizeHarvestYmdForPlanRow(harvestYmd, grassUom);
  if (!dateNorm) return null;

  const item: RegrowthDailyItemPhp = {
    date: dateNorm,
    quantity: Number(raw.quantity ?? 0),
    has_actual_harvest_date: isValidHarvestDateString(raw.actual_harvest_date),
    harvested_area: Number(raw.harvested_area ?? 0),
  };

  const startingOfRegowthKg: Record<string, number> = {};
  const res = processRegrowthItemPhp(
    item,
    grassUom,
    DEFAULT_MONTHS_M2_PLAN,
    startingOfRegowthKg,
  );
  if (!res.ok) return null;
  return res.regrowthDateStr;
}
