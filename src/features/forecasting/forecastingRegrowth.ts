import type { RegrowthRuleRow } from "@/features/admin/api/adminApi";
import type { ForecastHarvestRow } from "@/features/forecasting/forecastingTypes";
import { safeDivideStrictPhp } from "@/shared/lib/grassRegrowthPhp";

export type SprigBandConfig = {
  id: string;
  label: string;
  regrowthDays: number;
  /** Inclusive upper bound of kg/m²; Infinity = open-ended band */
  maxKgPerM2: number;
  comparator: "LT" | "LTE" | "EQ" | "GTE" | "GT";
  thresholdKgPerM2: number;
};

export type RegrowthReferenceConfig = {
  sodDays: number;
  sodForSprigDays: number;
  overrideRecoveryDays: number;
  sprigBands: SprigBandConfig[];
};

function parseComparator(
  raw: unknown,
): "LT" | "LTE" | "EQ" | "GTE" | "GT" {
  const v = String(raw ?? "").toUpperCase().trim();
  if (v === "LT" || v === "LTE" || v === "EQ" || v === "GTE" || v === "GT") {
    return v;
  }
  return "LTE";
}

const DEFAULT_BANDS: SprigBandConfig[] = [
  { id: "b1", maxKgPerM2: 1, regrowthDays: 30, label: "≤ 1.0 kg/m²", comparator: "LTE", thresholdKgPerM2: 1 },
  { id: "b2", maxKgPerM2: 1.5, regrowthDays: 45, label: "≤ 1.5 kg/m²", comparator: "LTE", thresholdKgPerM2: 1.5 },
  { id: "b3", maxKgPerM2: 2.5, regrowthDays: 60, label: "≤ 2.5 kg/m²", comparator: "LTE", thresholdKgPerM2: 2.5 },
  { id: "b4", maxKgPerM2: 3.5, regrowthDays: 75, label: "≤ 3.5 kg/m²", comparator: "LTE", thresholdKgPerM2: 3.5 },
  { id: "b5", maxKgPerM2: Number.POSITIVE_INFINITY, regrowthDays: 90, label: "> 3.5 kg/m²", comparator: "GT", thresholdKgPerM2: 3.5 },
];

export const DEFAULT_REGROWTH_REFERENCE_CONFIG: RegrowthReferenceConfig = {
  sodDays: 120,
  sodForSprigDays: 120,
  overrideRecoveryDays: 120,
  sprigBands: DEFAULT_BANDS,
};

/** Matches loveable_harvest `computeRegrowthDays(cfg, harvestType, kgPerM2)`. */
export type ScenarioHarvestType = "SOD" | "SPRIG" | "SOD_FOR_SPRIG";

export function computeRegrowthDaysFromConfig(
  cfg: RegrowthReferenceConfig,
  harvestType: ScenarioHarvestType,
  kgPerM2: number,
): number {
  if (harvestType === "SOD") return cfg.sodDays;
  if (harvestType === "SOD_FOR_SPRIG") return cfg.sodForSprigDays;
  const sorted = [...cfg.sprigBands].sort((a, b) => a.maxKgPerM2 - b.maxKgPerM2);
  for (const band of sorted) {
    if (kgPerM2 <= band.maxKgPerM2) return band.regrowthDays;
  }
  return sorted[sorted.length - 1]?.regrowthDays ?? 90;
}

export function parseMaxKgPerM2FromApi(
  raw: string | number | null | undefined,
): number {
  if (raw == null || raw === "") return Number.POSITIVE_INFINITY;
  const normalizedRaw =
    typeof raw === "string" ? raw.replace(",", ".").trim() : raw;
  const n =
    typeof normalizedRaw === "string"
      ? Number.parseFloat(normalizedRaw)
      : Number(normalizedRaw);
  if (!Number.isFinite(n)) return Number.POSITIVE_INFINITY;
  if (n >= 999999) return Number.POSITIVE_INFINITY;
  return n;
}

/**
 * Entry point dùng chung sau `fetchRegrowthRules()` cho Inventory và Inventory Forecast.
 * Mảng rỗng → cùng ý nghĩa với default (`regrowthReferenceFromRuleRows` đã fallback từng field).
 */
export function resolveRegrowthReferenceConfigFromRules(
  rows: RegrowthRuleRow[],
): RegrowthReferenceConfig {
  return regrowthReferenceFromRuleRows(rows);
}

export function regrowthReferenceFromRuleRows(
  rows: RegrowthRuleRow[],
): RegrowthReferenceConfig {
  const sod = rows.find((r) => r.harvest_type === "SOD");
  const sodForSprig = rows.find((r) => r.harvest_type === "SOD_FOR_SPRIG");
  const override = rows.find((r) => r.harvest_type === "OVERRIDE_RECOVERY");
  const sprig = rows
    .filter((r) => r.harvest_type === "SPRIG")
    .sort((a, b) => a.sort_order - b.sort_order || Number(a.id) - Number(b.id));

  const sprigBands: SprigBandConfig[] =
    sprig.length > 0
      ? sprig.map((r) => ({
          id: String(r.id),
          label: r.label,
          regrowthDays: Number(r.regrowth_days) || 0,
          maxKgPerM2: parseMaxKgPerM2FromApi(r.max_kg_per_m2),
          comparator: parseComparator(r.band_comparator),
          thresholdKgPerM2: Number(
            r.band_threshold_kg_per_m2 ?? r.max_kg_per_m2 ?? 0,
          ) || 0,
        }))
      : DEFAULT_REGROWTH_REFERENCE_CONFIG.sprigBands.map((b) => ({ ...b }));

  return {
    sodDays: sod
      ? Number(sod.regrowth_days)
      : DEFAULT_REGROWTH_REFERENCE_CONFIG.sodDays,
    sodForSprigDays: sodForSprig
      ? Number(sodForSprig.regrowth_days)
      : DEFAULT_REGROWTH_REFERENCE_CONFIG.sodForSprigDays,
    overrideRecoveryDays: override
      ? Number(override.regrowth_days)
      : DEFAULT_REGROWTH_REFERENCE_CONFIG.overrideRecoveryDays,
    sprigBands,
  };
}

/**
 * kg/m² cho bảng regrowth SPRIG — khớp harvest list & PHP `safeDivideStrict`:
 * ưu tiên `kgPerM2` từ plan/API; không thì `quantity ÷ harvestedAreaM2`; mẫu 0 → 0 (không fallback 1).
 */
export function harvestDensityKgPerM2ForRegrowth(row: {
  quantity: number;
  harvestedAreaM2: number;
  kgPerM2?: number;
}): number {
  const fromApi = row.kgPerM2;
  if (fromApi != null && Number.isFinite(fromApi) && fromApi > 0) return fromApi;
  return safeDivideStrictPhp(row.quantity, row.harvestedAreaM2);
}

export function isKgUom(uom?: string): boolean {
  const u = String(uom ?? "")
    .toLowerCase()
    .trim();
  return (
    u === "kg" ||
    u === "kgs" ||
    u === "kilogram" ||
    u === "kilograms"
  );
}

function sprigBandRegrowthDays(
  cfg: RegrowthReferenceConfig,
  row: ForecastHarvestRow,
): number {
  const kgPerM2 = harvestDensityKgPerM2ForRegrowth(row);
  const sorted = [...cfg.sprigBands];
  for (const band of sorted) {
    const threshold = Number.isFinite(band.thresholdKgPerM2)
      ? band.thresholdKgPerM2
      : band.maxKgPerM2;
    const cmp = band.comparator ?? "LTE";
    const matched =
      cmp === "LT"
        ? kgPerM2 < threshold
        : cmp === "LTE"
          ? kgPerM2 <= threshold
          : cmp === "EQ"
            ? Math.abs(kgPerM2 - threshold) < 0.000001
            : cmp === "GTE"
              ? kgPerM2 >= threshold
              : kgPerM2 > threshold;
    if (matched) return band.regrowthDays;
  }
  return cfg.sprigBands[cfg.sprigBands.length - 1]?.regrowthDays ?? 90;
}

/**
 * Aligns with Desktop `computeRegrowthDays` + stsrenew UOM rules:
 * - UOM kg → sprig bands by kg/m² (quantity / harvested area).
 * - UOM M2 (or non-kg) → sod vs sod-for-sprig days from harvest classification.
 */
export function computeRegrowthDaysForHarvest(
  cfg: RegrowthReferenceConfig,
  row: ForecastHarvestRow,
): number {

  // Rule: SPRIG OR UOM kg => choose by sprig kg/m² bands.
  if (isKgUom(row.uom) || row.harvestType === "sprig") {
    return sprigBandRegrowthDays(cfg, row);
  }
  if (row.harvestType === "sod_for_sprig") {
    return cfg.sodForSprigDays;
  }
  return cfg.sodDays;
}

/** Match Harvesting Portal / ForecastingPage zone keys (strip leading capitals). */
export function normalizeHarvestZoneKey(harvestZone: string): string {
  return String(harvestZone ?? "").replace(/^[A-Z]+/, "");
}
