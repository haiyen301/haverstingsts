import { FORECAST_NOZONE_ZONE } from "@/features/forecasting/forecastingInventoryConversion";

export type RegrowthFragmentInput = {
  zoneKey: string;
  zoneLabel: string;
  qty: number;
  /** Kg trên fragment có nguồn từ spread plan không zone lúc map (`inventoryKgFromNozoneSpread`). */
  inventoryKgFromNozoneSpread?: number;
};

export type ZoneRegrowthBreakdown = {
  zoneKey: string;
  zoneLabel: string;
  capKg: number;
  grossZonedKg: number;
  /** Tổng kg gán thẳng zone có đánh dấu từ spread plan không zone. */
  grossZonedFromNozoneSpreadKg: number;
  creditedZonedKg: number;
  zonedOverflowKg: number;
  nozoneFillKg: number;
  totalIntoZoneKg: number;
  creditedTotalKg: number;
  zoneOverflowKg: number;
};

export type RegrowthAllocationResult = {
  zoneBreakdowns: ZoneRegrowthBreakdown[];
  nozoneInputKg: number;
  nozoneRemainingKg: number;
  totalGrossKg: number;
  totalCreditedMappedKg: number;
  overflowUncreditedKg: number;
};

function isNozoneLabel(zoneLabel: string): boolean {
  const z = zoneLabel.trim();
  return !z || z.toLowerCase() === FORECAST_NOZONE_ZONE;
}

function zoneSegmentFromKey(key: string, farmId: number, productId: number): string {
  const prefix = `${farmId}|`;
  const suffix = `|${productId}`;
  if (!key.startsWith(prefix) || !key.endsWith(suffix)) return "";
  return key.slice(prefix.length, key.length - suffix.length);
}

function zoneSortRank(zoneSeg: string): number {
  if (!zoneSeg) return 99999;
  const n = Number(zoneSeg);
  if (Number.isFinite(n)) return n;
  const m = zoneSeg.match(/(\d+)/u);
  return m ? Number(m[1]) : 99998;
}

function listConfiguredZoneKeysForFarmProduct(
  maxByZone: Map<string, number>,
  farmId: number,
  productId: number,
): string[] {
  const prefix = `${farmId}|`;
  const suffix = `|${productId}`;
  const keys: string[] = [];
  for (const key of maxByZone.keys()) {
    if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
    const seg = zoneSegmentFromKey(key, farmId, productId).toLowerCase();
    if (seg === FORECAST_NOZONE_ZONE) continue;
    keys.push(key);
  }
  keys.sort((a, b) => {
    const sa = zoneSegmentFromKey(a, farmId, productId);
    const sb = zoneSegmentFromKey(b, farmId, productId);
    const ra = zoneSortRank(sa);
    const rb = zoneSortRank(sb);
    if (ra !== rb) return ra - rb;
    return sa.localeCompare(sb);
  });
  return keys;
}

/**
 * 1) Zoned harvest fragments: credit up to per-zone cap; record zoned overflow.
 * 2) No-zone fragments: pool kg, then fill remaining headroom in configured zones (sorted),
 *    remainder stays in virtual no-zone pool.
 * 3) Final per-zone credited totals and uncredited overflow (gross − credited mapped).
 */
export function computeRegrowthAllocationForFarmProductDate(params: {
  farmId: number;
  productId: number;
  maxByZone: Map<string, number>;
  fragments: RegrowthFragmentInput[];
}): RegrowthAllocationResult {
  const { farmId, productId, maxByZone, fragments } = params;

  const zonedAgg = new Map<string, { label: string; qty: number; fromSpread: number }>();
  let nozoneInputKg = 0;
  let totalGrossKg = 0;

  for (const f of fragments) {
    const q = Number.isFinite(f.qty) ? f.qty : 0;
    if (q <= 0) continue;
    totalGrossKg += q;
    const raw = String(f.zoneLabel ?? "").trim();
    if (isNozoneLabel(raw)) {
      nozoneInputKg += q;
      continue;
    }
    const key = f.zoneKey;
    const spread = Number.isFinite(f.inventoryKgFromNozoneSpread)
      ? Math.max(0, Number(f.inventoryKgFromNozoneSpread))
      : 0;
    const cur = zonedAgg.get(key) ?? { label: raw, qty: 0, fromSpread: 0 };
    cur.qty += q;
    cur.fromSpread += Math.min(spread, q);
    if (raw.length > cur.label.length) cur.label = raw;
    zonedAgg.set(key, cur);
  }

  const configuredKeys = listConfiguredZoneKeysForFarmProduct(maxByZone, farmId, productId);
  const keySet = new Set<string>(configuredKeys);
  for (const k of zonedAgg.keys()) keySet.add(k);
  const sortedKeys = [...keySet].sort((a, b) => {
    const sa = zoneSegmentFromKey(a, farmId, productId);
    const sb = zoneSegmentFromKey(b, farmId, productId);
    const ra = zoneSortRank(sa);
    const rb = zoneSortRank(sb);
    if (ra !== rb) return ra - rb;
    return sa.localeCompare(sb);
  });

  const creditedZonedByKey = new Map<string, number>();
  const zonedOverflowByKey = new Map<string, number>();

  for (const key of sortedKeys) {
    const cap = maxByZone.get(key) ?? 0;
    const grossZ = zonedAgg.get(key)?.qty ?? 0;
    if (cap > 0) {
      const creditedZ = Math.min(grossZ, cap);
      creditedZonedByKey.set(key, creditedZ);
      zonedOverflowByKey.set(key, Math.max(0, grossZ - cap));
    } else {
      creditedZonedByKey.set(key, 0);
      zonedOverflowByKey.set(key, grossZ);
    }
  }

  let pool = nozoneInputKg;
  const nozoneFillByKey = new Map<string, number>();
  for (const key of sortedKeys) {
    const cap = maxByZone.get(key) ?? 0;
    if (cap <= 0) {
      nozoneFillByKey.set(key, 0);
      continue;
    }
    const grossZ = zonedAgg.get(key)?.qty ?? 0;
    const creditedZ = Math.min(grossZ, cap);
    const headroom = Math.max(0, cap - creditedZ);
    const take = Math.min(pool, headroom);
    nozoneFillByKey.set(key, take);
    pool -= take;
  }
  const nozoneRemainingKg = Math.max(0, pool);

  const zoneBreakdowns: ZoneRegrowthBreakdown[] = [];
  let totalCreditedMappedKg = 0;

  for (const key of sortedKeys) {
    const capKg = maxByZone.get(key) ?? 0;
    const agg = zonedAgg.get(key);
    const zoneLabel = agg?.label ?? zoneSegmentFromKey(key, farmId, productId);
    const grossZonedKg = agg?.qty ?? 0;
    const grossZonedFromNozoneSpreadKg = agg?.fromSpread ?? 0;
    const creditedZonedKg = creditedZonedByKey.get(key) ?? 0;
    const zonedOverflowKg = zonedOverflowByKey.get(key) ?? 0;
    const nozoneFillKg = nozoneFillByKey.get(key) ?? 0;
    const totalIntoZoneKg = grossZonedKg + nozoneFillKg;
    const creditedTotalKg = capKg > 0 ? Math.min(totalIntoZoneKg, capKg) : 0;
    const zoneOverflowKg = capKg > 0 ? Math.max(0, totalIntoZoneKg - capKg) : totalIntoZoneKg;
    totalCreditedMappedKg += creditedTotalKg;
    zoneBreakdowns.push({
      zoneKey: key,
      zoneLabel,
      capKg,
      grossZonedKg,
      grossZonedFromNozoneSpreadKg,
      creditedZonedKg,
      zonedOverflowKg,
      nozoneFillKg,
      totalIntoZoneKg,
      creditedTotalKg,
      zoneOverflowKg,
    });
  }

  const overflowUncreditedKg = Math.max(0, totalGrossKg - totalCreditedMappedKg);

  return {
    zoneBreakdowns,
    nozoneInputKg,
    nozoneRemainingKg,
    totalGrossKg,
    totalCreditedMappedKg,
    overflowUncreditedKg,
  };
}
