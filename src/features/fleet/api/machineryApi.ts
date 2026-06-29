import { DEFAULT_MACHINERY_TYPES } from "@/features/fleet/api/machineryTypesApi";
import type { MachineryProductOption } from "@/features/fleet/lib/machineryProductCatalog";
import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import {
  stsProxyGet,
  stsProxyGetWithParams,
  stsProxyPostJson,
} from "@/shared/api/stsProxyClient";

export type MachineryStatus =
  | "Active"
  | "Under Maintenance"
  | "Out of Service"
  | "Retired";

export type OwnershipType = "Owned" | "Leased" | "Rented";

export type MachineryRow = {
  id: number;
  item_id?: number;
  brand: string;
  model: string;
  type: string;
  serial_number?: string | null;
  registration_number?: string | null;
  year_of_manufacture?: number | null;
  purchase_date?: string | null;
  ownership?: OwnershipType | string;
  farm_id: number;
  farm_name?: string | null;
  assigned_to_user_id?: number | null;
  assigned_to_name?: string | null;
  status: MachineryStatus | string;
  hours_used?: number | string;
  hours_between_service?: number | string | null;
  last_service_date?: string | null;
  next_service_due?: string | null;
  fuel_type?: string | null;
  notes?: string | null;
  odoo_id?: string | null;
  product_item_id?: number | null;
};

export type MachinerySavePayload = {
  id?: number;
  brand: string;
  model: string;
  type: string;
  farm_id: number;
  serial_number?: string;
  registration_number?: string;
  year_of_manufacture?: number;
  purchase_date?: string;
  ownership?: OwnershipType;
  assigned_to_user_id?: number | null;
  status?: MachineryStatus;
  hours_used?: number;
  hours_between_service?: number;
  last_service_date?: string;
  next_service_due?: string;
  fuel_type?: string;
  notes?: string;
  odoo_id?: string | null;
  product_item_id?: number | null;
};

/** @deprecated Prefer `useMachineryTypes()` — loaded from sts_settings (fleet_machinery_types). */
export const MACHINERY_TYPES = DEFAULT_MACHINERY_TYPES;

export const MACHINERY_FUEL_TYPES = [
  "Diesel",
  "Petrol",
  "Electric",
  "Hybrid",
  "LPG",
  "N/A",
] as const;

export async function fetchMachineryProducts(): Promise<MachineryProductOption[]> {
  return stsProxyGet<MachineryProductOption[]>(STS_API_PATHS.machineryProducts);
}

export async function fetchMachinery(params?: {
  farm_id?: number;
  status?: string;
  type?: string;
}): Promise<MachineryRow[]> {
  return stsProxyGetWithParams<MachineryRow[]>(STS_API_PATHS.machinery, params);
}

export async function fetchMachineryCatalog(params?: {
  farm_id?: number;
  type?: string;
}): Promise<MachineryRow[]> {
  return stsProxyGetWithParams<MachineryRow[]>(STS_API_PATHS.machineryCatalog, params);
}

export async function saveMachinery(payload: MachinerySavePayload): Promise<MachineryRow> {
  return stsProxyPostJson<MachineryRow>(STS_API_PATHS.machinerySave, payload);
}

export async function removeMachinery(id: number): Promise<void> {
  await stsProxyPostJson(STS_API_PATHS.machineryRemove, { id });
}

export type StaffOption = {
  id: number | string;
  first_name?: string;
  last_name?: string;
};

export async function fetchStaffOptions(): Promise<StaffOption[]> {
  return stsProxyGet<StaffOption[]>(STS_API_PATHS.staffs);
}
