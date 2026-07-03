import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import { stsProxyGet, stsProxyPostJson } from "@/shared/api/stsProxyClient";

export type BrandRow = {
  id: number;
  name: string;
  title?: string | null;
  vendor_id?: number | null;
  vendor_code?: string | null;
  company?: string | null;
};

export type BrandSavePayload = {
  id?: number;
  name: string;
  title?: string;
  vendor_id?: number | null;
};

export async function fetchAdminBrands(): Promise<BrandRow[]> {
  return stsProxyGet<BrandRow[]>(STS_API_PATHS.brandsAdminList);
}

export async function saveAdminBrand(payload: BrandSavePayload): Promise<BrandRow> {
  return stsProxyPostJson<BrandRow>(STS_API_PATHS.brandsSave, payload);
}

export async function removeAdminBrand(id: number): Promise<void> {
  await stsProxyPostJson(STS_API_PATHS.brandsRemove, { id });
}
