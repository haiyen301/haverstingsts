export type ForecastHarvestRow = {
  id: string;
  farmId: number;
  productId: number;
  farm: string;
  grassType: string;
  zone?: string;
  project?: string;
  customer?: string;
  harvestType: "sod" | "sprig" | "sod_for_sprig";
  harvestDate: string;
  readyDate: string;
  /** Magnitude đã chuẩn hoá: Sod/Sod→Sprig/M² → m² từ `harvested_area`; Sprig/Kg → kg từ `quantity`. */
  quantity: number;
  /** `harvested_area` từ plan (m²). Sprig: mẫu số kg/m²; Sod/M²: nguồn magnitude. */
  harvestedAreaM2: number;
  /** Sprig: kg/m² từ API hoặc `quantity`÷`harvestedAreaM2`. Sod/M²: thường 0. */
  kgPerM2?: number;
  isReady: boolean;
  daysUntilReady: number;
  /** Kg / M2 từ plan — để nhãn biểu đồ */
  uom?: string;
  /**
   * Kg dùng trừ tồn / chart:
   * - Sod / M²: convert từ `harvested_area` × zone kg/m².
   * - Sod → Sprig: plan `quantity` (không nhân m² × tỷ lệ).
   * - Sprig / Kg: từ `quantity` (kg), có thể cap theo zone.
   */
  inventoryKg: number;
  /** Đã bị cắt về max_inventory_kg khi convert từ m² → kg. */
  inventoryIsCapped: boolean;
  /** Trần tồn kho áp dụng cho group farm_id + zone + product_id. */
  zoneMaxInventoryKg: number;
  /**
   * Phần `inventoryKg` của dòng này đến từ plan **không gán zone** rồi được spread vào zone hiện tại
   * (`distributePlanRowToZoneFragments`). Dùng regrowth / tooltip để biết bao nhiêu kg trên zone có nguồn từ bước đó.
   */
  inventoryKgFromNozoneSpread?: number;
};
