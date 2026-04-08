import {
  addMonthsPhp,
  getDayRegrowthByKgPhp,
  safeDivideStrictPhp,
} from "@/shared/lib/grassRegrowthPhp";
import { isValidHarvestDateString } from "@/shared/lib/harvestPlanDates";

/**
 * Có thể dùng `actual_harvest_date` cho nhánh “ngày + tháng”: parse được `Y-m-d` hợp lệ
 * (cùng điều kiện với `lastDayOfMonthInfoFromActualHarvestDate` ≠ null).
 */
export function hasActualHarvestDate(raw: Record<string, unknown>): boolean {
  return lastDayOfMonthInfoFromActualHarvestDate(raw.actual_harvest_date) !== null;
}

export type LastDayOfMonthInfo = {
  /** Chuỗi `Y-m-d` của ngày cuối tháng (vd. `2026-04-30`). */
  ymd: string;
  /** Số ngày trong tháng đó (28–31) — cùng giá trị với “ngày” của ngày cuối tháng. */
  daysInMonth: number;
};

export type RegrowthDateAfterAdd = {
  ymd: string;
  month: number;
  year: number;
};

export type MonthCompareResult = "same_month" | "different_month";
export type RegrowthPreviewRow = {
  id: string | number | null;
  product_id: number | null;
  farm_id: number | null;
  farm_name: string;
  actualHarvestDateYmd: string;
  uom: "KG" | "M2";
  kgPerM2: number;
  regrowthDays: number | null;
  lastDayOfActualHarvestMonthYmd: string;
  daysInActualHarvestMonth: number;
  regrowthQuantity: number;
  regrowthDateYmd: string;
  regrowthMonth: number;
  regrowthYear: number;
  monthCompare: MonthCompareResult;
};

export type RegrowthMonthlyMergedRow = {
  monthKey: string; // YYYY-MM
  year: number;
  month: number;
  totalKg: number;
  totalM2: number;
  items: RegrowthPreviewRow[];
};

export type HarvestMonthlyMergedRow = {
  monthKey: string; // YYYY-MM
  year: number;
  month: number;
  harvestedKg: number;
  harvestedM2: number;
  items: Record<string, unknown>[];
};

export type MonthlyAvailabilityRow = {
  monthKey: string; // YYYY-MM
  year: number;
  month: number;
  startingKg: number;
  startingM2: number;
  regrowthKg: number;
  regrowthM2: number;
  harvestedKg: number;
  harvestedM2: number;
  availableKg: number;
  availableM2: number;
};

export type ProductMonthlyAvailabilityRow = {
  productId: number;
  monthKey: string; // YYYY-MM
  year: number;
  month: number;
  startingKg: number;
  startingM2: number;
  regrowthKg: number;
  regrowthM2: number;
  harvestedKg: number;
  harvestedM2: number;
  availableKg: number;
  availableM2: number;
};

export type ProductMonthlyAvailabilityOptions = {
  fromYmd?: string;
  toYmd?: string;
  year?: number;
};

export type YmdDateParts = {
  day: number;
  month: number;
  year: number;
};

/**
 * Thông tin ngày cuối tháng chứa `actual_harvest_date`, hoặc `null` nếu không parse được.
 * Ví dụ `2026-04-12` → `{ ymd: '2026-04-30', daysInMonth: 30 }`.
 */
export function lastDayOfMonthInfoFromActualHarvestDate(
  actual: unknown,
): LastDayOfMonthInfo | null {
  if (!isValidHarvestDateString(actual)) return null;
  const s = String(actual).trim().slice(0, 10);
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!parts) return null;
  const y = Number(parts[1]);
  const m = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return null;
  }
  const daysInMonth = new Date(y, m, 0).getDate();
  const ymd = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;
  return { ymd, daysInMonth };
}

/**
 * Ngày cuối cùng của **tháng** chứa `actual_harvest_date` (`Y-m-d`), hoặc `null` nếu không parse được.
 */
export function lastDayOfMonthYmdFromActualHarvestDate(
  actual: unknown,
): string | null {
  return lastDayOfMonthInfoFromActualHarvestDate(actual)?.ymd ?? null;
}

/**
 * Chỉ **số ngày** trong tháng của `actual_harvest_date` (28–31), hoặc `null`.
 */
export function daysInMonthFromActualHarvestDate(
  actual: unknown,
): number | null {
  return lastDayOfMonthInfoFromActualHarvestDate(actual)?.daysInMonth ?? null;
}

/**
 * Parse chuỗi ngày dạng `yyyy-MM-dd` và trả về `{ day, month, year }`.
 * Trả `null` nếu không đúng định dạng hoặc ngày không hợp lệ.
 */
export function parseYmdToDateParts(value: unknown): YmdDateParts | null {
  if (!isValidHarvestDateString(value)) return null;
  const s = String(value).trim().slice(0, 10);
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!parts) return null;
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const check = new Date(year, month - 1, day);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    check.getFullYear() !== year ||
    check.getMonth() + 1 !== month ||
    check.getDate() !== day
  ) {
    return null;
  }
  return { day, month, year };
}

/**
 * Cộng số ngày regrowth vào actual_harvest_date, trả về ngày/tháng/năm đích.
 */
export function addRegrowthDaysToActualHarvestDate(
  actual: unknown,
  regrowthDays: number,
): RegrowthDateAfterAdd | null {
  if (!isValidHarvestDateString(actual)) return null;
  const s = String(actual).trim().slice(0, 10);
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!parts) return null;
  const y = Number(parts[1]);
  const m = Number(parts[2]);
  const d = Number(parts[3]);
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setDate(dt.getDate() + regrowthDays);
  const year = dt.getFullYear();
  const month = dt.getMonth() + 1;
  const day = dt.getDate();
  return {
    ymd: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    month,
    year,
  };
}

/**
 * Cộng số tháng regrowth vào actual_harvest_date (dùng cho nhánh M2).
 */
export function addRegrowthMonthsToActualHarvestDate(
  actual: unknown,
  regrowthMonths: number,
): RegrowthDateAfterAdd | null {
  const p = parseYmdToDateParts(actual);
  if (!p) return null;
  const nd = addMonthsPhp(p.month, p.year, regrowthMonths, p.day);
  if (!nd) return null;
  return {
    ymd: `${String(nd.year).padStart(4, "0")}-${String(nd.month).padStart(2, "0")}-${String(nd.day).padStart(2, "0")}`,
    month: nd.month,
    year: nd.year,
  };
}

/**
 * So sánh tháng giữa `actual_harvest_date` và `regrowthDate`:
 * - `same_month`: cùng năm + cùng tháng
 * - `different_month`: khác tháng hoặc khác năm
 */
export function compareRegrowthMonthWithActual(
  actual: unknown,
  regrowthDate: RegrowthDateAfterAdd,
): MonthCompareResult | null {
  if (!isValidHarvestDateString(actual)) return null;
  const s = String(actual).trim().slice(0, 10);
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!parts) return null;
  const y = Number(parts[1]);
  const m = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return null;
  return y === regrowthDate.year && m === regrowthDate.month
    ? "same_month"
    : "different_month";
}

/**
 * Số ngày regrowth theo bậc **kg/m²** — cùng bảng `Grass_forecasting::getDayRegrowthByKg` (1930–1941).
 *
 * Điều kiện: **`actual_harvest_date` phải có giá trị hợp lệ** (đã gặt thật). Không có thì không áp dụng nhánh này → `null`.
 *
 * Công thức: `kgPerM2 = quantity / harvested_area` (kg ÷ m²), rồi:
 * - &lt; 2 → 25 ngày
 * - 2–4 → 40 ngày
 * - &gt; 4 và ≤ 6 → 55 ngày
 * - &gt; 6 → 70 ngày
 *
 * @see `getDayRegrowthByKgPhp` trong `grassRegrowthPhp.ts`
 */
export function getRegrowthDaysFromHarvestPlanRow(
  raw: Record<string, unknown>,
): number | null {
  if (!hasActualHarvestDate(raw)) {
    return null;
  }

  const uom = String(raw.uom ?? "")
    .trim()
    .toUpperCase();
  if (uom === "M2") {
    return null;
  }

  const quantity = Number(raw.quantity ?? 0);
  const harvestedAreaM2 = Number(raw.harvested_area ?? 0);
  const kgPerM2 = safeDivideStrictPhp(quantity, harvestedAreaM2);

  return getDayRegrowthByKgPhp(kgPerM2);
}

function computeKgRegrowthFromRaw(
  raw: Record<string, unknown>,
): {
  quantity: number;
  kgPerM2: number;
  regrowthDays: number;
  regrowthDate: RegrowthDateAfterAdd;
  lastInfo: LastDayOfMonthInfo;
  monthCompare: MonthCompareResult;
  regrowthQuantity: number;
} | null {
  const lastInfo = lastDayOfMonthInfoFromActualHarvestDate(raw.actual_harvest_date);
  if (!lastInfo) return null;

  const quantity = Number(raw.quantity ?? 0);
  const harvestedAreaM2 = Number(raw.harvested_area ?? 0);
  const kgPerM2 = safeDivideStrictPhp(quantity, harvestedAreaM2);
  const regrowthDays = getDayRegrowthByKgPhp(kgPerM2);
  const regrowthDate = addRegrowthDaysToActualHarvestDate(
    raw.actual_harvest_date,
    regrowthDays,
  );
  if (!regrowthDate) return null;

  const actualHarvestDateParts = parseYmdToDateParts(raw.actual_harvest_date);
  if (!actualHarvestDateParts) return null;
  const dateOnEndMonth = lastInfo.daysInMonth - actualHarvestDateParts.day;

  const monthCompare = compareRegrowthMonthWithActual(
    raw.actual_harvest_date,
    regrowthDate,
  );
  if (!monthCompare) return null;

  let regrowthQuantity = quantity;
  if (monthCompare === "different_month") {
    const dateRate = regrowthDays - dateOnEndMonth;
    const rate = dateRate / regrowthDays;
    regrowthQuantity = quantity - Math.round(quantity * rate);
  }

  return {
    quantity,
    kgPerM2,
    regrowthDays,
    regrowthDate,
    lastInfo,
    monthCompare,
    regrowthQuantity,
  };
}

function computeM2RegrowthFromRaw(
  raw: Record<string, unknown>,
): {
  quantity: number;
  kgPerM2: number;
  regrowthDays: number | null;
  regrowthDate: RegrowthDateAfterAdd;
  lastInfo: LastDayOfMonthInfo;
  monthCompare: MonthCompareResult;
  regrowthQuantity: number;
} | null {
  const lastInfo = lastDayOfMonthInfoFromActualHarvestDate(raw.actual_harvest_date);
  if (!lastInfo) return null;

  const quantity = Number(raw.quantity ?? 0);
  const harvestedAreaM2 = Number(raw.harvested_area ?? 0);
  const kgPerM2 = safeDivideStrictPhp(quantity, harvestedAreaM2);
  const regrowthDate = addRegrowthMonthsToActualHarvestDate(
    raw.actual_harvest_date,
    4,
  );
  if (!regrowthDate) return null;

  const monthCompare = compareRegrowthMonthWithActual(
    raw.actual_harvest_date,
    regrowthDate,
  );
  if (!monthCompare) return null;

  return {
    quantity,
    kgPerM2,
    regrowthDays: null,
    regrowthDate,
    lastInfo,
    monthCompare,
    regrowthQuantity: quantity,
  };
}

/**
 * Duyệt `apiHarvestRaw` — mỗi dòng: id, kg/m², regrowthDays, ngày cuối tháng, số ngày trong tháng, regrowthQuantity (chỉ khi đủ điều kiện tính).
 */
export function mapApiHarvestRawToRegrowthDays(
  rows: Record<string, unknown>[],
): RegrowthPreviewRow[] {
  const out: RegrowthPreviewRow[] = [];
  
  

  for (const raw of rows) {
    const uom = String(raw.uom ?? "")
      .trim()
      .toUpperCase();
    if (uom !== "KG" && uom !== "M2") continue;
    const calc =
      uom === "KG" ? computeKgRegrowthFromRaw(raw) : computeM2RegrowthFromRaw(raw);
    if (!calc) continue;

    out.push({
      id: (raw.id as string | number | null | undefined) ?? null,
      product_id: Number(raw.product_id ?? 0) || null,
      farm_id: Number(raw.farm_id ?? 0) || null,
      farm_name: String(raw.farm_name ?? "").trim(),
      actualHarvestDateYmd: String(raw.actual_harvest_date).trim().slice(0, 10),
      uom: uom as "KG" | "M2",
      kgPerM2: calc.kgPerM2,
      regrowthDays: calc.regrowthDays,
      lastDayOfActualHarvestMonthYmd: calc.lastInfo.ymd,
      daysInActualHarvestMonth: calc.lastInfo.daysInMonth,
      regrowthQuantity: calc.regrowthQuantity,
      regrowthDateYmd: calc.regrowthDate.ymd,
      regrowthMonth: calc.regrowthDate.month,
      regrowthYear: calc.regrowthDate.year,
      monthCompare: calc.monthCompare,
    });
  }

  return out;
}

/**
 * Gộp các dòng regrowth theo tháng từ `regrowthDateYmd` (YYYY-MM).
 * Dòng cùng tháng được cộng dồn quantity theo UOM:
 * - KG -> `totalKg`
 * - M2 -> `totalM2`
 */
export function mergeRegrowthPreviewByMonth(
  rows: RegrowthPreviewRow[],
): RegrowthMonthlyMergedRow[] {
  const byMonth = new Map<string, RegrowthMonthlyMergedRow>();
  

  for (const row of rows) {
    const p = parseYmdToDateParts(row.regrowthDateYmd);
    if (!p) continue;
    const monthKey = `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}`;
    const cur = byMonth.get(monthKey) ?? {
      monthKey,
      year: p.year,
      month: p.month,
      totalKg: 0,
      totalM2: 0,
      items: [],
    };

    if (row.uom === "M2") {
      cur.totalM2 += row.regrowthQuantity;
    } else {
      cur.totalKg += row.regrowthQuantity;
    }
    cur.items.push(row);
    byMonth.set(monthKey, cur);
  }

  return Array.from(byMonth.values()).sort((a, b) =>
    a.monthKey.localeCompare(b.monthKey),
  );
}

/**
 * Gộp harvest theo tháng từ `raw.actual_harvest_date` (chỉ dòng có actual hợp lệ).
 */
export function mergeHarvestByActualMonth(
  rows: Record<string, unknown>[],
): HarvestMonthlyMergedRow[] {
  const byMonth = new Map<string, HarvestMonthlyMergedRow>();

  for (const raw of rows) {
    if (!isValidHarvestDateString(raw.actual_harvest_date)) continue;
    const p = parseYmdToDateParts(raw.actual_harvest_date);
    if (!p) continue;
    const monthKey = `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}`;
    const cur = byMonth.get(monthKey) ?? {
      monthKey,
      year: p.year,
      month: p.month,
      harvestedKg: 0,
      harvestedM2: 0,
      items: [],
    };
    const qty = Number(raw.quantity ?? 0);
    const uom = String(raw.uom ?? "").trim().toUpperCase();
    if (uom === "M2") cur.harvestedM2 += qty;
    else cur.harvestedKg += qty;
    cur.items.push(raw);
    byMonth.set(monthKey, cur);
  }

  return Array.from(byMonth.values()).sort((a, b) =>
    a.monthKey.localeCompare(b.monthKey),
  );
}

/**
 * Tính tồn theo tháng:
 * `available = (starting + regrowth) - harvested`
 * và `starting` của tháng hiện tại = `available` tháng liền kề trước đó.
 */
export function computeMonthlyAvailabilityFromRaw(
  rows: Record<string, unknown>[],
): MonthlyAvailabilityRow[] {

  const regrowthByMonth = mergeRegrowthPreviewByMonth(
    mapApiHarvestRawToRegrowthDays(rows),
  );
  const harvestByMonth = mergeHarvestByActualMonth(rows);

  const regrowthMap = new Map<string, RegrowthMonthlyMergedRow>();
  for (const r of regrowthByMonth) regrowthMap.set(r.monthKey, r);
  const harvestMap = new Map<string, HarvestMonthlyMergedRow>();
  for (const h of harvestByMonth) harvestMap.set(h.monthKey, h);

  const keys = Array.from(
    new Set([
      ...regrowthByMonth.map((x) => x.monthKey),
      ...harvestByMonth.map((x) => x.monthKey),
    ]),
  ).sort((a, b) => a.localeCompare(b));

  const out: MonthlyAvailabilityRow[] = [];
  let prevAvailableKg = 0;
  let prevAvailableM2 = 0;

  for (const key of keys) {
    const [yStr, mStr] = key.split("-");
    const year = Number(yStr);
    const month = Number(mStr);
    const reg = regrowthMap.get(key);
    const har = harvestMap.get(key);

    const startingKg = prevAvailableKg;
    const startingM2 = prevAvailableM2;
    const regrowthKg = reg?.totalKg ?? 0;
    const regrowthM2 = reg?.totalM2 ?? 0;
    const harvestedKg = har?.harvestedKg ?? 0;
    const harvestedM2 = har?.harvestedM2 ?? 0;

    const availableKg = startingKg + regrowthKg - harvestedKg;
    const availableM2 = startingM2 + regrowthM2 - harvestedM2;

    out.push({
      monthKey: key,
      year,
      month,
      startingKg,
      startingM2,
      regrowthKg,
      regrowthM2,
      harvestedKg,
      harvestedM2,
      availableKg,
      availableM2,
    });

    prevAvailableKg = availableKg;
    prevAvailableM2 = availableM2;
  }
  return out;
}

/**
 * Tính tồn theo tháng cho từng `product_id`:
 * `available = (starting + regrowth) - harvested`
 * và `starting` tháng hiện tại = `available` tháng liền kề trước đó của cùng product.
 *
 * Căn chỉnh ý tưởng với PHP `Grass_forecasting::calculateDateRangesByFarmProduct`:
 * phạm vi tháng phải bao phủ **mọi** tháng có harvest/regrowth trong năm (min→max),
 * không được “cắt” mất tháng đầu năm chỉ vì `from` UI trễ hơn tháng có dữ liệu.
 * Tháng hiển thị vẫn giới hạn trong [Harvest from – to] (chỉ emit các dòng trong khoảng đó),
 * nhưng rolling `starting`/`available` vẫn tính từ tháng sớm nhất cần thiết.
 */
export function computeMonthlyAvailabilityByProductFromRaw(
  rows: Record<string, unknown>[],
  options: ProductMonthlyAvailabilityOptions = {},
): ProductMonthlyAvailabilityRow[] {
  if (process.env.NODE_ENV !== "production") {
    const actualMonthKeys = rows
      .map((raw) => {
        const p = parseYmdToDateParts(raw.actual_harvest_date);
        if (!p) return null;
        return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}`;
      })
      .filter((v): v is string => v !== null)
      .sort((a, b) => a.localeCompare(b));
    const uniqueActualMonths = Array.from(new Set(actualMonthKeys));
    console.log("[computeMonthlyAvailabilityByProductFromRaw][input]", {
      totalRows: rows.length,
      rowsWithValidActualHarvestDate: actualMonthKeys.length,
      uniqueActualMonths,
    });
  }

  const regrowthRows = mapApiHarvestRawToRegrowthDays(rows).filter(
    (r): r is RegrowthPreviewRow & { product_id: number } =>
      typeof r.product_id === "number" && Number.isFinite(r.product_id),
  );

  const harvestRows = rows.filter((raw) => {
    if (!isValidHarvestDateString(raw.actual_harvest_date)) return false;
    const pid = Number(raw.product_id ?? NaN);
    return Number.isFinite(pid);
  });

  const productIds = Array.from(
    new Set([
      ...regrowthRows.map((r) => r.product_id),
      ...harvestRows.map((r) => Number(r.product_id)),
    ]),
  ).sort((a, b) => a - b);

  const out: ProductMonthlyAvailabilityRow[] = [];

  const fromKey = options.fromYmd?.slice(0, 7);
  const toKey = options.toYmd?.slice(0, 7);
  const derivedYear = Number(
    String(options.fromYmd ?? options.toYmd ?? "").slice(0, 4),
  );
  const targetYear = Number.isFinite(options.year)
    ? Number(options.year)
    : Number.isFinite(derivedYear)
      ? derivedYear
      : new Date().getFullYear();
  const yearStartKey = `${String(targetYear).padStart(4, "0")}-01`;
  const yearEndKey = `${String(targetYear).padStart(4, "0")}-12`;
  const rangeStartKey =
    fromKey && fromKey.startsWith(String(targetYear)) ? fromKey : yearStartKey;
  const hardRangeEndKey =
    toKey && toKey.startsWith(String(targetYear))
      ? toKey < yearEndKey
        ? toKey
        : yearEndKey
      : yearEndKey;
  const addOneMonthKey = (monthKey: string): string => {
    const [yStr, mStr] = monthKey.split("-");
    const y = Number(yStr);
    const m = Number(mStr);
    if (!Number.isFinite(y) || !Number.isFinite(m)) return monthKey;
    if (m >= 12) return `${String(y + 1).padStart(4, "0")}-01`;
    return `${String(y).padStart(4, "0")}-${String(m + 1).padStart(2, "0")}`;
  };
  const inMonthRange = (monthKey: string, start: string, end: string): boolean =>
    monthKey >= start && monthKey <= end;

  const minMonthKey = (a: string, b: string): string => (a < b ? a : b);

  for (const productId of productIds) {
    const regByMonth = new Map<string, { kg: number; m2: number }>();
    for (const r of regrowthRows) {
      if (r.product_id !== productId) continue;
      const key = r.regrowthDateYmd.slice(0, 7);
      if (!key.startsWith(String(targetYear))) continue;
      const cur = regByMonth.get(key) ?? { kg: 0, m2: 0 };
      if (r.uom === "M2") cur.m2 += r.regrowthQuantity;
      else cur.kg += r.regrowthQuantity;
      regByMonth.set(key, cur);
    }

    const harByMonth = new Map<string, { kg: number; m2: number }>();
    for (const raw of harvestRows) {
      if (Number(raw.product_id) !== productId) continue;
      const p = parseYmdToDateParts(raw.actual_harvest_date);
      if (!p) continue;
      const key = `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}`;
      if (!key.startsWith(String(targetYear))) continue;
      const cur = harByMonth.get(key) ?? { kg: 0, m2: 0 };
      const qty = Number(raw.quantity ?? 0);
      const uom = String(raw.uom ?? "").trim().toUpperCase();
      if (uom === "M2") cur.m2 += qty;
      else cur.kg += qty;
      harByMonth.set(key, cur);
    }

    const allActivityKeys = Array.from(
      new Set([...regByMonth.keys(), ...harByMonth.keys()]),
    ).sort((a, b) => a.localeCompare(b));
    if (process.env.NODE_ENV !== "production" && productId === 1) {
      console.log("[computeMonthlyAvailabilityByProductFromRaw][product=1]", {
        regrowthMonths: Array.from(regByMonth.keys()).sort((a, b) => a.localeCompare(b)),
        harvestMonths: Array.from(harByMonth.keys()).sort((a, b) => a.localeCompare(b)),
        allActivityKeys,
      });
    }
    const hasActivityInInputRange = allActivityKeys.some((k) =>
      inMonthRange(k, rangeStartKey, hardRangeEndKey),
    );
    if (!hasActivityInInputRange) continue;

    const activityKeysInTargetYear = allActivityKeys.filter((k) =>
      k.startsWith(`${String(targetYear).padStart(4, "0")}-`),
    );
    const earliestActivityInYear = activityKeysInTargetYear[0];
    /** Tháng bắt đầu chuỗi rolling (có thể trước `rangeStartKey` nếu dữ liệu có sớm hơn). */
    const seriesStartKey = earliestActivityInYear
      ? minMonthKey(rangeStartKey, earliestActivityInYear)
      : rangeStartKey;

    const lastRegrowthInYear = Array.from(regByMonth.keys()).sort((a, b) =>
      a.localeCompare(b),
    ).pop();
    // Kết thúc tại tháng sớm hơn trong lịch: không kéo quá `to` của Harvest date,
    // và không kéo sau tháng regrowth cuối trong năm (đủ tháng “có nghĩa”).
    const effectiveEndKey = (() => {
      if (!lastRegrowthInYear) return hardRangeEndKey;
      return lastRegrowthInYear < hardRangeEndKey
        ? lastRegrowthInYear
        : hardRangeEndKey;
    })();
    let clampedEndKey =
      effectiveEndKey > yearEndKey ? yearEndKey : effectiveEndKey;
    if (clampedEndKey < rangeStartKey) clampedEndKey = rangeStartKey;

    let prevAvailableKg = 0;
    let prevAvailableM2 = 0;

    let cursor = seriesStartKey;
    while (cursor <= clampedEndKey) {
      const [yStr, mStr] = cursor.split("-");
      const year = Number(yStr);
      const month = Number(mStr);
      const reg = regByMonth.get(cursor);
      const har = harByMonth.get(cursor);

      const startingKg = prevAvailableKg;
      const startingM2 = prevAvailableM2;
      const regrowthKg = reg?.kg ?? 0;
      const regrowthM2 = reg?.m2 ?? 0;
      const harvestedKg = har?.kg ?? 0;
      const harvestedM2 = har?.m2 ?? 0;
      const availableKg = startingKg + regrowthKg - harvestedKg;
      const availableM2 = startingM2 + regrowthM2 - harvestedM2;

      out.push({
        productId,
        monthKey: cursor,
        year,
        month,
        startingKg,
        startingM2,
        regrowthKg,
        regrowthM2,
        harvestedKg,
        harvestedM2,
        availableKg,
        availableM2,
      });

      prevAvailableKg = availableKg;
      prevAvailableM2 = availableM2;
      cursor = addOneMonthKey(cursor);
    }
  }

  const sorted = out.sort((a, b) =>
    a.productId === b.productId
      ? a.monthKey.localeCompare(b.monthKey)
      : a.productId - b.productId,
  );

  if (process.env.NODE_ENV !== "production") {
    console.log("[computeMonthlyAvailabilityByProductFromRaw]", {
      options,
      targetYear,
      rangeStartKey,
      hardRangeEndKey,
      rows: sorted,
    });
  }

  return sorted;
}





