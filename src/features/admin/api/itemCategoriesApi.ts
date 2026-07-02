import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import { stsProxyGet, stsProxyPostJson } from "@/shared/api/stsProxyClient";

export type ItemCategoryRow = {
  id: number;
  title: string;
  parent_id?: number | null;
  path?: string | null;
  display?: number | boolean | null;
};

export type ItemCategorySavePayload = {
  id?: number;
  title: string;
  parent_id?: number | null;
};

export async function fetchAdminItemCategories(): Promise<ItemCategoryRow[]> {
  return stsProxyGet<ItemCategoryRow[]>(STS_API_PATHS.itemCategoriesAdminList);
}

export async function saveAdminItemCategory(
  payload: ItemCategorySavePayload,
): Promise<ItemCategoryRow> {
  return stsProxyPostJson<ItemCategoryRow>(STS_API_PATHS.itemCategoriesSave, payload);
}

export async function removeAdminItemCategory(id: number): Promise<void> {
  await stsProxyPostJson(STS_API_PATHS.itemCategoriesRemove, { id });
}
