import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import {
  stsProxyGetWithParams,
  stsProxyPostJson,
} from "@/shared/api/stsProxyClient";

export const FLEET_OPTION_CATALOG_KEYS = {
  inspectionStatuses: "fleet_vehicle_inspection_statuses",
  equipmentServiceTypes: "fleet_equipment_service_types",
  fuelTypes: "fleet_fuel_types",
} as const;

export type FleetOptionCatalogKey =
  (typeof FLEET_OPTION_CATALOG_KEYS)[keyof typeof FLEET_OPTION_CATALOG_KEYS];

export type FleetOptionCatalogRow = {
  id: number;
  value: string;
  label: string;
  sort_order: number;
  active: boolean;
};

export type FleetOption = {
  value: string;
  label: string;
};

export const DEFAULT_INSPECTION_STATUSES: FleetOption[] = [
  { value: "pass", label: "Passed" },
  { value: "fail", label: "Failed" },
  { value: "due", label: "Due Soon" },
  { value: "overdue", label: "Overdue" },
];

export const DEFAULT_EQUIPMENT_SERVICE_TYPES: FleetOption[] = [
  { value: "Scheduled", label: "Scheduled" },
  { value: "Unscheduled", label: "Unscheduled" },
  { value: "Repair", label: "Repair" },
];

export const DEFAULT_FUEL_TYPES: FleetOption[] = [
  { value: "diesel", label: "Diesel" },
  { value: "petrol", label: "Petrol" },
  { value: "engine_oil_grease", label: "Engine Oil, Grease" },
];

const DEFAULTS: Record<FleetOptionCatalogKey, FleetOption[]> = {
  [FLEET_OPTION_CATALOG_KEYS.inspectionStatuses]: DEFAULT_INSPECTION_STATUSES,
  [FLEET_OPTION_CATALOG_KEYS.equipmentServiceTypes]: DEFAULT_EQUIPMENT_SERVICE_TYPES,
  [FLEET_OPTION_CATALOG_KEYS.fuelTypes]: DEFAULT_FUEL_TYPES,
};

export function fleetOptionCatalogDefaults(catalog: FleetOptionCatalogKey): FleetOption[] {
  return [...DEFAULTS[catalog]];
}

export async function fetchFleetOptionCatalog(
  catalog: FleetOptionCatalogKey,
  admin = false,
): Promise<FleetOptionCatalogRow[]> {
  return stsProxyGetWithParams<FleetOptionCatalogRow[]>(STS_API_PATHS.fleetOptionCatalogs, {
    catalog,
    ...(admin ? { admin: 1 } : {}),
  });
}

export async function saveFleetOptionCatalogRow(
  catalog: FleetOptionCatalogKey,
  payload: {
    id?: number;
    value?: string;
    label: string;
    sort_order?: number;
    active?: boolean;
  },
): Promise<FleetOptionCatalogRow> {
  return stsProxyPostJson<FleetOptionCatalogRow>(STS_API_PATHS.fleetOptionCatalogsSave, {
    catalog,
    ...payload,
  });
}

export async function removeFleetOptionCatalogRow(
  catalog: FleetOptionCatalogKey,
  id: number,
): Promise<void> {
  await stsProxyPostJson(STS_API_PATHS.fleetOptionCatalogsRemove, { catalog, id });
}

export function fleetOptionCatalogToOptions(
  rows: FleetOptionCatalogRow[] | null | undefined,
  catalog: FleetOptionCatalogKey,
): FleetOption[] {
  if (!rows?.length) return fleetOptionCatalogDefaults(catalog);
  return rows
    .filter((row) => row.active !== false)
    .map((row) => ({ value: row.value, label: row.label }));
}

export function fleetOptionCatalogValues(
  rows: FleetOptionCatalogRow[] | null | undefined,
  catalog: FleetOptionCatalogKey,
): string[] {
  return fleetOptionCatalogToOptions(rows, catalog).map((row) => row.value);
}
