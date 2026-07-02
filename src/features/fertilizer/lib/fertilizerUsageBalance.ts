import type { FertilizerUsageRow } from "@/features/fertilizer/api/fertilizerUsageApi";
import type { FleetStockLedgerRow } from "@/features/fleet/api/fleetStockLedgerApi";
import { formatNumber } from "@/shared/lib/format/number";

export type FertilizerBalanceEventKind =
  | "opening"
  | "import"
  | "set_balance"
  | "transfer_in"
  | "consumption"
  | "transfer_out";

export type FertilizerUsageBalanceTimelineEntry = {
  key: string;
  dateYmd: string;
  kind: FertilizerBalanceEventKind;
  label: string;
  delta: number;
  balanceBefore: number;
  balanceAfter: number;
  usageId?: number;
};

export type FertilizerUsageBalanceIndex = {
  balanceAfterByUsageKey: Map<string, number>;
  timelinesByFarmItem: Map<string, FertilizerUsageBalanceTimelineEntry[]>;
};

export type BalanceFormulaLabels = {
  opening: string;
  import: string;
  setBalance: string;
  transferIn: string;
  transferOut: string;
  consumption: string;
};

export function usageRowRemainingBalance(
  row: FertilizerUsageRow,
  balanceIndex: FertilizerUsageBalanceIndex,
): number | null {
  const key = usageBalanceLookupKey(Number(row.farm_id), Number(row.item_id), Number(row.id));
  const computed = balanceIndex.balanceAfterByUsageKey.get(key);
  if (computed != null) return computed;

  const raw = row.remaining_qty;
  if (raw !== null && raw !== undefined && String(raw).trim() !== "") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function usageRowHasBalance(
  row: FertilizerUsageRow,
  balanceIndex: FertilizerUsageBalanceIndex,
): boolean {
  const key = usageBalanceLookupKey(Number(row.farm_id), Number(row.item_id), Number(row.id));
  if (balanceIndex.balanceAfterByUsageKey.has(key)) return true;
  return usageRowRemainingBalance(row, balanceIndex) != null;
}

export function usageBalanceLookupKey(
  farmId: number,
  itemId: number,
  usageId: number,
): string {
  return `${farmId}:${itemId}:${usageId}`;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function dateYmd(value: string): string {
  return String(value).slice(0, 10);
}

function fmtQty(value: number): string {
  return formatNumber(value, { maximumFractionDigits: 3 });
}

export function isFertilizerTransferRow(row: Pick<FertilizerUsageRow, "is_transfer">): boolean {
  const v = row.is_transfer;
  return v === 1 || v === true || String(v) === "1";
}

export function farmItemBalanceKey(farmId: number, itemId: number): string {
  return `${farmId}:${itemId}`;
}

function usageAffectsFarmItem(row: FertilizerUsageRow, farmId: number, itemId: number): boolean {
  if (Number(row.item_id) !== itemId) return false;
  if (Number(row.farm_id) === farmId) return true;
  return isFertilizerTransferRow(row) && Number(row.transfer_to_farm_id) === farmId;
}

function isOpeningAnchorRow(row: FleetStockLedgerRow): boolean {
  return Number(row.is_opening_anchor) === 1 || row.is_opening_anchor === true;
}

function anchorOpeningQty(anchor: FleetStockLedgerRow): number {
  const raw = anchor.opening_qty;
  if (raw !== null && raw !== undefined && String(raw).trim() !== "") {
    return num(raw);
  }
  return num(anchor.remaining_qty);
}

function openingAnchorsForFarmItem(
  ledgerRows: FleetStockLedgerRow[],
  farmId: number,
  itemId: number,
): FleetStockLedgerRow[] {
  const stockKey = String(itemId);
  return ledgerRows
    .filter(
      (r) =>
        Number(r.farm_id) === farmId &&
        String(r.stock_key) === stockKey &&
        isOpeningAnchorRow(r),
    )
    .sort((a, b) => dateYmd(a.balance_date).localeCompare(dateYmd(b.balance_date)));
}

function usageDelta(row: FertilizerUsageRow, farmId: number): number {
  const amount = num(row.amount);
  if (isFertilizerTransferRow(row)) {
    if (Number(row.farm_id) === farmId) return -amount;
    if (Number(row.transfer_to_farm_id) === farmId) return amount;
    return 0;
  }
  if (Number(row.farm_id) === farmId) return -amount;
  return 0;
}

function usageEventKind(row: FertilizerUsageRow, farmId: number): FertilizerBalanceEventKind {
  if (isFertilizerTransferRow(row)) {
    return Number(row.farm_id) === farmId ? "transfer_out" : "transfer_in";
  }
  return "consumption";
}

function pushEntry(
  entries: FertilizerUsageBalanceTimelineEntry[],
  balance: number,
  entry: Omit<FertilizerUsageBalanceTimelineEntry, "balanceBefore" | "balanceAfter"> & {
    balanceAfter: number;
  },
): number {
  entries.push({
    ...entry,
    balanceBefore: balance,
    balanceAfter: entry.balanceAfter,
  });
  return entry.balanceAfter;
}

export function buildFarmItemBalanceTimeline(opts: {
  farmId: number;
  itemId: number;
  ledgerRows: FleetStockLedgerRow[];
  usageRows: FertilizerUsageRow[];
  farmName?: string;
  productLabel?: string;
  transferToFarmName?: (farmId: number) => string | undefined;
}): FertilizerUsageBalanceTimelineEntry[] {
  const { farmId, itemId, ledgerRows, usageRows, farmName, productLabel, transferToFarmName } =
    opts;
  const stockKey = String(itemId);
  const openingAnchors = openingAnchorsForFarmItem(ledgerRows, farmId, itemId);
  const firstOpeningDate =
    openingAnchors.length > 0 ? dateYmd(openingAnchors[0]!.balance_date) : null;
  const openingAnchorsByDate = new Map(
    openingAnchors.map((anchor) => [dateYmd(anchor.balance_date), anchor]),
  );

  const relevantUsage = usageRows
    .filter((r) => usageAffectsFarmItem(r, farmId, itemId))
    .filter((r) => !firstOpeningDate || dateYmd(r.applied_date) >= firstOpeningDate)
    .sort((a, b) => {
      const dateCmp = dateYmd(a.applied_date).localeCompare(dateYmd(b.applied_date));
      if (dateCmp !== 0) return dateCmp;
      return Number(a.id) - Number(b.id);
    });

  const ledgerByDate = new Map<string, FleetStockLedgerRow>();
  for (const row of ledgerRows) {
    if (Number(row.farm_id) !== farmId || String(row.stock_key) !== stockKey) continue;
    const d = dateYmd(row.balance_date);
    if (firstOpeningDate && d < firstOpeningDate) continue;
    ledgerByDate.set(d, row);
  }

  const dates = new Set<string>();
  for (const row of relevantUsage) dates.add(dateYmd(row.applied_date));
  for (const d of ledgerByDate.keys()) dates.add(d);
  for (const anchor of openingAnchors) dates.add(dateYmd(anchor.balance_date));

  const sortedDates = [...dates].sort();

  if (sortedDates.length === 0 && openingAnchors.length === 0) return [];

  const entries: FertilizerUsageBalanceTimelineEntry[] = [];
  let balance = 0;

  for (const d of sortedDates) {
    if (firstOpeningDate && d < firstOpeningDate) continue;
    const anchorOnDay = openingAnchorsByDate.get(d);
    if (anchorOnDay) {
      const openingQty = anchorOpeningQty(anchorOnDay);
      balance = pushEntry(entries, balance, {
        key: `opening-${farmId}-${itemId}-${d}`,
        dateYmd: d,
        kind: "opening",
        label: productLabel ?? `Item ${itemId}`,
        delta: openingQty - balance,
        balanceAfter: openingQty,
      });
    }

    const ledger = ledgerByDate.get(d);
    const dayUsages = relevantUsage.filter((r) => dateYmd(r.applied_date) === d);

    const manualImport = ledger ? num(ledger.import_qty) : 0;
    if (manualImport > 0) {
      balance = pushEntry(entries, balance, {
        key: `import-${farmId}-${itemId}-${d}`,
        dateYmd: d,
        kind: "import",
        label: farmName ? `${farmName} · Import` : "Import",
        delta: manualImport,
        balanceAfter: balance + manualImport,
      });
    }

    for (const usage of dayUsages) {
      const delta = usageDelta(usage, farmId);
      if (delta === 0) continue;
      const kind = usageEventKind(usage, farmId);
      let label = productLabel ?? `Item ${itemId}`;
      if (kind === "transfer_out") {
        const dest =
          usage.transfer_to_farm_name ??
          transferToFarmName?.(Number(usage.transfer_to_farm_id)) ??
          usage.transfer_to_farm_id;
        label = `Transfer → ${dest}`;
      } else if (kind === "transfer_in") {
        const src = usage.farm_name ?? farmName ?? usage.farm_id;
        label = `Transfer from ${src}`;
      }
      balance = pushEntry(entries, balance, {
        key: `usage-${usage.id}`,
        dateYmd: d,
        kind,
        label,
        delta,
        balanceAfter: balance + delta,
        usageId: Number(usage.id),
      });
    }

    if (ledger && !isOpeningAnchorRow(ledger)) {
      const ledgerRemaining = num(ledger.remaining_qty);
      if (Math.abs(ledgerRemaining - balance) > 0.0001) {
        balance = pushEntry(entries, balance, {
          key: `set-balance-${farmId}-${itemId}-${d}`,
          dateYmd: d,
          kind: "set_balance",
          label: farmName ? `${farmName} · Set balance` : "Set balance",
          delta: ledgerRemaining - balance,
          balanceAfter: ledgerRemaining,
        });
      } else {
        balance = ledgerRemaining;
        const last = entries[entries.length - 1];
        if (last && last.dateYmd === d) {
          last.balanceAfter = ledgerRemaining;
        }
      }
    }
  }

  return entries;
}

export function buildFertilizerUsageBalanceIndex(opts: {
  ledgerRows: FleetStockLedgerRow[];
  usageRows: FertilizerUsageRow[];
  farmNameById?: Map<string, string>;
  productLabelByItemId?: Map<number, string>;
}): FertilizerUsageBalanceIndex {
  const { ledgerRows, usageRows, farmNameById, productLabelByItemId } = opts;
  const balanceAfterByUsageKey = new Map<string, number>();
  const timelinesByFarmItem = new Map<string, FertilizerUsageBalanceTimelineEntry[]>();

  const pairs = new Set<string>();
  for (const row of usageRows) {
    const itemId = Number(row.item_id);
    if (itemId <= 0) continue;
    if (Number(row.farm_id) > 0) {
      pairs.add(farmItemBalanceKey(Number(row.farm_id), itemId));
    }
    if (isFertilizerTransferRow(row) && Number(row.transfer_to_farm_id) > 0) {
      pairs.add(farmItemBalanceKey(Number(row.transfer_to_farm_id), itemId));
    }
  }
  for (const row of ledgerRows) {
    const itemId = Number(row.stock_key);
    const farmId = Number(row.farm_id);
    if (itemId > 0 && farmId > 0) {
      pairs.add(farmItemBalanceKey(farmId, itemId));
    }
  }

  for (const key of pairs) {
    const [farmIdRaw, itemIdRaw] = key.split(":");
    const farmId = Number(farmIdRaw);
    const itemId = Number(itemIdRaw);
    if (!Number.isFinite(farmId) || !Number.isFinite(itemId)) continue;

    const timeline = buildFarmItemBalanceTimeline({
      farmId,
      itemId,
      ledgerRows,
      usageRows,
      farmName: farmNameById?.get(String(farmId)),
      productLabel: productLabelByItemId?.get(itemId),
      transferToFarmName: (id) => farmNameById?.get(String(id)),
    });
    timelinesByFarmItem.set(key, timeline);
    for (const entry of timeline) {
      if (entry.usageId != null) {
        balanceAfterByUsageKey.set(
          usageBalanceLookupKey(farmId, itemId, entry.usageId),
          entry.balanceAfter,
        );
      }
    }
  }

  return { balanceAfterByUsageKey, timelinesByFarmItem };
}

export function timelineUpToUsageId(
  timeline: FertilizerUsageBalanceTimelineEntry[],
  usageId: number,
): FertilizerUsageBalanceTimelineEntry[] {
  const idx = timeline.findIndex((e) => e.usageId === usageId);
  if (idx < 0) return timeline;
  return timeline.slice(0, idx + 1);
}

function kindFormulaLabel(
  kind: FertilizerBalanceEventKind,
  labels: BalanceFormulaLabels,
): string {
  switch (kind) {
    case "opening":
      return labels.opening;
    case "import":
      return labels.import;
    case "set_balance":
      return labels.setBalance;
    case "transfer_in":
      return labels.transferIn;
    case "transfer_out":
      return labels.transferOut;
    default:
      return labels.consumption;
  }
}

/** Human-readable formula e.g. "Opening 1,000 − Consumption 3,000 = −2,000" */
export function formatBalanceFormulaSummary(
  timeline: FertilizerUsageBalanceTimelineEntry[],
  labels: BalanceFormulaLabels,
): string {
  if (timeline.length === 0) return "";

  const segments: string[] = [];
  for (const entry of timeline) {
    const name = kindFormulaLabel(entry.kind, labels);
    if (entry.kind === "opening") {
      segments.push(`${name} ${fmtQty(entry.balanceAfter)}`);
      continue;
    }
    if (entry.kind === "set_balance") {
      segments.push(`→ ${name} ${fmtQty(entry.balanceAfter)}`);
      continue;
    }
    const sign = entry.delta >= 0 ? "+" : "−";
    segments.push(`${sign} ${name} ${fmtQty(Math.abs(entry.delta))}`);
  }

  const finalBalance = timeline[timeline.length - 1]!.balanceAfter;
  return `${segments.join(" ")} = ${fmtQty(finalBalance)}`;
}

/** Per-row formula e.g. "1,000 − 3,000 = −2,000" */
export function formatBalanceStepFormula(entry: FertilizerUsageBalanceTimelineEntry): string {
  if (entry.kind === "opening") {
    return fmtQty(entry.balanceAfter);
  }
  const sign = entry.delta >= 0 ? "+" : "−";
  return `${fmtQty(entry.balanceBefore)} ${sign} ${fmtQty(Math.abs(entry.delta))} = ${fmtQty(entry.balanceAfter)}`;
}
