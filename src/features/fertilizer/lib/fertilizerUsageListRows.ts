import type { FertilizerUsageRow } from "@/features/fertilizer/api/fertilizerUsageApi";
import type { FleetStockLedgerRow } from "@/features/fleet/api/fleetStockLedgerApi";

import {
  type FertilizerUsageBalanceIndex,
  farmItemBalanceKey,
} from "./fertilizerUsageBalance";

export type FertilizerListDisplayRow =
  | { kind: "usage"; row: FertilizerUsageRow }
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

function rowDate(row: FertilizerListDisplayRow): string {
  if (row.kind === "usage") return dateYmd(row.row.applied_date);
  return dateYmd(row.ledger.balance_date);
}

function withinDaySortOrder(row: FertilizerListDisplayRow): number {
  if (row.kind === "opening") return 0;
  if (row.kind === "import") return 1;
  return 100 + Number(row.row.id);
}

function rowKey(row: FertilizerListDisplayRow): string {
  if (row.kind === "usage") return `usage-${row.row.id}`;
  if (row.kind === "opening") return `ledger-opening-${row.ledger.id}`;
  return `ledger-import-${row.ledger.id}`;
}

export function buildFertilizerListDisplayRows(opts: {
  usageRows: FertilizerUsageRow[];
  ledgerRows: FleetStockLedgerRow[];
}): FertilizerListDisplayRow[] {
  const { usageRows, ledgerRows } = opts;
  const items: FertilizerListDisplayRow[] = [];

  for (const row of usageRows) {
    items.push({ kind: "usage", row });
  }

  for (const ledger of ledgerRows) {
    if (String(ledger.module) !== "fertilizer") continue;
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

export function fertilizerListDisplayRowKey(row: FertilizerListDisplayRow): string {
  return rowKey(row);
}

export function ledgerMovementRemaining(
  balanceIndex: FertilizerUsageBalanceIndex,
  farmId: number,
  itemId: number,
  movementKind: "opening" | "import",
  date: string,
): number | null {
  const timeline = balanceIndex.timelinesByFarmItem.get(farmItemBalanceKey(farmId, itemId)) ?? [];
  const key =
    movementKind === "opening"
      ? `opening-${farmId}-${itemId}-${dateYmd(date)}`
      : `import-${farmId}-${itemId}-${dateYmd(date)}`;
  const entry = timeline.find((e) => e.key === key);
  return entry?.balanceAfter ?? null;
}

export function fertilizerListRowAmount(row: FertilizerListDisplayRow): number {
  if (row.kind === "usage") return num(row.row.amount);
  if (row.kind === "opening") return num(row.ledger.opening_qty);
  return num(row.ledger.import_qty);
}

export function fertilizerListRowItemId(row: FertilizerListDisplayRow): number {
  if (row.kind === "usage") return Number(row.row.item_id);
  return Number(row.ledger.stock_key);
}

export function fertilizerListRowFarmId(row: FertilizerListDisplayRow): number {
  if (row.kind === "usage") return Number(row.row.farm_id);
  return Number(row.ledger.farm_id);
}
