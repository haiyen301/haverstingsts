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

export type VehicleInspectionFormOptions = {
  statuses: InspectionStatusOption[];
};

export type VehicleInspectionRow = {
  id: number;
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
  vehicle_name: string;
  alias_name?: string | null;
  vehicle_type: string;
  fuel_kind?: string | null;
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

function normalizeVehicleInspectionFuelKind(
  fuelKind: string | null | undefined,
): string {
  return String(fuelKind ?? "").trim().toLowerCase();
}

export function findVehicleInspectionDuplicate(
  rows: VehicleInspectionRow[],
  candidate: {
    vehicle_name: string;
    vehicle_type: string;
    fuel_kind?: string | null;
    farm_id: number;
  },
  excludeId = 0,
): VehicleInspectionRow | null {
  const vehicleName = candidate.vehicle_name.trim().toLowerCase();
  const vehicleType = candidate.vehicle_type.trim();
  const fuelKind = normalizeVehicleInspectionFuelKind(candidate.fuel_kind);
  const farmId = candidate.farm_id;

  if (!vehicleName || !vehicleType || !Number.isFinite(farmId) || farmId <= 0) {
    return null;
  }

  for (const row of rows) {
    if (Number(row.id) === Number(excludeId)) continue;
    if (Number(row.farm_id) !== farmId) continue;
    if (String(row.vehicle_type ?? "").trim() !== vehicleType) continue;
    if (String(row.vehicle_name ?? "").trim().toLowerCase() !== vehicleName) continue;
    if (normalizeVehicleInspectionFuelKind(row.fuel_kind) !== fuelKind) continue;
    return row;
  }

  return null;
}
