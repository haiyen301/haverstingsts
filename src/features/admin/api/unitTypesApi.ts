import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import { stsProxyGet, stsProxyPostJson } from "@/shared/api/stsProxyClient";

export type UnitTypeRow = {
  unit_type_id: number;
  unit_code?: string | null;
  unit_name: string;
  unit_symbol?: string | null;
  order?: number | null;
  display?: number | boolean | null;
  note?: string | null;
};

export type UnitTypeSavePayload = {
  unit_type_id?: number;
  unit_code?: string;
  unit_name: string;
  unit_symbol?: string;
  order?: number;
  display?: boolean;
  note?: string;
};

export async function fetchAdminUnitTypes(): Promise<UnitTypeRow[]> {
  return stsProxyGet<UnitTypeRow[]>(STS_API_PATHS.wareUnitTypesAdminList);
}

export async function saveAdminUnitType(payload: UnitTypeSavePayload): Promise<UnitTypeRow> {
  return stsProxyPostJson<UnitTypeRow>(STS_API_PATHS.wareUnitTypesSave, payload);
}

export async function removeAdminUnitType(unitTypeId: number): Promise<void> {
  await stsProxyPostJson(STS_API_PATHS.wareUnitTypesRemove, { unit_type_id: unitTypeId });
}
