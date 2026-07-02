import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import { formatNumber } from "@/shared/lib/format/number";
import { buildItemCatalogSelectOption } from "@/shared/lib/format/itemProductCodes";
import {
  stsProxyGet,
  stsProxyPostJson,
} from "@/shared/api/stsProxyClient";

export type EquipmentStatus =
  | "Active"
  | "Under Maintenance"
  | "Out of Service"
  | "Retired";

export type EquipmentServiceLogType = "Scheduled" | "Unscheduled" | "Repair";

export type EquipmentServiceLog = {
  id: number;
  equipment_id: number;
  service_date: string;
  service_type: EquipmentServiceLogType | string;
  description?: string;
  hours_at_service?: number | string;
  cost?: number | string;
  performed_by_user_id?: number | null;
  performed_by_name?: string | null;
};

export type EquipmentDetail = {
  equipment: EquipmentRow;
  service_logs: EquipmentServiceLog[];
  service_types: string[];
};

export type EquipmentServiceLogSavePayload = {
  id?: number;
  equipment_id: number;
  service_date: string;
  service_type: EquipmentServiceLogType | string;
  description?: string;
  hours_at_service?: number;
  cost?: number;
  performed_by_user_id?: number | null;
};

export type EquipmentProductOption = {
  id: number;
  brand: string;
  brand_id?: number | null;
  model: string;
  model_short?: string;
  model_lines?: string[];
  equipment_name?: string;
  commodity_name?: string;
  category_id?: number | null;
  category_path?: string | null;
  sku_sts?: string;
  old_sku?: string;
  commodity_code?: string;
  thai_code?: string;
  myanmar_code?: string;
  malaysia_code?: string;
  singapore_code?: string;
};

export type EquipmentRow = {
  id: number;
  item_id?: number | null;
  equipment_name?: string;
  brand: string;
  model: string;
  model_short?: string;
  model_lines?: string[];
  type: string;
  engine_code?: string | null;
  farm_id: number;
  farm_name?: string | null;
  assigned_to_user_id?: number | null;
  assigned_to_name?: string | null;
  status: EquipmentStatus | string;
  hours_used?: number | string;
  hours_between_service?: number | string | null;
  last_service_date?: string | null;
  next_service_due?: string | null;
  notes?: string | null;
};

export type EquipmentSavePayload = {
  id?: number;
  item_id: number;
  brand?: string;
  equipment_name?: string;
  type: string;
  engine_code?: string;
  farm_id: number;
  assigned_to_user_id?: number | null;
  status?: EquipmentStatus;
  hours_used?: number;
  hours_between_service?: number;
  last_service_date?: string;
  next_service_due?: string;
  notes?: string;
};

export type EquipmentFormOptions = {
  category: {
    category_ids: number[];
    categories?: Array<{
      id: number;
      title?: string | null;
      parent_id?: number | null;
      path?: string | null;
    }>;
    category_id?: number;
    category_title?: string | null;
  };
  products: EquipmentProductOption[];
  types: Array<{ id: number; label: string; slug: string; active?: boolean }>;
};

export type EquipmentCategoryOption = {
  id: number;
  title: string;
  parent_id?: number | null;
  path?: string | null;
};

export type EquipmentCategoryConfig = {
  category: {
    category_ids: number[];
    categories?: Array<{
      id: number;
      title?: string | null;
      parent_id?: number | null;
      path?: string | null;
    }>;
    category_id?: number;
    category_title?: string | null;
  };
  categories: EquipmentCategoryOption[];
};

export async function fetchEquipmentFormOptions(): Promise<EquipmentFormOptions> {
  return stsProxyGet<EquipmentFormOptions>(STS_API_PATHS.equipmentFormOptions);
}

export async function fetchEquipmentCatalog(params?: {
  farm_id?: number;
  type?: string;
}): Promise<EquipmentRow[]> {
  const qs = new URLSearchParams();
  if (params?.farm_id != null) qs.set("farm_id", String(params.farm_id));
  if (params?.type) qs.set("type", params.type);
  const query = qs.toString();
  const path = query
    ? `${STS_API_PATHS.equipmentCatalog}?${query}`
    : STS_API_PATHS.equipmentCatalog;
  return stsProxyGet<EquipmentRow[]>(path);
}

export async function saveEquipment(
  payload: EquipmentSavePayload,
): Promise<EquipmentRow> {
  return stsProxyPostJson<EquipmentRow>(STS_API_PATHS.equipmentSave, payload);
}

export async function removeEquipment(id: number): Promise<void> {
  await stsProxyPostJson(STS_API_PATHS.equipmentRemove, { id });
}

export async function fetchEquipmentDetail(id: number): Promise<EquipmentDetail> {
  return stsProxyGet<EquipmentDetail>(`${STS_API_PATHS.equipmentDetail}?id=${id}`);
}

export async function saveEquipmentServiceLog(
  payload: EquipmentServiceLogSavePayload,
): Promise<{ service_log: EquipmentServiceLog; equipment: EquipmentRow | null }> {
  return stsProxyPostJson(STS_API_PATHS.equipmentSaveServiceLog, payload);
}

export async function removeEquipmentServiceLog(
  id: number,
  equipmentId: number,
): Promise<{ equipment: EquipmentRow | null }> {
  return stsProxyPostJson(STS_API_PATHS.equipmentRemoveServiceLog, {
    id,
    equipment_id: equipmentId,
  });
}

export function formatEquipmentCost(value: unknown): string {
  const numeric =
    typeof value === "number" || typeof value === "string" ? value : null;
  return `$${formatNumber(numeric, { maximumFractionDigits: 2 })}`;
}

export async function fetchEquipmentCategoryConfig(): Promise<EquipmentCategoryConfig> {
  return stsProxyGet<EquipmentCategoryConfig>(STS_API_PATHS.equipmentCategoryConfig);
}

export async function saveEquipmentCategory(categoryIds: number[]): Promise<{
  category_ids: number[];
  categories?: Array<{
    id: number;
    title?: string | null;
    parent_id?: number | null;
    path?: string | null;
  }>;
  category_id?: number;
  category_title?: string | null;
}> {
  return stsProxyPostJson(STS_API_PATHS.equipmentSaveCategory, {
    category_ids: categoryIds,
  });
}

export function buildEquipmentProductSelectOption(
  product: EquipmentProductOption,
): { label: string; subLabel?: string } {
  const brand = String(product.brand ?? "").trim();
  const model = String(product.model_short ?? product.equipment_name ?? "").trim();
  const primaryName =
    brand && model ? `${brand} — ${model}` : brand || model || `#${product.id}`;
  return buildItemCatalogSelectOption(primaryName, product);
}

export function equipmentProductOptionLabel(product: EquipmentProductOption): string {
  const { label, subLabel } = buildEquipmentProductSelectOption(product);
  return subLabel ? `${label} ${subLabel}` : label;
}

export function uniqueBrandsFromProducts(
  products: EquipmentProductOption[],
): string[] {
  const set = new Set<string>();
  for (const p of products) {
    const brand = String(p.brand ?? "").trim();
    if (brand) set.add(brand);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function productsForBrand(
  products: EquipmentProductOption[],
  brand: string,
): EquipmentProductOption[] {
  const b = brand.trim();
  if (!b) return products;
  return products.filter((p) => String(p.brand ?? "").trim() === b);
}
