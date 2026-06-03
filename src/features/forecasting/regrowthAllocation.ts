import { FORECAST_NOZONE_ZONE } from "@/features/forecasting/forecastingInventoryConversion";
import { sumConfiguredZoneCapKgForFarmProduct } from "@/features/forecasting/inventoryRegrowthCalculator";

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
  /** Per-zone config max (reference only); crediting uses `farmProductCapKg`. */
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
  /** Σ zone-config max kg for this farm + grass (excl. nozone); single credit ceiling. */
  farmProductCapKg: number;
  configuredZoneCount: number;
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
 * 1) Zoned harvest fragments: aggregate gross per zone (no per-zone cap).
 * 2) No-zone pool: fill configured zones in sort order until farm+grass total cap.
 * 3) Credit in zone order against one farm+grass ceiling (`sumConfiguredZoneCapKgForFarmProduct`).
 */
export function computeRegrowthAllocationForFarmProductDate(params: {
  farmId: number;
  productId: number;
  maxByZone: Map<string, number>;
  fragments: RegrowthFragmentInput[];
}): RegrowthAllocationResult {
  const { farmId, productId, maxByZone, fragments } = params;

  const farmProductCapKg = sumConfiguredZoneCapKgForFarmProduct(maxByZone, farmId, productId);
  const configuredKeys = listConfiguredZoneKeysForFarmProduct(maxByZone, farmId, productId);

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

  const nozoneFillByKey = new Map<string, number>();
  for (const key of sortedKeys) {
    nozoneFillByKey.set(key, 0);
  }
  const nozoneRemainingKg = Math.max(0, nozoneInputKg);

  const zoneBreakdowns: ZoneRegrowthBreakdown[] = [];
  let totalCreditedMappedKg = 0;
  let creditLeft = farmProductCapKg;

  for (const key of sortedKeys) {
    const zoneConfigCapKg = maxByZone.get(key) ?? 0;
    const agg = zonedAgg.get(key);
    const zoneLabel = agg?.label ?? zoneSegmentFromKey(key, farmId, productId);
    const grossZonedKg = agg?.qty ?? 0;
    const grossZonedFromNozoneSpreadKg = agg?.fromSpread ?? 0;
    const nozoneFillKg = nozoneFillByKey.get(key) ?? 0;
    const totalIntoZoneKg = grossZonedKg + nozoneFillKg;

    let creditedTotalKg = 0;
    if (farmProductCapKg > 0) {
      creditedTotalKg = Math.min(totalIntoZoneKg, Math.max(0, creditLeft));
      creditLeft = Math.max(0, creditLeft - creditedTotalKg);
    }

    const creditedZonedKg = Math.min(grossZonedKg, creditedTotalKg);
    const zonedOverflowKg = Math.max(0, grossZonedKg - creditedZonedKg);
    const zoneOverflowKg = Math.max(0, totalIntoZoneKg - creditedTotalKg);
    totalCreditedMappedKg += creditedTotalKg;

    zoneBreakdowns.push({
      zoneKey: key,
      zoneLabel,
      capKg: zoneConfigCapKg,
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
    farmProductCapKg,
    configuredZoneCount: configuredKeys.length,
    nozoneInputKg,
    nozoneRemainingKg,
    totalGrossKg,
    totalCreditedMappedKg,
    overflowUncreditedKg,
  };
}
