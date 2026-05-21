import type { InventoryAvailableOverrideEntry } from "@/shared/store/inventoryAvailableOverrideStore";

const DAY_MS = 1000 * 60 * 60 * 24;

function normalizeYmd(value: string): string {
  return value.trim().slice(0, 10);
}

function parseYmdLocal(ymd: string): Date | null {
  const m = normalizeYmd(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function ymdFromDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * For a zone, pick the manual balance row whose `balance_date` is on or before `asOf`
 * and is the latest such row. This supports multiple dated rows per zone in `sts_inventory_balance`.
 */
export function pickInventoryOverrideForAsOf(
  overridesByStorageKey: Record<string, InventoryAvailableOverrideEntry>,
  zoneKey: string,
  asOf: Date,
): InventoryAvailableOverrideEntry | null {
  const asOfYmd = ymdFromDate(startOfLocalDay(asOf));
  let best: InventoryAvailableOverrideEntry | null = null;
  let bestYmd = "";
  for (const entry of Object.values(overridesByStorageKey)) {
    if (entry.zoneKey !== zoneKey) continue;
    const d = normalizeYmd(entry.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (d > asOfYmd) continue;
    if (!best || d > bestYmd) {
      best = entry;
      bestYmd = d;
    }
  }
  return best;
}

function clampKg(value: number, maxKg: number): number {
  if (!Number.isFinite(value)) return 0;
  if (maxKg > 0) return Math.min(maxKg, Math.max(0, value));
  return Math.max(0, value);
}

function clampNonNegativeKg(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

export type AppliedInventoryAvailableOverride = {
  override: InventoryAvailableOverrideEntry;
  calculatedKg: number;
  effectiveKg: number;
  remainingDeltaKg: number;
  recoveryProgress: number;
};

export function applyInventoryAvailableOverrideToZone(params: {
  calculatedKg: number;
  maxKg: number;
  asOf: Date;
  override: InventoryAvailableOverrideEntry | null | undefined;
  overrideRecoveryDays: number;
}): AppliedInventoryAvailableOverride | null {
  const { asOf, maxKg, override } = params;
  if (!override) return null;

  const overrideDate = parseYmdLocal(override.date);
  if (!overrideDate) return null;

  const asOfDay = startOfLocalDay(asOf);
  const asOfMs = asOfDay.getTime();
  const overrideMs = overrideDate.getTime();
  if (overrideMs > asOfMs) return null;

  const calculatedKg = clampKg(params.calculatedKg, maxKg);
  const savedCalculatedKg = clampKg(override.calculatedKg, maxKg);
  const savedOverrideKg = clampNonNegativeKg(override.availableKg);
  const savedDeltaKg = savedOverrideKg - savedCalculatedKg;

  let recoveryProgress = 0;
  let remainingDeltaKg = savedDeltaKg;
  let effectiveKg = savedOverrideKg;

  if (asOfMs !== overrideMs) {
    const recoveryDays = Math.max(0, Number(params.overrideRecoveryDays) || 0);
    if (recoveryDays <= 0) {
      recoveryProgress = 1;
      remainingDeltaKg = 0;
      effectiveKg = calculatedKg;
    } else {
      const elapsedDays = Math.max(0, (asOfMs - overrideMs) / DAY_MS);
      recoveryProgress = Math.min(elapsedDays / recoveryDays, 1);
      remainingDeltaKg = savedDeltaKg * (1 - recoveryProgress);
      effectiveKg = clampNonNegativeKg(calculatedKg + remainingDeltaKg);
    }
  }

  return {
    override,
    calculatedKg,
    effectiveKg,
    remainingDeltaKg,
    recoveryProgress,
  };
}

export function applyInventoryAvailableOverridesToZoneMap(params: {
  availableByZone: Map<string, number>;
  maxByZone: Map<string, number>;
  /** Keys are `zoneKey|yyyy-mm-dd` (see `inventoryBalanceOverrideStorageKey`). Values hold `zoneKey` + `date`. */
  overridesByZone: Record<string, InventoryAvailableOverrideEntry>;
  asOf: Date;
  overrideRecoveryDays: number;
}): {
  adjustedByZone: Map<string, number>;
  appliedByZone: Map<string, AppliedInventoryAvailableOverride>;
} {
  const adjustedByZone = new Map<string, number>(params.availableByZone);
  const appliedByZone = new Map<string, AppliedInventoryAvailableOverride>();

  const zoneKeys = new Set<string>(params.availableByZone.keys());
  for (const entry of Object.values(params.overridesByZone)) {
    zoneKeys.add(entry.zoneKey);
  }

  for (const zoneKey of zoneKeys) {
    const override = pickInventoryOverrideForAsOf(params.overridesByZone, zoneKey, params.asOf);
    const calculatedKg = params.availableByZone.get(zoneKey) ?? 0;
    const maxKg = params.maxByZone.get(zoneKey) ?? 0;
    const applied = applyInventoryAvailableOverrideToZone({
      calculatedKg,
      maxKg,
      asOf: params.asOf,
      override,
      overrideRecoveryDays: params.overrideRecoveryDays,
    });
    if (!applied) continue;
    adjustedByZone.set(zoneKey, applied.effectiveKg);
    appliedByZone.set(zoneKey, applied);
  }

  return { adjustedByZone, appliedByZone };
}
