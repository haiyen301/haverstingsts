import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import {
  stsProxyGetWithParams,
  stsProxyPostJson,
} from "@/shared/api/stsProxyClient";

export const FARM_ALIAS_CONTEXT = {
  fertilizerItem: "fertilizer_item",
  fuelVehicle: "fuel_vehicle",
} as const;

export type FarmAliasContext =
  (typeof FARM_ALIAS_CONTEXT)[keyof typeof FARM_ALIAS_CONTEXT];

export type FarmAliasRow = {
  id: number;
  farm_id: number;
  context: string;
  ref_id: number;
  alias_title: string;
  alias_name?: string | null;
};

export type FarmAliasListParams = {
  farm_id: number;
  context: FarmAliasContext;
  ref_id?: number;
};

export type FarmAliasSavePayload = {
  farm_id: number;
  context: FarmAliasContext;
  ref_id: number;
  alias_title?: string;
  alias_name?: string;
};

export async function fetchFarmAliases(
  params: FarmAliasListParams,
): Promise<FarmAliasRow[]> {
  return stsProxyGetWithParams<FarmAliasRow[]>(STS_API_PATHS.farmAliases, params);
}

export async function saveFarmAlias(
  payload: FarmAliasSavePayload,
): Promise<FarmAliasRow> {
  return stsProxyPostJson<FarmAliasRow>(STS_API_PATHS.farmAliasesSave, payload);
}

export async function removeFarmAlias(payload: {
  id?: number;
  farm_id?: number;
  context?: FarmAliasContext;
  ref_id?: number;
}): Promise<void> {
  await stsProxyPostJson(STS_API_PATHS.farmAliasesRemove, payload);
}

export function farmAliasesByRefId(
  rows: FarmAliasRow[],
): Map<number, string> {
  const map = new Map<number, string>();
  for (const row of rows) {
    const refId = Number(row.ref_id);
    const title = String(row.alias_title ?? row.alias_name ?? "").trim();
    if (Number.isFinite(refId) && refId > 0 && title) {
      map.set(refId, title);
    }
  }
  return map;
}
