import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import {
  stsProxyGet,
  stsProxyGetWithParams,
  stsProxyPostJson,
} from "@/shared/api/stsProxyClient";

export type InspectionStatusOption = {
  value: string;
  label: string;
};

export type VehicleInspectionItemOption = {
  id: number;
  name: string;
  label: string;
  brand?: string | null;
  sku_sts?: string | null;
  commodity_code?: string | null;
  thai_code?: string | null;
  myanmar_code?: string | null;
  malaysia_code?: string | null;
  singapore_code?: string | null;
  machine_fuel_type?: string | null;
};

export type VehicleInspectionFormOptions = {
  statuses: InspectionStatusOption[];
  vehicles: VehicleInspectionItemOption[];
};

export type VehicleInspectionRow = {
  id: number;
  item_id?: number | null;
  machinery_id?: number | null;
  vehicle_name: string;
  alias_name?: string | null;
  vehicle_type: string;
  fuel_kind?: string | null;
  farm_id: number;
  farm_name?: string | null;
  registration?: string | null;
  last_inspection_date?: string | null;
  next_due_date?: string | null;
  status: string;
  defects?: string | null;
  notes?: string | null;
};

export type VehicleInspectionSavePayload = {
  id?: number;
  item_id?: number | null;
  machinery_id?: number | null;
  vehicle_name: string;
  alias_name?: string | null;
  vehicle_type: string;
  farm_id: number;
  registration?: string;
  last_inspection_date?: string;
  next_due_date?: string;
  status?: string;
  defects?: string;
  notes?: string;
};

export async function fetchVehicleInspectionFormOptions(): Promise<VehicleInspectionFormOptions> {
  return stsProxyGet<VehicleInspectionFormOptions>(
    STS_API_PATHS.vehicleInspectionsFormOptions,
  );
}

export async function fetchVehicleInspections(params?: {
  farm_id?: number;
  status?: string;
}): Promise<VehicleInspectionRow[]> {
  return stsProxyGetWithParams<VehicleInspectionRow[]>(
    STS_API_PATHS.vehicleInspections,
    params,
  );
}

export async function saveVehicleInspection(
  payload: VehicleInspectionSavePayload,
): Promise<VehicleInspectionRow> {
  return stsProxyPostJson<VehicleInspectionRow>(
    STS_API_PATHS.vehicleInspectionsSave,
    payload,
  );
}

export async function removeVehicleInspection(id: number): Promise<void> {
  await stsProxyPostJson(STS_API_PATHS.vehicleInspectionsRemove, { id });
}

export function hasDefectsText(defects: string | null | undefined): boolean {
  return String(defects ?? "").trim().length > 0;
}

export function defectsPreview(defects: string | null | undefined, maxLen = 80): string {
  const text = String(defects ?? "").trim();
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen).trim()}…`;
}
