/**
 * # Regrowth — parity với `Grass_forecasting::processRegrowthByUom` (STSPortal)
 *
 * Module này tái hiện **cùng thứ tự nhánh, công thức và làm tròn** như PHP:
 * `app/Controllers/Grass_forecasting.php` (khoảng dòng 3178–3291), cùng các helper
 * `getDayRegrowthByKg`, `addDays`, `addMonths`, `HelpersClass::safeDivideStrict`,
 * và ghi nhận bucket trong `appendOrUpdateRegrowthKgNew`.
 *
 * ## Luồng xử lý từng dòng `dailyQuantities` (tóm tắt)
 *
 * 1. **Bỏ qua** nếu không có `date`.
 * 2. **Chuẩn hoá ngày harvest** theo UOM:
 *    - **M2**: chỉ chấp nhận chuỗi `Y-m-d` hợp lệ (ràng buộc giống `DateTimeImmutable::createFromFormat('!Y-m-d')` + đối chiếu lại chuỗi).
 *    - **Kg**: `strtotime` → `Y-m-d` (trong TS dùng parse lỏng hơn; nên ưu tiên gửi `Y-m-d` để khớp server).
 * 3. **Nhánh regrowth**:
 *    - **Kg** và `has_actual_harvest_date === true`: tính **động theo ngày**:
 *      - `kgPerM2 = safeDivideStrict(quantity, harvested_area)` (mẫu số 0 hoặc rỗng → 0).
 *      - `daysToAdd = getDayRegrowthByKg(kgPerM2)` (bảng bậc thang ngày).
 *      - `newDate = addDays(startDay, startMonth, startYear, daysToAdd)`.
 *      - Nếu regrowth **sang tháng khác** với tháng harvest: phân bổ lại khối lượng giữa tháng hiện tại và tháng đích (xem {@link computeKgCrossMonthSplitPhp}).
 *    - **Các trường hợp còn lại** (M2, hoặc Kg không có actual date): cộng tháng:
 *      - `monthsToAdd = (uom === 'M2') ? defaultMonthsToAdd : 1`.
 *      - `newDate = addMonths(startMonth, startYear, monthsToAdd, startDay)`.
 *      - `quantityAdjusted = quantity`, không có `extraData` kiểu Kg động.
 * 4. Gắn `regrowth_date` = `Y-m-d` từ `newDate`, rồi gom vào danh sách regrowth theo `(farm_id, product_id, year, month, uom)` — xem {@link appendOrUpdateRegrowthKgNewPhp}.
 *
 * @module grassRegrowthPhp
 */

/** Đơn vị như trong PHP (`Kg` | `M2`). */
export type GrassUomPhp = "Kg" | "M2";

/** Một dòng số liệu theo ngày (tương đương phần tử `$dailyQuantities`). */
export interface RegrowthDailyItemPhp {
  date?: string | null;
  quantity?: number;
  /** Khi true và UOM Kg: dùng công thức ngày động + tách tháng. */
  has_actual_harvest_date?: boolean;
  /** Diện tích m² (mẫu số tính kg/m²). */
  harvested_area?: number;
  [key: string]: unknown;
}

/** Kết quả ngày sau `addDays` / `addMonths` (tháng 1–12). */
export type YearMonthDayPhp = {
  year: number;
  month: number;
  day: number;
};

/** Bản ghi regrowth đã gom (một bucket tháng). */
export type RegrowthBucketPhp = {
  name: "regrowth";
  farm_id: string | number;
  farm_name: string;
  product_id: string | number;
  product_name: string;
  harvest: string;
  month: number;
  year: number;
  day: number;
  quantity_kg: number;
  quantity_m2: number;
  uom: GrassUomPhp;
  country_id: string;
  harvest_item_kg: RegrowthDailyItemPhp[];
  harvest_item_m2: RegrowthDailyItemPhp[];
};

/**
 * Chia an toàn — giống `HelpersClass::safeDivideStrict`:
 * chỉ chia khi tử/mẫu đều “truthy” và khác 0; ngược lại trả `0`.
 */
export function safeDivideStrictPhp(numerator: number, denominator: number): number {
  return numerator && denominator && numerator !== 0 && denominator !== 0
    ? numerator / denominator
    : 0;
}

/**
 * Số ngày regrowth theo **kg/m²** — giống `Grass_forecasting::getDayRegrowthByKg`.
 *
 * - `< 2` → 25 ngày
 * - `2 ≤ x ≤ 4` → 40 ngày
 * - `4 < x ≤ 6` → 55 ngày
 * - `> 6` → 70 ngày
 *
 * (Biên: 2 thuộc nhánh 40 ngày; 4 thuộc nhánh 40 ngày; 4 không vào nhánh 55; 6 thuộc nhánh 55.)
 */
export function getDayRegrowthByKgPhp(kgPerM2: number): number {
  if (kgPerM2 < 2) return 25;
  if (kgPerM2 >= 2 && kgPerM2 <= 4) return 40;
  if (kgPerM2 > 4 && kgPerM2 <= 6) return 55;
  return 70;
}

/**
 * Cộng ngày — giống `Grass_forecasting::addDays`:
 * tạo `Y-m-d` từ (year, month, day) rồi cộng `daysToAdd` (DateTime modify).
 */
export function addDaysPhp(
  startDay: number,
  startMonth: number,
  startYear: number,
  daysToAdd: number,
): YearMonthDayPhp | null {
  const d = new Date(startYear, startMonth - 1, startDay);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + daysToAdd);
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
  };
}

/**
 * Cộng tháng — giống `Grass_forecasting::addMonths`:
 * dùng `DateTime::modify('+N months')` lấy năm/tháng đích, rồi **ngày** = `startDay`
 * nhưng kẹp về cuối tháng nếu `startDay` vượt số ngày của tháng đích.
 */
export function addMonthsPhp(
  startMonth: number,
  startYear: number,
  monthsToAdd: number,
  startDay = 1,
): YearMonthDayPhp | null {
  const d = new Date(startYear, startMonth - 1, startDay);
  if (Number.isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() + monthsToAdd);
  const newYear = d.getFullYear();
  const newMonth = d.getMonth() + 1;
  let newDay = startDay;
  const daysInNewMonth = new Date(newYear, newMonth, 0).getDate();
  if (startDay > daysInNewMonth) newDay = daysInNewMonth;
  return { year: newYear, month: newMonth, day: newDay };
}

function daysInMonthPhp(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}

/**
 * Parse ngày M2 — giống nhánh `!Y-m-d` + kiểm tra warning/error count trong PHP.
 * Trả về `{ startYear, startMonth, startDay, date }` hoặc `null` nếu không hợp lệ.
 */
export function parseHarvestDateM2Php(dateStr: unknown): {
  startYear: number;
  startMonth: number;
  startDay: number;
  date: string;
} | null {
  if (typeof dateStr !== "string" || dateStr === "") return null;
  const dt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!dt) return null;
  const y = Number(dt[1]);
  const m = Number(dt[2]);
  const day = Number(dt[3]);
  const check = new Date(y, m - 1, day);
  if (
    check.getFullYear() !== y ||
    check.getMonth() + 1 !== m ||
    check.getDate() !== day
  ) {
    return null;
  }
  return {
    startYear: y,
    startMonth: m,
    startDay: day,
    date: dateStr,
  };
}

/**
 * Parse ngày Kg — giống `date('Y-m-d', strtotime($dateStr))` (nhánh đơn giản).
 */
export function parseHarvestDateKgLoosePhp(dateStr: unknown): {
  startYear: number;
  startMonth: number;
  startDay: number;
  date: string;
} | null {
  const d = new Date(String(dateStr));
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const date = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { startYear: y, startMonth: m, startDay: day, date };
}

export interface KgCrossMonthSplitPhp {
  quantityAdjusted: number;
  /** `1 - rate` — phần “ở lại” tháng harvest (PHP đặt tên `rate_remain`). */
  rateRemain: number;
  portionNextMonth: number;
  newKeyStarting: string;
}

/**
 * Tách khối lượng Kg khi cửa sổ regrowth (daysToAdd ngày) vượt qua ranh giới tháng.
 *
 * **Ý tưởng (cùng công thức PHP):** coi `daysToAdd` là tổng số ngày “chu kỳ regrowth”.
 * Từ ngày harvest đến hết tháng harvest còn `lastDay - startDay` ngày (PHP: `$dateOnEndMonth`).
 * Phần chu kỳ nằm **sau** hết tháng harvest là `daysToAdd - dateOnEndMonth` ngày — tỷ lệ
 * khối lượng gán cho **tháng đích regrowth** là `(đó) / daysToAdd`. Phần còn lại ở tháng harvest.
 *
 * Góc nhìn tương đương: `rateRemain = dateOnEndMonth / daysToAdd` (phần chu kỳ trong tháng harvest),
 * nhưng code vẫn tính `rate` rồi `1 - rate` như PHP để giữ cùng thứ tự float.
 *
 * @returns `portionNextMonth` = `round(quantity * rate)` — khớp `round($quantity * $rate)` bên PHP.
 */
export function splitKgQuantityForCrossMonthPhp(
  quantity: number,
  startYear: number,
  startMonth: number,
  startDay: number,
  daysToAdd: number,
): Pick<KgCrossMonthSplitPhp, "quantityAdjusted" | "rateRemain" | "portionNextMonth"> {
  const lastDay = daysInMonthPhp(startYear, startMonth);
  /** Số ngày từ ngày harvest đến hết tháng (không tính trùng ngày harvest theo cách PHP). */
  const dateOnEndMonth = lastDay - startDay;
  /** Phần “dư” của chu kỳ sang tháng kế / tháng đích (PHP: `$regrowthDateRate`). */
  const regrowthDateRate = daysToAdd - dateOnEndMonth;
  const rate = regrowthDateRate / daysToAdd;
  const rateRemain = 1 - rate;
  const portionNextMonth = Math.round(quantity * rate);
  const quantityAdjusted = quantity - portionNextMonth;
  return { quantityAdjusted, rateRemain, portionNextMonth };
}

/**
 * Cộng dồn phần khối lượng sang tháng đích (`startingOfRegowthKg` trong PHP — typo giữ nguyên tên biến ngoài).
 */
export function addToStartingRegrowthKgPhp(
  startingOfRegowthKg: Record<string, number>,
  year: number,
  month: number,
  delta: number,
): string {
  const key = `${year}_${month}`;
  startingOfRegowthKg[key] = (startingOfRegowthKg[key] ?? 0) + delta;
  return key;
}

/**
 * Phần tách tháng khi Kg + actual date và regrowth sang tháng khác — giống khối PHP:
 * gọi {@link splitKgQuantityForCrossMonthPhp} rồi cập nhật `startingOfRegowthKg`.
 */
export function computeKgCrossMonthSplitPhp(
  quantity: number,
  startYear: number,
  startMonth: number,
  startDay: number,
  daysToAdd: number,
  newDate: YearMonthDayPhp,
  startingOfRegowthKg: Record<string, number>,
): KgCrossMonthSplitPhp {
  const { quantityAdjusted, rateRemain, portionNextMonth } =
    splitKgQuantityForCrossMonthPhp(
      quantity,
      startYear,
      startMonth,
      startDay,
      daysToAdd,
    );

  const newKeyStarting = addToStartingRegrowthKgPhp(
    startingOfRegowthKg,
    newDate.year,
    newDate.month,
    portionNextMonth,
  );

  return {
    quantityAdjusted,
    rateRemain,
    portionNextMonth,
    newKeyStarting,
  };
}

export interface ProcessRegrowthItemResultPhp {
  /** `false` nếu PHP sẽ `continue` (bỏ qua dòng). */
  ok: boolean;
  item: RegrowthDailyItemPhp;
  newDate: YearMonthDayPhp;
  harvestDateStr: string;
  quantityAdjusted: number;
  uom: GrassUomPhp;
  extraData: Record<string, unknown>;
  regrowthDateStr: string;
}

/**
 * Một vòng lặp trong `processRegrowthByUom`: từ một `item` + ngữ cảnh farm/product/UOM,
 * tính `regrowth_date`, `quantityAdjusted`, `extraData` — khớp nhánh if/else PHP.
 *
 * @param defaultMonthsToAdd - với M2 dùng giá trị này (PHP mặc định 1).
 */
export function processRegrowthItemPhp(
  item: RegrowthDailyItemPhp,
  uom: GrassUomPhp,
  defaultMonthsToAdd: number,
  startingOfRegowthKg: Record<string, number>,
): ProcessRegrowthItemResultPhp | { ok: false } {
  const dateStr = item.date ?? null;
  if (!dateStr) return { ok: false };

  let startYear: number;
  let startMonth: number;
  let startDay: number;
  let date: string;

  if (uom === "M2") {
    const p = parseHarvestDateM2Php(dateStr);
    if (!p) return { ok: false };
    startYear = p.startYear;
    startMonth = p.startMonth;
    startDay = p.startDay;
    date = p.date;
  } else {
    const p = parseHarvestDateKgLoosePhp(dateStr);
    if (!p) return { ok: false };
    startYear = p.startYear;
    startMonth = p.startMonth;
    startDay = p.startDay;
    date = p.date;
    const parts = date.split("-");
    if (parts.length !== 3) return { ok: false };
  }

  const quantity = Number(item.quantity ?? 0);

  let newDate: YearMonthDayPhp | null = null;
  let quantityAdjusted = quantity;
  let extraData: Record<string, unknown> = {};

  if (uom === "Kg" && item.has_actual_harvest_date) {
    const kgOnM2 = safeDivideStrictPhp(quantity, Number(item.harvested_area ?? 0));
    const daysToAdd = getDayRegrowthByKgPhp(kgOnM2);
    newDate = addDaysPhp(startDay, startMonth, startYear, daysToAdd);
    if (!newDate || newDate.month === undefined || newDate.year === undefined) {
      return { ok: false };
    }

    /** PHP: `''` khi cùng tháng; số khi sang tháng khác. */
    let rateRemainPhp: number | "" = "";
    quantityAdjusted = quantity;
    if (newDate.month !== startMonth) {
      const split = computeKgCrossMonthSplitPhp(
        quantity,
        startYear,
        startMonth,
        startDay,
        daysToAdd,
        newDate,
        startingOfRegowthKg,
      );
     
      quantityAdjusted = split.quantityAdjusted;
      rateRemainPhp = split.rateRemain;
    }

    /** PHP luôn gán `extraData` 3 key sau nhánh Kg + actual (kể cả cùng tháng). */
    extraData = {
      quantity_remain: quantityAdjusted,
      rate_remain: rateRemainPhp,
      day_regrowth: daysToAdd,
    };
  } else {
    const monthsToAdd = uom === "M2" ? defaultMonthsToAdd : 1;
    newDate = addMonthsPhp(startMonth, startYear, monthsToAdd, startDay);
    quantityAdjusted = quantity;
    extraData = {};
  }

  if (!newDate || newDate.month === undefined || newDate.year === undefined) {
    return { ok: false };
  }

  const regrowthDateStr = `${String(newDate.year).padStart(4, "0")}-${String(newDate.month).padStart(2, "0")}-${String(newDate.day ?? 1).padStart(2, "0")}`;
  /** PHP: `"$startYear-$startMonth-$startDay"` — không pad số. */
  const harvestDateStr = `${startYear}-${startMonth}-${startDay}`;
  const outItem: RegrowthDailyItemPhp = {
    ...item,
    regrowth_date: regrowthDateStr,
  };

  return {
    ok: true,
    item: outItem,
    newDate,
    harvestDateStr,
    quantityAdjusted,
    uom,
    extraData,
    regrowthDateStr,
  };
}

/**
 * Gom dòng regrowth theo `(farm_id, product_id, year, month, uom)` — giống
 * `appendOrUpdateRegrowthKgNew`: nếu đã có bucket thì push item + cộng quantity; không thì tạo mới.
 */
export function appendOrUpdateRegrowthKgNewPhp(
  regrowthList: RegrowthBucketPhp[],
  countryId: string,
  item: RegrowthDailyItemPhp,
  farmId: string | number,
  farmName: string,
  productId: string | number,
  productName: string,
  newDate: YearMonthDayPhp,
  harvestDateStr: string,
  quantity: number,
  uom: GrassUomPhp,
  extraData: Record<string, unknown>,
): void {
  for (const r of regrowthList) {
    if (
      r.month === newDate.month &&
      r.year === newDate.year &&
      r.uom === uom &&
      r.farm_id === farmId &&
      r.product_id === productId
    ) {
      const merged = { ...item, ...extraData };
      if (uom === "Kg") {
        r.harvest_item_kg.push(merged);
        r.quantity_kg += quantity;
      } else {
        r.harvest_item_m2.push(merged);
        r.quantity_m2 += quantity;
      }
      return;
    }
  }

  const newRecord: RegrowthBucketPhp = {
    name: "regrowth",
    farm_id: farmId,
    farm_name: farmName,
    product_id: productId,
    product_name: productName,
    harvest: harvestDateStr,
    month: newDate.month,
    year: newDate.year,
    day: newDate.day,
    quantity_kg: 0,
    quantity_m2: 0,
    uom,
    country_id: countryId ?? "",
    harvest_item_kg: [],
    harvest_item_m2: [],
  };

  const merged = { ...item, ...extraData };
  if (uom === "Kg") {
    newRecord.quantity_kg = quantity;
    newRecord.harvest_item_kg = [merged];
  } else {
    newRecord.quantity_m2 = quantity;
    newRecord.harvest_item_m2 = [merged];
  }

  regrowthList.push(newRecord);
}

export interface ProcessRegrowthByUomContextPhp {
  regrowthList: RegrowthBucketPhp[];
  farmId: string | number;
  farmName: string;
  productId: string | number;
  productName: string;
  country_id: string;
  uom: GrassUomPhp;
  month: number;
  currentYear: number;
  defaultMonthsToAdd: number;
  startingOfRegowthKg: Record<string, number>;
}

/**
 * Toàn bộ vòng `foreach ($dailyQuantities as $item)` như `processRegrowthByUom`.
 * Các tham số `month`, `currentYear` giữ đúng chữ ký PHP (có thể dùng cho mở rộng sau;
 * hiện phần thân PHP không dùng trực tiếp trong đoạn 3178–3291).
 */
export function processRegrowthByUomPhp(
  dailyQuantities: RegrowthDailyItemPhp[],
  ctx: ProcessRegrowthByUomContextPhp,
): void {
  const {
    regrowthList,
    farmId,
    farmName,
    productId,
    productName,
    country_id,
    uom,
    defaultMonthsToAdd = 1,
    startingOfRegowthKg,
  } = ctx;

  for (const raw of dailyQuantities) {
    const res = processRegrowthItemPhp(raw, uom, defaultMonthsToAdd, startingOfRegowthKg);
    if (!res.ok) continue;

    appendOrUpdateRegrowthKgNewPhp(
      regrowthList,
      country_id,
      res.item,
      farmId,
      farmName,
      productId,
      productName,
      res.newDate,
      res.harvestDateStr,
      res.quantityAdjusted,
      res.uom,
      res.extraData,
    );
  }
}
