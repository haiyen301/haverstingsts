import type { FuelUsageRow } from "@/features/fleet/api/fuelUsageApi";
import type { FleetStockLedgerRow } from "@/features/fleet/api/fleetStockLedgerApi";

import {
  type FuelUsageBalanceIndex,
  fuelLedgerMovementRemaining,
  fuelRowRemainingLitres,
  normalizeFuelKind,
} from "./fuelUsageBalance";

export type FuelListDisplayRow =
  | { kind: "usage"; row: FuelUsageRow }
  | { kind: "opening"; ledger: FleetStockLedgerRow }
  | { kind: "import"; ledger: FleetStockLedgerRow };

function dateYmd(value: string): string {
  return String(value).slice(0, 10);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isOpeningAnchor(row: FleetStockLedgerRow): boolean {
  return Number(row.is_opening_anchor) === 1 || row.is_opening_anchor === true;
}

function rowDate(row: FuelListDisplayRow): string {
  if (row.kind === "usage") return dateYmd(row.row.fuel_date);
  return dateYmd(row.ledger.balance_date);
}

function withinDaySortOrder(row: FuelListDisplayRow): number {
  if (row.kind === "opening") return 0;
  if (row.kind === "import") return 1;
  return 100 + Number(row.row.id);
}

export function buildFuelListDisplayRows(opts: {
  usageRows: FuelUsageRow[];
  ledgerRows: FleetStockLedgerRow[];
}): FuelListDisplayRow[] {
  const { usageRows, ledgerRows } = opts;
  const items: FuelListDisplayRow[] = [];

  for (const row of usageRows) {
    items.push({ kind: "usage", row });
  }

  for (const ledger of ledgerRows) {
    if (String(ledger.module) !== "fuel") continue;
    const openingQty = num(ledger.opening_qty);
    const importQty = num(ledger.import_qty);

    if (isOpeningAnchor(ledger) && openingQty > 0) {
      items.push({ kind: "opening", ledger });
    }
    if (importQty > 0) {
      items.push({ kind: "import", ledger });
    }
  }

  items.sort((a, b) => {
    const dateCmp = rowDate(b).localeCompare(rowDate(a));
    if (dateCmp !== 0) return dateCmp;
    return withinDaySortOrder(a) - withinDaySortOrder(b);
  });

  return items;
}

export function fuelListDisplayRowKey(row: FuelListDisplayRow): string {
  if (row.kind === "usage") return `usage-${row.row.id}`;
  if (row.kind === "opening") return `ledger-opening-${row.ledger.id}`;
  return `ledger-import-${row.ledger.id}`;
}

export function fuelListRowLitres(row: FuelListDisplayRow): number {
  if (row.kind === "usage") return num(row.row.litres);
  if (row.kind === "opening") return num(row.ledger.opening_qty);
  return num(row.ledger.import_qty);
}

export function fuelListRowFuelKind(row: FuelListDisplayRow): string {
  if (row.kind === "usage") return normalizeFuelKind(row.row.fuel_kind);
  return String(row.ledger.stock_key ?? "").trim().toLowerCase();
}

export function fuelListRowRemaining(
  row: FuelListDisplayRow,
  balanceIndex: FuelUsageBalanceIndex,
): number | null {
  if (row.kind === "usage") {
    return fuelRowRemainingLitres(row.row, balanceIndex);
  }
  const farmId = Number(row.ledger.farm_id);
  const fuelKind = String(row.ledger.stock_key ?? "").trim().toLowerCase();
  return fuelLedgerMovementRemaining(
    balanceIndex,
    farmId,
    fuelKind,
    row.kind,
    row.ledger.balance_date,
  );
}
