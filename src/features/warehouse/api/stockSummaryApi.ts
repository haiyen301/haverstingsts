import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import { buildStsProxyGetUrl, stsProxyPostJson } from "@/shared/api/stsProxyClient";
import type {
  StockSummaryImportInputRow,
  StockSummaryImportPreview,
} from "@/features/warehouse/lib/stockSummaryImport";

export type StockSummaryRow = {
  id?: number;
  brand_id?: number | null;
  brand_name?: string | null;
  category_title?: string | null;
  sku_sts?: string | null;
  commodity_code?: string | null;
  thai_code?: string | null;
  malaysia_code?: string | null;
  myanmar_code?: string | null;
  singapore_code?: string | null;
  old_sku?: string | null;
  commodity_name?: string | null;
  unit_name?: string | null;
  country_code?: string | null;
  on_hand?: number | string | null;
  last_update?: string | null;
};

export type StockSummaryListParams = {
  country_id?: number | string;
  brand_id?: number | string;
  /** Comma-separated category ids (parent + descendants). */
  category_id?: string;
  search?: string;
  page?: number;
  per_page?: number;
};

export type StockSummaryPageResult = {
  rows: StockSummaryRow[];
  totalPages: number;
  totalRecords: number | null;
  message?: string;
};

type WarehouseIndexJson = {
  success?: boolean;
  data?: unknown;
  message?: string;
  /** Last page number from API. */
  total?: number;
  total_records?: number;
};

export const STOCK_SUMMARY_PAGE_SIZE = 50;

export async function fetchStockSummaryPage(
  params?: StockSummaryListParams,
): Promise<StockSummaryPageResult> {
  if (typeof window === "undefined") {
    throw new Error("fetchStockSummaryPage is client-only");
  }

  const url = buildStsProxyGetUrl(STS_API_PATHS.warehouse, {
    country_id: params?.country_id,
    brand_id: params?.brand_id,
    category_id: params?.category_id,
    search: params?.search,
    page: params?.page ?? 1,
    per_page: params?.per_page ?? STOCK_SUMMARY_PAGE_SIZE,
  });

  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });

  let json: WarehouseIndexJson;
  try {
    json = (await res.json()) as WarehouseIndexJson;
  } catch {
    throw new Error("Invalid JSON response");
  }

  if (!json?.success) {
    const message = json?.message ?? `Request failed (${res.status})`;
    throw new Error(message);
  }

  const rows = Array.isArray(json.data) ? (json.data as StockSummaryRow[]) : [];
  const totalPages = Math.max(1, Number(json.total) || 1);
  const hasTotalRecords =
    Object.prototype.hasOwnProperty.call(json, "total_records") &&
    json.total_records != null;
  const totalRecords = hasTotalRecords ? Math.max(0, Number(json.total_records) || 0) : null;

  return {
    rows,
    totalPages,
    totalRecords,
    message: json.message,
  };
}

/** @deprecated Use `fetchStockSummaryPage` for paginated lists. */
export async function fetchStockSummaryRows(
  params?: StockSummaryListParams,
): Promise<StockSummaryRow[]> {
  const page = await fetchStockSummaryPage(params);
  return page.rows;
}

export async function previewStockSummaryImport(params: {
  rows: StockSummaryImportInputRow[];
  country_id?: number | string;
}): Promise<StockSummaryImportPreview> {
  return stsProxyPostJson<StockSummaryImportPreview>(
    STS_API_PATHS.warehousePreviewImportFast,
    params,
  );
}

export async function commitStockSummaryImport(params: {
  rows: StockSummaryImportInputRow[];
  country_id?: number | string;
}): Promise<StockSummaryImportPreview> {
  return stsProxyPostJson<StockSummaryImportPreview>(
    STS_API_PATHS.warehouseImportFast,
    params,
  );
}
