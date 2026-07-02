import type { FuelUsageRow } from "@/features/fleet/api/fuelUsageApi";
import type { FleetStockLedgerRow } from "@/features/fleet/api/fleetStockLedgerApi";
import { formatNumber } from "@/shared/lib/format/number";

export type FuelBalanceEventKind = "opening" | "import" | "consumption" | "set_balance";

export type FuelUsageBalanceTimelineEntry = {
  key: string;
  dateYmd: string;
  kind: FuelBalanceEventKind;
  label: string;
  delta: number;
  balanceBefore: number;
  balanceAfter: number;
  usageId?: number;
};

export type FuelUsageBalanceIndex = {
  balanceAfterByUsageKey: Map<string, number>;
  balanceAfterByMovementKey: Map<string, number>;
  timelinesByFarmFuel: Map<string, FuelUsageBalanceTimelineEntry[]>;
};

export type FuelBalanceFormulaLabels = {
  opening: string;
  import: string;
  setBalance: string;
  consumption: string;
};

export function normalizeFuelKind(raw: unknown): string {
  const kind = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (kind === "diesel" || kind === "petrol") return kind;
  return "";
}

export function farmFuelBalanceKey(farmId: number, fuelKind: string): string {
  return `${farmId}:${fuelKind}`;
}

export function fuelUsageBalanceLookupKey(
  farmId: number,
  fuelKind: string,
  usageId: number,
): string {
  return `${farmId}:${fuelKind}:${usageId}`;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function dateYmd(value: string): string {
  return String(value).slice(0, 10);
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

function openingAnchorsForFarmFuel(
  ledgerRows: FleetStockLedgerRow[],
  farmId: number,
  fuelKind: string,
): FleetStockLedgerRow[] {
  return ledgerRows
    .filter(
      (r) =>
        Number(r.farm_id) === farmId &&
        String(r.stock_key) === fuelKind &&
        isOpeningAnchorRow(r),
    )
    .sort((a, b) => dateYmd(a.balance_date).localeCompare(dateYmd(b.balance_date)));
}

function fmtQty(value: number): string {
  return formatNumber(value, { maximumFractionDigits: 3 });
}

function pushEntry(
  entries: FuelUsageBalanceTimelineEntry[],
  balance: number,
  entry: Omit<FuelUsageBalanceTimelineEntry, "balanceBefore" | "balanceAfter"> & {
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

function buildFarmFuelBalanceTimeline(opts: {
  farmId: number;
  fuelKind: string;
  ledgerRows: FleetStockLedgerRow[];
  usageRows: FuelUsageRow[];
  farmName?: string;
  fuelLabel?: string;
}): FuelUsageBalanceTimelineEntry[] {
  const { farmId, fuelKind, ledgerRows, usageRows, farmName, fuelLabel } = opts;
  const entries: FuelUsageBalanceTimelineEntry[] = [];

  const relevantUsage = usageRows
    .filter(
      (r) =>
        Number(r.farm_id) === farmId && normalizeFuelKind(r.fuel_kind) === fuelKind,
    )
    .sort((a, b) => {
      const dateCmp = dateYmd(a.fuel_date).localeCompare(dateYmd(b.fuel_date));
      if (dateCmp !== 0) return dateCmp;
      return Number(a.id) - Number(b.id);
    });

  const ledgerByDate = new Map<string, FleetStockLedgerRow>();
  for (const row of ledgerRows) {
    if (Number(row.farm_id) !== farmId || String(row.stock_key) !== fuelKind) continue;
    ledgerByDate.set(dateYmd(row.balance_date), row);
  }

  const openingAnchors = openingAnchorsForFarmFuel(ledgerRows, farmId, fuelKind);
  const firstOpeningDate =
    openingAnchors.length > 0 ? dateYmd(openingAnchors[0]!.balance_date) : null;
  const openingAnchorsByDate = new Map(
    openingAnchors.map((anchor) => [dateYmd(anchor.balance_date), anchor]),
  );

  const filteredUsage =
    firstOpeningDate != null
      ? relevantUsage.filter((r) => dateYmd(r.fuel_date) >= firstOpeningDate)
      : relevantUsage;

  const dates = new Set<string>();
  for (const row of filteredUsage) dates.add(dateYmd(row.fuel_date));
  for (const d of ledgerByDate.keys()) {
    if (!firstOpeningDate || d >= firstOpeningDate) dates.add(d);
  }
  for (const anchor of openingAnchors) dates.add(dateYmd(anchor.balance_date));

  const sortedDates = [...dates].sort();
  let balance = 0;

  for (const d of sortedDates) {
    if (firstOpeningDate && d < firstOpeningDate) continue;

    const anchorOnDay = openingAnchorsByDate.get(d);
    if (anchorOnDay) {
      const openingQty = anchorOpeningQty(anchorOnDay);
      balance = pushEntry(entries, balance, {
        key: `opening-${farmId}-${fuelKind}-${d}`,
        dateYmd: d,
        kind: "opening",
        label: fuelLabel ?? fuelKind,
        delta: openingQty - balance,
        balanceAfter: openingQty,
      });
    }

    const ledger = ledgerByDate.get(d);
    const manualImport = ledger ? num(ledger.import_qty) : 0;
    if (manualImport > 0) {
      balance = pushEntry(entries, balance, {
        key: `import-${farmId}-${fuelKind}-${d}`,
        dateYmd: d,
        kind: "import",
        label: farmName ? `${farmName} · Import` : "Import",
        delta: manualImport,
        balanceAfter: balance + manualImport,
      });
    }

    const dayUsages = filteredUsage.filter((r) => dateYmd(r.fuel_date) === d);
    for (const usage of dayUsages) {
      const litres = num(usage.litres);
      if (litres <= 0) continue;
      balance = pushEntry(entries, balance, {
        key: `usage-${usage.id}`,
        dateYmd: d,
        kind: "consumption",
        label: fuelLabel ?? fuelKind,
        delta: -litres,
        balanceAfter: balance - litres,
        usageId: Number(usage.id),
      });
    }

    if (ledger && !isOpeningAnchorRow(ledger)) {
      const ledgerRemaining = num(ledger.remaining_qty);
      if (Math.abs(ledgerRemaining - balance) > 0.0001) {
        balance = pushEntry(entries, balance, {
          key: `set-balance-${farmId}-${fuelKind}-${d}`,
          dateYmd: d,
          kind: "set_balance",
          label: farmName ? `${farmName} · Set balance` : "Set balance",
          delta: ledgerRemaining - balance,
          balanceAfter: ledgerRemaining,
        });
      } else {
        balance = ledgerRemaining;
      }
    }
  }

  return entries;
}

export function buildFuelUsageBalanceIndex(opts: {
  ledgerRows: FleetStockLedgerRow[];
  usageRows: FuelUsageRow[];
  farmNameById?: Map<string, string>;
  fuelLabelByKind?: Map<string, string> | Record<string, string>;
}): FuelUsageBalanceIndex {
  const { ledgerRows, usageRows, farmNameById, fuelLabelByKind } = opts;
  const balanceAfterByUsageKey = new Map<string, number>();
  const balanceAfterByMovementKey = new Map<string, number>();
  const timelinesByFarmFuel = new Map<string, FuelUsageBalanceTimelineEntry[]>();
  const pairs = new Set<string>();

  for (const row of usageRows) {
    const farmId = Number(row.farm_id);
    const fuelKind = normalizeFuelKind(row.fuel_kind);
    if (farmId > 0 && fuelKind) pairs.add(farmFuelBalanceKey(farmId, fuelKind));
  }
  for (const row of ledgerRows) {
    const farmId = Number(row.farm_id);
    const fuelKind = String(row.stock_key ?? "").trim().toLowerCase();
    if (farmId > 0 && fuelKind) pairs.add(farmFuelBalanceKey(farmId, fuelKind));
  }

  for (const key of pairs) {
    const [farmIdRaw, fuelKind] = key.split(":");
    const farmId = Number(farmIdRaw);
    if (!Number.isFinite(farmId) || !fuelKind) continue;

    const timeline = buildFarmFuelBalanceTimeline({
      farmId,
      fuelKind,
      ledgerRows,
      usageRows,
      farmName: farmNameById?.get(String(farmId)),
      fuelLabel:
        fuelLabelByKind instanceof Map
          ? fuelLabelByKind.get(fuelKind)
          : fuelLabelByKind?.[fuelKind],
    });
    timelinesByFarmFuel.set(key, timeline);

    for (const entry of timeline) {
      if (entry.kind === "opening") {
        balanceAfterByMovementKey.set(
          `opening-${farmId}-${fuelKind}-${entry.dateYmd}`,
          entry.balanceAfter,
        );
      }
      if (entry.kind === "import") {
        balanceAfterByMovementKey.set(
          `import-${farmId}-${fuelKind}-${entry.dateYmd}`,
          entry.balanceAfter,
        );
      }
      if (entry.usageId != null) {
        balanceAfterByUsageKey.set(
          fuelUsageBalanceLookupKey(farmId, fuelKind, entry.usageId),
          entry.balanceAfter,
        );
      }
    }
  }

  return { balanceAfterByUsageKey, balanceAfterByMovementKey, timelinesByFarmFuel };
}

export function fuelTimelineUpToUsageId(
  timeline: FuelUsageBalanceTimelineEntry[],
  usageId: number,
): FuelUsageBalanceTimelineEntry[] {
  const idx = timeline.findIndex((e) => e.usageId === usageId);
  if (idx < 0) return timeline;
  return timeline.slice(0, idx + 1);
}

function kindFormulaLabel(kind: FuelBalanceEventKind, labels: FuelBalanceFormulaLabels): string {
  switch (kind) {
    case "opening":
      return labels.opening;
    case "import":
      return labels.import;
    case "set_balance":
      return labels.setBalance;
    default:
      return labels.consumption;
  }
}

export function formatFuelBalanceFormulaSummary(
  timeline: FuelUsageBalanceTimelineEntry[],
  labels: FuelBalanceFormulaLabels,
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

export function formatFuelBalanceStepFormula(entry: FuelUsageBalanceTimelineEntry): string {
  if (entry.kind === "opening") {
    return fmtQty(entry.balanceAfter);
  }
  const sign = entry.delta >= 0 ? "+" : "−";
  return `${fmtQty(entry.balanceBefore)} ${sign} ${fmtQty(Math.abs(entry.delta))} = ${fmtQty(entry.balanceAfter)}`;
}

export function fuelLedgerMovementRemaining(
  balanceIndex: FuelUsageBalanceIndex,
  farmId: number,
  fuelKind: string,
  movementKind: "opening" | "import",
  date: string,
): number | null {
  const key =
    movementKind === "opening"
      ? `opening-${farmId}-${fuelKind}-${dateYmd(date)}`
      : `import-${farmId}-${fuelKind}-${dateYmd(date)}`;
  const value = balanceIndex.balanceAfterByMovementKey.get(key);
  return value != null ? value : null;
}

export function fuelRowRemainingLitres(
  row: FuelUsageRow,
  balanceIndex: FuelUsageBalanceIndex,
): number | null {
  const fuelKind = normalizeFuelKind(row.fuel_kind);
  if (!fuelKind) return null;

  const key = fuelUsageBalanceLookupKey(Number(row.farm_id), fuelKind, Number(row.id));
  const computed = balanceIndex.balanceAfterByUsageKey.get(key);
  if (computed != null) return computed;

  const raw = row.remaining_litres;
  if (raw !== null && raw !== undefined && String(raw).trim() !== "") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function fuelRowHasRemaining(
  row: FuelUsageRow,
  balanceIndex: FuelUsageBalanceIndex,
): boolean {
  const fuelKind = normalizeFuelKind(row.fuel_kind);
  if (!fuelKind) return false;
  const key = fuelUsageBalanceLookupKey(Number(row.farm_id), fuelKind, Number(row.id));
  if (balanceIndex.balanceAfterByUsageKey.has(key)) return true;
  return fuelRowRemainingLitres(row, balanceIndex) != null;
}
