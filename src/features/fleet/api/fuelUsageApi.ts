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
  /** auto = from latest import unit price; manual = user entered */
  cost_mode?: "auto" | "manual" | string | null;
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
  /** Omit to let server auto-fill from latest import. */
  cost_per_litre?: number | null;
  cost_mode?: "auto" | "manual";
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

export type FuelUsageSuggestCostResult = {
  cost_per_litre: number | null;
  cost_mode: "auto" | null;
  import: {
    import_id: number;
    import_date: string;
    import_qty: number;
    import_amount: number;
    unit_cost: number;
  } | null;
};

export async function suggestFuelUsageCost(params: {
  farm_id: number;
  fuel_date: string;
  fuel_kind?: string;
  vehicle_inspection_id?: number;
}): Promise<FuelUsageSuggestCostResult> {
  return stsProxyGetWithParams<FuelUsageSuggestCostResult>(
    STS_API_PATHS.fuelUsageSuggestCost,
    params,
  );
}

export async function removeFuelUsage(id: number): Promise<void> {
  await stsProxyPostJson(STS_API_PATHS.fuelUsageRemove, { id });
}

export type FuelUsageImportEntryPayload = {
  fuel_date: string;
  vehicle_inspection_id: number;
  vehicle_type?: string;
  fuel_kind?: string;
  litres: number;
  odometer_km?: number;
  /** Always empty for Excel import (Hoi An + Phan Thiet). */
  purpose?: string | null;
};

export type FuelStockImportEntryPayload = {
  balance_date: string;
  fuel_kind: string;
  import_qty: number;
};

export type FuelUsageImportSummary = {
  usage: {
    total: number;
    created: number;
    updated: number;
    skipped: number;
  };
  stock: {
    total: number;
    created: number;
    updated: number;
    skipped: number;
  };
};

export async function importFuelUsageBulk(payload: {
  farm_id: number;
  entries?: FuelUsageImportEntryPayload[];
  stock_imports?: FuelStockImportEntryPayload[];
}): Promise<{ summary: FuelUsageImportSummary }> {
  return stsProxyPostJson<{ summary: FuelUsageImportSummary }>(
    STS_API_PATHS.fuelUsageImportBulk,
    payload,
  );
}

export function fuelUsageVehicleLabel(
  row: Pick<FuelUsageRow, "vehicle_name" | "alias_name" | "vehicle_inspection_id">,
  lookupByInspectionId?: ReadonlyMap<string, string> | Record<string, string>,
): string {
  const alias = String(row.alias_name ?? "").trim();
  const name = String(row.vehicle_name ?? "").trim();
  if (alias && name && alias !== name) {
    return `${name} (${alias})`;
  }
  const fromRow = name || alias;
  if (fromRow) return fromRow;

  const inspectionId = String(row.vehicle_inspection_id ?? "").trim();
  if (inspectionId && lookupByInspectionId) {
    let resolved: string | undefined;
    if (lookupByInspectionId instanceof Map) {
      resolved = lookupByInspectionId.get(inspectionId);
    } else {
      resolved = (lookupByInspectionId as Record<string, string>)[inspectionId];
    }
    if (resolved) return resolved;
  }

  return "—";
}

/** Primary list line: vehicle name only (no alias in parentheses). */
export function fuelUsageVehiclePrimaryName(
  row: Pick<FuelUsageRow, "vehicle_name" | "alias_name" | "vehicle_inspection_id">,
  lookupByInspectionId?: ReadonlyMap<string, string> | Record<string, string>,
): string {
  const name = String(row.vehicle_name ?? "").trim();
  if (name) return name;

  const inspectionId = String(row.vehicle_inspection_id ?? "").trim();
  if (inspectionId && lookupByInspectionId) {
    let resolved: string | undefined;
    if (lookupByInspectionId instanceof Map) {
      resolved = lookupByInspectionId.get(inspectionId);
    } else {
      resolved = (lookupByInspectionId as Record<string, string>)[inspectionId];
    }
    if (resolved) {
      // Lookup may be "Name (alias)" — take the name part before " (".
      const paren = resolved.indexOf(" (");
      return paren > 0 ? resolved.slice(0, paren) : resolved;
    }
  }

  const alias = String(row.alias_name ?? "").trim();
  return alias || "—";
}

/** Secondary list line: "Type - Alias" or just "Type" when no distinct alias. */
export function fuelUsageVehicleTypeAliasLine(
  row: Pick<FuelUsageRow, "vehicle_type" | "vehicle_name" | "alias_name">,
): string {
  const type = String(row.vehicle_type ?? "").trim();
  const alias = String(row.alias_name ?? "").trim();
  const name = String(row.vehicle_name ?? "").trim();
  const showAlias = Boolean(alias && alias !== name);
  if (type && showAlias) return `${type} - ${alias}`;
  if (type) return type;
  if (showAlias) return alias;
  return "";
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
