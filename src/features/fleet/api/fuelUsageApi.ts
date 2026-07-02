import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import {
  stsProxyGetWithParams,
  stsProxyPostJson,
} from "@/shared/api/stsProxyClient";

export type FuelUsageRow = {
  id: number;
  fuel_date: string;
  farm_id: number;
  vehicle_inspection_id: number;
  vehicle_type: string;
  fuel_kind?: string | null;
  litres: number | string;
  remaining_litres?: number | string | null;
  cost_per_litre?: number | string | null;
  odometer_km?: number | null;
  operator_id?: number | string | null;
  purpose?: string | null;
  farm_name?: string | null;
  vehicle_name?: string | null;
  alias_name?: string | null;
  operator_name?: string | null;
};

export type FuelUsageSavePayload = {
  id?: number;
  fuel_date: string;
  farm_id: number;
  vehicle_inspection_id: number;
  vehicle_type?: string;
  litres: number;
  cost_per_litre?: number;
  odometer_km?: number;
  operator_id?: number;
  purpose?: string;
};

export type FuelUsageListParams = {
  farm_id?: number;
  farm_ids?: string;
  fuel_from?: string;
  fuel_to?: string;
  period?: "all" | "today" | "week" | "month" | "quarter";
};

export async function fetchFuelUsage(params?: FuelUsageListParams): Promise<FuelUsageRow[]> {
  return stsProxyGetWithParams<FuelUsageRow[]>(STS_API_PATHS.fuelUsage, params);
}

export async function saveFuelUsage(
  payload: FuelUsageSavePayload,
): Promise<FuelUsageRow> {
  return stsProxyPostJson<FuelUsageRow>(STS_API_PATHS.fuelUsageSave, payload);
}

export async function removeFuelUsage(id: number): Promise<void> {
  await stsProxyPostJson(STS_API_PATHS.fuelUsageRemove, { id });
}

export function fuelUsageVehicleLabel(row: Pick<
  FuelUsageRow,
  "vehicle_name" | "alias_name"
>): string {
  const alias = String(row.alias_name ?? "").trim();
  const name = String(row.vehicle_name ?? "").trim();
  if (alias && name && alias !== name) {
    return `${alias} (${name})`;
  }
  return alias || name || "—";
}

export function fuelUsageFuelKindLabel(
  kind: string | null | undefined,
  catalogLabels: Record<string, string>,
  fallback: { diesel: string; petrol: string },
): string {
  const raw = String(kind ?? "").trim();
  if (!raw) return "—";
  const normalized = raw.toLowerCase();
  if (catalogLabels[normalized]) return catalogLabels[normalized];
  if (normalized === "diesel" || normalized === "dau" || normalized === "dầu") {
    return fallback.diesel;
  }
  if (
    normalized === "petrol" ||
    normalized === "petro" ||
    normalized === "gasoline" ||
    normalized === "gas" ||
    normalized === "xang" ||
    normalized === "xăng"
  ) {
    return fallback.petrol;
  }
  return raw;
}
