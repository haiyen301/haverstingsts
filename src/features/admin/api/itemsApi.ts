import type {
  ItemImportCommitResult,
  ItemImportInputRow,
  ItemImportPreview,
} from "@/features/admin/lib/itemsImport";
import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import {
  buildStsProxyGetUrl,
  stsProxyGet,
  stsProxyGetWithParams,
  stsProxyPostJson,
} from "@/shared/api/stsProxyClient";

/** Fallback when API does not return rate_category_titles (configured in sts_settings). */
export const ITEM_RATE_CATEGORY_TITLES = [
  "FOLIAR",
  "SOIL",
  "SPECIALTY",
  "FERTILIZER",
] as const;

export type ItemRateCategoryTitle = (typeof ITEM_RATE_CATEGORY_TITLES)[number];

import { DEFAULT_FUEL_TYPES } from "@/features/fleet/api/fleetOptionCatalogApi";

export type MachineFuelTypeOption = {
  value: string;
  label: string;
};

export function machineFuelTypeSelectOptions(
  catalog: MachineFuelTypeOption[] | null | undefined,
): MachineFuelTypeOption[] {
  return catalog?.length ? catalog : [...DEFAULT_FUEL_TYPES];
}

/** Map legacy `petro` to `petrol` when the catalog uses petrol. */
export function normalizeMachineFuelTypeValue(
  raw: string,
  catalog: MachineFuelTypeOption[],
): string {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if (trimmed.toLowerCase() === "petro" && catalog.some((row) => row.value === "petrol")) {
    return "petrol";
  }
  const match = catalog.find(
    (row) => row.value === trimmed || row.value.toLowerCase() === trimmed.toLowerCase(),
  );
  return match?.value ?? trimmed;
}

export function isAllowedMachineFuelType(
  value: string,
  catalog: MachineFuelTypeOption[],
): boolean {
  const normalized = normalizeMachineFuelTypeValue(value, catalog);
  return catalog.some((row) => row.value === normalized);
}

export function itemCategoryIsMachine(title: string | null | undefined): boolean {
  return String(title ?? "").trim().toUpperCase() === "MACHINE";
}

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
  machine_fuel_type?: string | null;
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
  sku_sts?: string | null;
  commodity_code?: string | null;
  thai_code?: string | null;
  myanmar_code?: string | null;
  malaysia_code?: string | null;
  singapore_code?: string | null;
};

export type ItemFormOptions = {
  categories: Array<{ id: number; title: string; parent_id?: number | null; path?: string | null }>;
  brands: Array<{ id: number; name: string }>;
  units: Array<{ unit_type_id: number; unit_name: string }>;
  rate_category_titles?: string[];
  /** MACHINE category fuel dropdown — from fleet_fuel_types in app settings. */
  machine_fuel_types?: MachineFuelTypeOption[];
};

export type ItemSavePayload = {
  id?: number;
  sku_sts: string;
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
  machine_fuel_type?: string | null;
  show_in_client_portal?: boolean;
};

export const ADMIN_ITEMS_PAGE_SIZE = 50;

export type AdminItemsListParams = {
  search?: string;
  category_id?: number;
  brand_id?: number;
  page?: number;
  per_page?: number;
};

export type AdminItemsPageResult = {
  rows: ItemRow[];
  totalPages: number;
  totalRecords: number | null;
};

type AdminItemsListJson = {
  success?: boolean;
  data?: unknown;
  message?: string;
  total?: number;
  total_records?: number;
};

export async function fetchAdminItemsPage(
  params?: AdminItemsListParams,
): Promise<AdminItemsPageResult> {
  if (typeof window === "undefined") {
    throw new Error("fetchAdminItemsPage is client-only");
  }

  const url = buildStsProxyGetUrl(STS_API_PATHS.itemsAdminList, {
    search: params?.search,
    category_id: params?.category_id,
    brand_id: params?.brand_id,
    page: params?.page ?? 1,
    per_page: params?.per_page ?? ADMIN_ITEMS_PAGE_SIZE,
  });

  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });

  let json: AdminItemsListJson;
  try {
    json = (await res.json()) as AdminItemsListJson;
  } catch {
    throw new Error("Invalid JSON response");
  }

  if (!json?.success) {
    throw new Error(json?.message ?? `Request failed (${res.status})`);
  }

  const rows = Array.isArray(json.data) ? (json.data as ItemRow[]) : [];
  const totalPages = Math.max(1, Number(json.total) || 1);
  const totalRecords =
    json.total_records != null && Number.isFinite(Number(json.total_records))
      ? Number(json.total_records)
      : null;

  return { rows, totalPages, totalRecords };
}

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

/** Fertilizer Usage product dropdown — category filter configured in sts_settings (fleet_fertilizer_usage_category). */
export async function fetchFertilizerItemsCatalog(): Promise<ItemCatalogRow[]> {
  return fetchItemsCatalog();
}

export async function saveAdminItem(payload: ItemSavePayload): Promise<ItemRow> {
  return stsProxyPostJson<ItemRow>(STS_API_PATHS.itemsSave, payload);
}

export async function removeAdminItem(id: number): Promise<void> {
  await stsProxyPostJson(STS_API_PATHS.itemsRemove, { id });
}

export async function previewItemsImport(
  rows: ItemImportInputRow[],
): Promise<ItemImportPreview> {
  return stsProxyPostJson<ItemImportPreview>(STS_API_PATHS.itemsImportPreview, { rows });
}

export async function commitItemsImport(
  rows: ItemImportInputRow[],
): Promise<ItemImportCommitResult> {
  return stsProxyPostJson<ItemImportCommitResult>(STS_API_PATHS.itemsImportCommit, { rows });
}
