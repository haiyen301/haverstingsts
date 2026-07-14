import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import {
  stsProxyGetWithParams,
  stsProxyPostJson,
} from "@/shared/api/stsProxyClient";

export type FleetFuelImportRow = {
  id: number;
  farm_id: number;
  fuel_kind: string;
  import_date: string;
  source?: string | null;
  ledger_id?: number | null;
  import_qty: number | string;
  import_amount?: number | string | null;
  notes?: string | null;
};

export type FleetFuelImportListParams = {
  farm_id?: number;
  fuel_kind?: string;
  import_date?: string;
};

export type FleetFuelImportSavePayload = {
  id?: number;
  farm_id: number;
  fuel_kind: string;
  import_date: string;
  import_qty: number;
  import_amount?: number | null;
  notes?: string;
  source?: string;
};

export async function fetchFleetFuelImports(
  params?: FleetFuelImportListParams,
): Promise<FleetFuelImportRow[]> {
  return stsProxyGetWithParams<FleetFuelImportRow[]>(
    STS_API_PATHS.fleetFuelImports,
    params,
  );
}

export async function saveFleetFuelImport(
  payload: FleetFuelImportSavePayload,
): Promise<FleetFuelImportRow> {
  return stsProxyPostJson<FleetFuelImportRow>(
    STS_API_PATHS.fleetFuelImportsSave,
    payload,
  );
}

export async function removeFleetFuelImport(payload: {
  id: number;
}): Promise<void> {
  await stsProxyPostJson<unknown>(STS_API_PATHS.fleetFuelImportsRemove, payload);
}

export type FleetFuelImportBulkEntry = {
  farm_id: number;
  fuel_kind: string;
  import_date: string;
  import_qty: number;
  import_amount?: number | null;
  notes?: string;
};

export type FleetFuelImportBulkSummary = {
  created: number;
  skipped: number;
  total: number;
};

export async function importFleetFuelImportsBulk(payload: {
  entries: FleetFuelImportBulkEntry[];
}): Promise<{ summary: FleetFuelImportBulkSummary }> {
  return stsProxyPostJson<{ summary: FleetFuelImportBulkSummary }>(
    STS_API_PATHS.fleetFuelImportsImportBulk,
    payload,
  );
}
