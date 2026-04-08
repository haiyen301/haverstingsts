/**
 * Cùng quy tắc với `Project_harvesting_plan_model::get_details`:
 * ngày harvest hiệu lực = `actual_harvest_date` nếu có và hợp lệ, không thì `estimated_harvest_date`.
 */
export function isValidHarvestDateString(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s || s === "0000-00-00") return false;
  return true;
}

/** Chuỗi `Y-m-d` cho lọc / hiển thị (ưu tiên actual). */
export function effectiveHarvestDateYmd(
  r: Record<string, unknown>,
): string | null {
  const actual = r.actual_harvest_date;
  const est = r.estimated_harvest_date;
  if (isValidHarvestDateString(actual)) return actual.trim().slice(0, 10);
  if (isValidHarvestDateString(est)) return est.trim().slice(0, 10);
  return null;
}

export function deriveHarvestListStatus(
  r: Record<string, unknown>,
): "done" | "progressing" {
  return isValidHarvestDateString(r.actual_harvest_date) ? "done" : "progressing";
}

/**
 * Khoảng từ ngày gặt đến ngày regrowth xong có giao với [from, to] không.
 * Dùng để không loại dòng chỉ vì **gặt** nằm ngoài tháng đang xem (vd. gặt T4, regrowth T6
 * vẫn hiện khi chọn T5–T6).
 */
export function harvestRegrowthWindowOverlapsRange(
  harvestYmd: string,
  readyYmd: string,
  range: { from?: string; to?: string },
): boolean {
  if (!range.from && !range.to) return true;
  const from = range.from ?? "0000-01-01";
  const to = range.to ?? "9999-12-31";
  return harvestYmd <= to && readyYmd >= from;
}

/**
 * Ngày `Y-m-d` dùng để xác định đã regrowth xong chưa (Available vs Growing):
 * - Có `to`: `min(hôm nay, to)` — nếu khoảng lọc đã kết thúc trong quá khứ, xem trạng thái **tại ngày cuối khoảng**.
 * - Không có `to`: hôm nay.
 */
export function inventoryReferenceYmd(
  harvestDateRange: { from?: string; to?: string },
  todayYmd: string,
): string {
  const to = harvestDateRange.to?.trim();
  if (!to) return todayYmd;
  return to < todayYmd ? to : todayYmd;
}
