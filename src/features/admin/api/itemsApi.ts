import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import {
  stsProxyGet,
  stsProxyGetWithParams,
  stsProxyPostJson,
} from "@/shared/api/stsProxyClient";

/** Must match `STSApi\Controllers\Items::RATE_CATEGORY_TITLES`. */
export const ITEM_RATE_CATEGORY_TITLES = [
  "FOLIAR",
  "SOIL",
  "SPECIALTY",
  "FERTILIZER",
] as const;

export type ItemRateCategoryTitle = (typeof ITEM_RATE_CATEGORY_TITLES)[number];

export function itemCategorySupportsRate(
  title: string | null | undefined,
  rateCategoryTitles: readonly string[] = ITEM_RATE_CATEGORY_TITLES,
): boolean {
  const normalized = String(title ?? "").trim();
  return rateCategoryTitles.includes(normalized);
}

export type ItemRow = {
  id: number;
  sku_sts?: string | null;
  old_sku?: string | null;
  commodity_code?: string | null;
  thai_code?: string | null;
  myanmar_code?: string | null;
  malaysia_code?: string | null;
  singapore_code?: string | null;
  commodity_name?: string | null;
  vietnamese_name?: string | null;
  thai_name?: string | null;
  description?: string | null;
  commodity_type?: number | null;
  brand_id?: number | null;
  brand_name?: string | null;
  category_id?: number | null;
  category_title?: string | null;
  unit_id?: number | null;
  unit_name?: string | null;
  purchase_price?: number | string | null;
  rate?: number | string | null;
  rate_uom?: string | null;
  show_in_client_portal?: number | boolean | null;
};

export type ItemCatalogRow = {
  id: number;
  name: string;
  default_rate: number;
  unit: string;
  rate_uom?: string | null;
  category_id?: number | null;
  brand_id?: number | null;
  sku_sts?: string;
};

export type ItemFormOptions = {
  categories: Array<{ id: number; title: string; parent_id?: number | null }>;
  brands: Array<{ id: number; name: string }>;
  units: Array<{ unit_type_id: number; unit_name: string }>;
  rate_category_titles?: string[];
};

export type ItemSavePayload = {
  id?: number;
  sku_sts?: string;
  old_sku?: string;
  commodity_code?: string;
  thai_code?: string;
  myanmar_code?: string;
  malaysia_code?: string;
  singapore_code?: string;
  commodity_name: string;
  vietnamese_name?: string;
  thai_name?: string;
  description?: string;
  commodity_type?: number | null;
  brand_id: number;
  category_id: number;
  unit_id: number;
  purchase_price?: number | string;
  rate?: number | string | null;
  rate_uom?: string | null;
  show_in_client_portal?: boolean;
};

export async function fetchAdminItems(params?: {
  search?: string;
  category_id?: number;
  brand_id?: number;
}): Promise<ItemRow[]> {
  return stsProxyGetWithParams<ItemRow[]>(STS_API_PATHS.itemsAdminList, params);
}

export async function fetchItemFormOptions(): Promise<ItemFormOptions> {
  return stsProxyGet<ItemFormOptions>(STS_API_PATHS.itemsFormOptions);
}

export async function fetchItemsCatalog(): Promise<ItemCatalogRow[]> {
  return stsProxyGet<ItemCatalogRow[]>(STS_API_PATHS.itemsCatalog);
}

/** Fertilizer Usage product dropdown — category filter configured in `Items::catalog`. */
export async function fetchFertilizerItemsCatalog(): Promise<ItemCatalogRow[]> {
  return fetchItemsCatalog();
}

export async function saveAdminItem(payload: ItemSavePayload): Promise<ItemRow> {
  return stsProxyPostJson<ItemRow>(STS_API_PATHS.itemsSave, payload);
}

export async function removeAdminItem(id: number): Promise<void> {
  await stsProxyPostJson(STS_API_PATHS.itemsRemove, { id });
}
