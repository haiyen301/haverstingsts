import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import {
  stsProxyGetWithParams,
  stsProxyPostJson,
} from "@/shared/api/stsProxyClient";

export type FertilizerUsageRow = {
  id: number;
  applied_date: string;
  farm_id: number;
  grass_id: number;
  zone_id: number | string;
  item_id: number;
  amount: number | string;
  rate?: number | string | null;
  rate_uom?: string | null;
  operator_id?: number | string | null;
  operator_name?: string | null;
  notes?: string | null;
  farm_name?: string | null;
  grass_name?: string | null;
  product_name?: string | null;
  product_unit?: string | null;
  zone_name?: string | null;
};

export type FertilizerUsageSavePayload = {
  id?: number;
  applied_date: string;
  farm_id: number;
  grass_id: number;
  zone_id: number | string;
  item_id: number;
  amount: number;
  rate?: number | null;
  rate_uom?: string | null;
  operator_id?: number;
  notes?: string;
};

export type FertilizerUsageListParams = {
  farm_id?: number;
  farm_ids?: string;
  applied_from?: string;
  applied_to?: string;
  period?: "all" | "month" | "quarter" | "year";
};

export async function fetchFertilizerUsage(
  params?: FertilizerUsageListParams,
): Promise<FertilizerUsageRow[]> {
  return stsProxyGetWithParams<FertilizerUsageRow[]>(
    STS_API_PATHS.fertilizerUsage,
    params,
  );
}

export async function saveFertilizerUsage(
  payload: FertilizerUsageSavePayload,
): Promise<FertilizerUsageRow> {
  return stsProxyPostJson<FertilizerUsageRow>(STS_API_PATHS.fertilizerUsageSave, payload);
}

export async function removeFertilizerUsage(id: number): Promise<void> {
  await stsProxyPostJson(STS_API_PATHS.fertilizerUsageRemove, { id });
}
