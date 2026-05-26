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
  /** Số lượng từ plan, giữ nguyên UOM gốc (kg hoặc m², v.v.). */
  quantity: number;
  /** Harvested area (m²) from plan — sprig kg/m² bands */
  harvestedAreaM2: number;
  /** Density from plan/API (`kg_per_m2`); else derived as quantity ÷ harvestedAreaM2 */
  kgPerM2?: number;
  isReady: boolean;
  daysUntilReady: number;
  /** Kg / M2 từ plan — để nhãn biểu đồ */
  uom?: string;
  /**
   * Lượng inventory đã chuẩn hoá theo kg để dùng cho forecasting:
   * - Nếu UOM đã là kg → bằng `quantity`.
   * - Nếu UOM là m² → convert theo Zone Configuration (inventory_kg_per_m2, max_inventory_kg).
   * - Nếu không convert được → fallback = `quantity`.
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
