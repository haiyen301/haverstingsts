import type { FertilizerProductRow } from "@/features/admin/api/adminApi";
import { fetchFertilizerProducts } from "@/features/admin/api/adminApi";
import type { FertilizerUsageRow } from "@/features/fertilizer/api/fertilizerUsageApi";
import { fetchFertilizerUsage } from "@/features/fertilizer/api/fertilizerUsageApi";
import {
  FARM_ALIAS_CONTEXT,
  farmAliasesByRefId,
  fetchFarmAliases,
} from "@/features/farm/api/farmAliasesApi";
import type { FleetStockLedgerRow } from "@/features/fleet/api/fleetStockLedgerApi";
import { fetchFleetStockLedger } from "@/features/fleet/api/fleetStockLedgerApi";
import { farmAliasDisplayLabel } from "@/shared/lib/farmAliasDisplay";

import {
  fertilizerBalanceWeekBuckets,
  fertilizerBalanceWeekLabel,
  type FertilizerBalanceWeekBucket,
} from "./fertilizerBalanceWeeks";

export type FertilizerBalanceWeekMetrics = {
  import: number;
  transfer: number;
  consumption: number;
  balance: number;
};

export type FertilizerBalanceProductRow = {
  itemId: number;
  itemCode: string;
  description: string;
  unit: string;
  open: number;
  weeks: [
    FertilizerBalanceWeekMetrics,
    FertilizerBalanceWeekMetrics,
    FertilizerBalanceWeekMetrics,
    FertilizerBalanceWeekMetrics,
  ];
  monthTotal: {
    import: number;
    transfer: number;
    consumption: number;
  };
  monthEndBalance: number;
};

export type FertilizerBalanceInventoryRow = {
  description: string;
  unit: string;
  quantity: number;
};

export type FertilizerBalanceSheetModel = {
  farmId: number;
  farmName: string;
  year: number;
  month: number;
  monthEndYmd: string;
  weeks: FertilizerBalanceWeekBucket[];
  weekLabels: string[];
  productRows: FertilizerBalanceProductRow[];
  inventoryRows: FertilizerBalanceInventoryRow[];
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function emptyWeekMetrics(): FertilizerBalanceWeekMetrics {
  return { import: 0, transfer: 0, consumption: 0, balance: 0 };
}

function monthBounds(year: number, month: number): { start: string; end: string; endDay: number } {
  const endDay = new Date(year, month, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    start: `${year}-${pad(month)}-01`,
    end: `${year}-${pad(month)}-${pad(endDay)}`,
    endDay,
  };
}

function ledgerDateYmd(row: FleetStockLedgerRow): string {
  return String(row.balance_date).slice(0, 10);
}

function usageDateYmd(row: FertilizerUsageRow): string {
  return String(row.applied_date).slice(0, 10);
}

function isTransferRow(row: FertilizerUsageRow): boolean {
  const v = row.is_transfer;
  return v === 1 || v === true || String(v) === "1";
}

type UsageDayMetrics = {
  consumption: number;
  transferOut: number;
  transferIn: number;
};

function sumUsageMetricsForItemOnDate(
  usageRows: FertilizerUsageRow[],
  farmId: number,
  itemId: number,
  dateYmd: string,
): UsageDayMetrics {
  let consumption = 0;
  let transferOut = 0;
  let transferIn = 0;

  for (const row of usageRows) {
    if (Number(row.item_id) !== itemId || usageDateYmd(row) !== dateYmd) continue;
    const amount = num(row.amount);
    if (isTransferRow(row)) {
      if (Number(row.farm_id) === farmId) transferOut += amount;
      if (Number(row.transfer_to_farm_id) === farmId) transferIn += amount;
    } else if (Number(row.farm_id) === farmId) {
      consumption += amount;
    }
  }

  return { consumption, transferOut, transferIn };
}

function simulatedBalanceBeforeMonth(
  farmId: number,
  itemId: number,
  monthStart: string,
  ledgerRows: FleetStockLedgerRow[],
  usageRows: FertilizerUsageRow[],
): number {
  const stockKey = String(itemId);
  const hasPriorLedger = ledgerRows.some(
    (r) => r.stock_key === stockKey && ledgerDateYmd(r) < monthStart,
  );
  if (hasPriorLedger) {
    return remainingBeforeMonth(ledgerRows, itemId, monthStart);
  }

  let balance = remainingBeforeMonth(ledgerRows, itemId, monthStart);
  const dates = new Set<string>();
  for (const row of ledgerRows) {
    if (row.stock_key !== stockKey) continue;
    const d = ledgerDateYmd(row);
    if (d < monthStart) dates.add(d);
  }
  for (const row of usageRows) {
    if (Number(row.item_id) !== itemId) continue;
    const d = usageDateYmd(row);
    if (d < monthStart) dates.add(d);
  }

  for (const d of [...dates].sort()) {
    const ledger = ledgerRows.find((r) => r.stock_key === stockKey && ledgerDateYmd(r) === d);
    const metrics = sumUsageMetricsForItemOnDate(usageRows, farmId, itemId, d);
    const importQty = (ledger ? num(ledger.import_qty) : 0) + metrics.transferIn;
    const totalOut = metrics.consumption + metrics.transferOut;
    if (ledger) {
      balance = num(ledger.remaining_qty);
    } else {
      balance = balance + importQty - totalOut;
    }
  }

  return balance;
}

function remainingBeforeMonth(
  ledgerRows: FleetStockLedgerRow[],
  itemId: number,
  monthStart: string,
): number {
  const stockKey = String(itemId);
  const prior = ledgerRows
    .filter((r) => r.stock_key === stockKey && ledgerDateYmd(r) < monthStart)
    .sort((a, b) => ledgerDateYmd(b).localeCompare(ledgerDateYmd(a)));
  if (prior.length > 0) return num(prior[0]!.remaining_qty);
  const anchor = ledgerRows.find(
    (r) =>
      r.stock_key === stockKey &&
      (Number(r.is_opening_anchor) === 1 || r.is_opening_anchor === true) &&
      ledgerDateYmd(r) <= monthStart,
  );
  if (anchor) return num(anchor.opening_qty ?? anchor.remaining_qty);
  return 0;
}

function dailyLedgerMap(
  ledgerRows: FleetStockLedgerRow[],
  itemId: number,
  monthStart: string,
  monthEnd: string,
): Map<string, FleetStockLedgerRow> {
  const stockKey = String(itemId);
  const map = new Map<string, FleetStockLedgerRow>();
  for (const row of ledgerRows) {
    if (row.stock_key !== stockKey) continue;
    const d = ledgerDateYmd(row);
    if (d < monthStart || d > monthEnd) continue;
    map.set(d, row);
  }
  return map;
}

function computeWeekMetrics(
  farmId: number,
  opening: number,
  bucket: FertilizerBalanceWeekBucket,
  dailyMap: Map<string, FleetStockLedgerRow>,
  usageRows: FertilizerUsageRow[],
  itemId: number,
): FertilizerBalanceWeekMetrics {
  let balance = opening;
  let importSum = 0;
  let transferSum = 0;
  let consumptionSum = 0;

  for (let day = bucket.startDay; day <= bucket.endDay; day += 1) {
    const pad = String(day).padStart(2, "0");
    const ymd = bucket.startYmd.slice(0, 8) + pad;
    const ledger = dailyMap.get(ymd);
    const metrics = sumUsageMetricsForItemOnDate(usageRows, farmId, itemId, ymd);
    const manualImport = ledger ? num(ledger.import_qty) : 0;
    const importQty = manualImport + metrics.transferIn;
    const totalOut = metrics.consumption + metrics.transferOut;

    importSum += importQty;
    transferSum += metrics.transferOut;
    consumptionSum += metrics.consumption;

    if (ledger) {
      balance = num(ledger.remaining_qty);
    } else {
      balance = balance + importQty - totalOut;
    }
  }

  return {
    import: importSum,
    transfer: transferSum,
    consumption: consumptionSum,
    balance,
  };
}

function buildProductRow(
  farmId: number,
  product: FertilizerProductRow,
  alias: string | undefined,
  ledgerRows: FleetStockLedgerRow[],
  usageRows: FertilizerUsageRow[],
  weeks: FertilizerBalanceWeekBucket[],
  monthStart: string,
  monthEnd: string,
): FertilizerBalanceProductRow {
  const itemId = Number(product.id);
  const dailyMap = dailyLedgerMap(ledgerRows, itemId, monthStart, monthEnd);
  const openingBalance = simulatedBalanceBeforeMonth(
    farmId,
    itemId,
    monthStart,
    ledgerRows,
    usageRows,
  );
  let rollingOpen = openingBalance;

  const anchorInMonth = [...dailyMap.values()].find(
    (r) => Number(r.is_opening_anchor) === 1 || r.is_opening_anchor === true,
  );
  if (anchorInMonth && ledgerDateYmd(anchorInMonth) === monthStart) {
    rollingOpen = num(anchorInMonth.opening_qty ?? anchorInMonth.remaining_qty);
  }

  const weekMetrics = weeks.map((bucket) => {
    const metrics = computeWeekMetrics(farmId, rollingOpen, bucket, dailyMap, usageRows, itemId);
    rollingOpen = metrics.balance;
    return metrics;
  }) as FertilizerBalanceProductRow["weeks"];

  const monthTotal = weekMetrics.reduce(
    (acc, w) => ({
      import: acc.import + w.import,
      transfer: acc.transfer + w.transfer,
      consumption: acc.consumption + w.consumption,
    }),
    { import: 0, transfer: 0, consumption: 0 },
  );

  return {
    itemId,
    itemCode: "",
    description: farmAliasDisplayLabel(alias, product.name, String(itemId)),
    unit: "kg",
    open: openingBalance,
    weeks: weekMetrics,
    monthTotal,
    monthEndBalance: weekMetrics[3]?.balance ?? rollingOpen,
  };
}

export function buildFertilizerBalanceSheetModel(opts: {
  farmId: number;
  farmName: string;
  year: number;
  month: number;
  products: FertilizerProductRow[];
  aliasesByItemId: Map<number, string>;
  ledgerRows: FleetStockLedgerRow[];
  usageRows: FertilizerUsageRow[];
}): FertilizerBalanceSheetModel {
  const { farmId, farmName, year, month, products, aliasesByItemId, ledgerRows, usageRows } =
    opts;
  const bounds = monthBounds(year, month);
  const weeks = fertilizerBalanceWeekBuckets(year, month);
  const weekLabels = weeks.map((w) => fertilizerBalanceWeekLabel(w, year, month));

  const sortedProducts = [...products].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );

  const productRows = sortedProducts.map((product) =>
    buildProductRow(
      farmId,
      product,
      aliasesByItemId.get(Number(product.id)),
      ledgerRows,
      usageRows,
      weeks,
      bounds.start,
      bounds.end,
    ),
  );

  const inventoryRows: FertilizerBalanceInventoryRow[] = productRows
    .filter(
      (row) =>
        row.monthEndBalance !== 0 ||
        row.open !== 0 ||
        row.monthTotal.import !== 0 ||
        row.monthTotal.transfer !== 0 ||
        row.monthTotal.consumption !== 0,
    )
    .map((row) => ({
      description: row.description,
      unit: row.unit,
      quantity: row.monthEndBalance,
    }))
    .sort((a, b) => a.description.localeCompare(b.description, undefined, { sensitivity: "base" }));

  return {
    farmId,
    farmName,
    year,
    month,
    monthEndYmd: bounds.end,
    weeks,
    weekLabels,
    productRows,
    inventoryRows,
  };
}

export function formatBalanceQty(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0";
  if (Number.isInteger(value)) return String(value);
  return String(parseFloat(value.toFixed(3)));
}

export async function fetchFertilizerBalanceSheetModel(opts: {
  farmId: number;
  farmName: string;
  year: number;
  month: number;
}): Promise<FertilizerBalanceSheetModel> {
  const { farmId, farmName, year, month } = opts;
  const pad = (n: number) => String(n).padStart(2, "0");
  const endDay = new Date(year, month, 0).getDate();
  const monthStart = `${year}-${pad(month)}-01`;
  const monthEnd = `${year}-${pad(month)}-${pad(endDay)}`;
  const openingUsageEnd = (() => {
    const d = new Date(year, month - 1, 1);
    d.setDate(d.getDate() - 1);
    const py = d.getFullYear();
    const pm = String(d.getMonth() + 1).padStart(2, "0");
    const pd = String(d.getDate()).padStart(2, "0");
    return `${py}-${pm}-${pd}`;
  })();

  const [
    products,
    ledgerRows,
    usageRows,
    incomingTransfers,
    priorUsageRows,
    priorIncomingTransfers,
    aliasRows,
  ] = await Promise.all([
    fetchFertilizerProducts(),
    fetchFleetStockLedger({
      farm_id: farmId,
      module: "fertilizer",
      balance_from: monthStart,
      balance_to: monthEnd,
    }),
    fetchFertilizerUsage({
      farm_id: farmId,
      applied_from: monthStart,
      applied_to: monthEnd,
    }),
    fetchFertilizerUsage({
      transfer_to_farm_id: farmId,
      applied_from: monthStart,
      applied_to: monthEnd,
    }),
    openingUsageEnd
      ? fetchFertilizerUsage({
          farm_id: farmId,
          applied_to: openingUsageEnd,
        })
      : Promise.resolve([]),
    openingUsageEnd
      ? fetchFertilizerUsage({
          transfer_to_farm_id: farmId,
          applied_to: openingUsageEnd,
        })
      : Promise.resolve([]),
    fetchFarmAliases({
      farm_id: farmId,
      context: FARM_ALIAS_CONTEXT.fertilizerItem,
    }),
  ]);

  const usageById = new Map<number, FertilizerUsageRow>();
  for (const row of [
    ...usageRows,
    ...incomingTransfers,
    ...priorUsageRows,
    ...priorIncomingTransfers,
  ]) {
    usageById.set(Number(row.id), row);
  }
  const mergedUsageRows = [...usageById.values()];

  const priorLedger = await fetchFleetStockLedger({
    farm_id: farmId,
    module: "fertilizer",
    balance_to: monthStart,
  });

  return buildFertilizerBalanceSheetModel({
    farmId,
    farmName,
    year,
    month,
    products,
    aliasesByItemId: farmAliasesByRefId(aliasRows),
    ledgerRows: [...priorLedger, ...ledgerRows],
    usageRows: mergedUsageRows,
  });
}
