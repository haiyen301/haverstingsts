import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import {
  stsProxyGetWithParams,
  stsProxyPostJson,
} from "@/shared/api/stsProxyClient";

export type FleetStockModule = "fuel" | "fertilizer";

export type FleetFuelStockKey = string;

export type FleetStockLedgerRow = {
  id: number;
  balance_date: string;
  farm_id: number;
  module: FleetStockModule;
  stock_key: string;
  period_code?: string | null;
  opening_qty?: number | string | null;
  import_qty: number | string;
  import_amount?: number | string | null;
  usage_qty: number | string;
  remaining_qty: number | string;
  is_opening_anchor?: number | boolean;
  notes?: string | null;
  farm_name?: string | null;
};

export type FleetStockLedgerListParams = {
  farm_id?: number;
  farm_ids?: string;
  module?: FleetStockModule;
  stock_key?: string;
  balance_from?: string;
  balance_to?: string;
};

export type FleetStockLedgerSavePayload = {
  id?: number;
  balance_date: string;
  farm_id: number;
  module: FleetStockModule;
  stock_key: string;
  opening_qty?: number;
  import_qty?: number;
  import_amount?: number | null;
  is_opening_anchor?: boolean;
  notes?: string;
};

export async function fetchFleetStockLedger(
  params?: FleetStockLedgerListParams,
): Promise<FleetStockLedgerRow[]> {
  return stsProxyGetWithParams<FleetStockLedgerRow[]>(
    STS_API_PATHS.fleetStockLedger,
    params,
  );
}

export async function saveFleetStockLedger(
  payload: FleetStockLedgerSavePayload,
): Promise<FleetStockLedgerRow> {
  return stsProxyPostJson<FleetStockLedgerRow>(
    STS_API_PATHS.fleetStockLedgerSave,
    payload,
  );
}

export async function recalculateFleetStockLedger(payload: {
  farm_id: number;
  module: FleetStockModule;
  stock_key: string;
  balance_from?: string;
  balance_to?: string;
}): Promise<FleetStockLedgerRow[]> {
  return stsProxyPostJson<FleetStockLedgerRow[]>(
    STS_API_PATHS.fleetStockLedgerRecalculate,
    payload,
  );
}

export async function removeFleetStockLedger(payload: {
  id?: number;
  balance_date?: string;
  farm_id?: number;
  module?: FleetStockModule;
  stock_key?: string;
}): Promise<void> {
  await stsProxyPostJson<unknown>(STS_API_PATHS.fleetStockLedgerRemove, payload);
}
