/**
 * Parity with loveable_harvest `ForecastingPage.tsx` zone forecast:
 * available = maxInventoryKg − Σ depleted
 * depleted += Q × (1 − progress) per harvest still regrowing
 */
import {
  computeRegrowthDaysFromConfig,
  DEFAULT_REGROWTH_REFERENCE_CONFIG,
  type RegrowthReferenceConfig,
  type ScenarioHarvestType,
} from "@/features/forecasting/forecastingRegrowth";

export type ScenarioHarvestDef = {
  id: string;
  label: string;
  date: string;
  qty: number;
  /** Default SOD — same as loveable_harvest harvest rows in scenarios. */
  harvestType?: ScenarioHarvestType;
  /** Used for SPRIG band lookup; ignored for SOD / SOD_FOR_SPRIG. */
  kgPerM2?: number;
};

export function regrowthDaysForScenarioHarvest(
  harvest: ScenarioHarvestDef,
  regrowthConfig: RegrowthReferenceConfig = DEFAULT_REGROWTH_REFERENCE_CONFIG,
): number {
  return computeRegrowthDaysFromConfig(
    regrowthConfig,
    harvest.harvestType ?? "SOD",
    harvest.kgPerM2 ?? 0,
  );
}

export type InventoryOverrideDef = {
  date: string;
  updatedKg: number;
};

export type LoveableZoneResult = {
  available: number;
  depleted: number;
  regrowing: number;
  byHarvestDepletion: Record<string, number>;
  mode: "depleted" | "override";
};

function parseYmdLocal(value: string): Date {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return new Date(value);
  // Match loveable_harvest ForecastingPage: `new Date(isoDateString)` (UTC midnight).
  return new Date(value);
}

function diffDays(fromYmd: string, toYmd: string): number {
  const from = parseYmdLocal(fromYmd).getTime();
  const to = parseYmdLocal(toYmd).getTime();
  return (to - from) / (1000 * 60 * 60 * 24);
}

function elapsedDays(fromYmd: string, toYmd: string): number {
  return diffDays(fromYmd, toYmd);
}

function isStillRegrowing(harvestDateYmd: string, forecastYmd: string, regrowDays: number): boolean {
  const hDate = parseYmdLocal(harvestDateYmd);
  const forecastDate = parseYmdLocal(forecastYmd);
  if (hDate.getTime() > forecastDate.getTime()) return false;
  const regrowDate = new Date(hDate);
  regrowDate.setDate(regrowDate.getDate() + regrowDays);
  return regrowDate.getTime() > forecastDate.getTime();
}

function depletionForHarvest(
  harvestDateYmd: string,
  qty: number,
  forecastYmd: string,
  regrowDays: number,
  share = 1,
): number | null {
  if (!isStillRegrowing(harvestDateYmd, forecastYmd, regrowDays)) return null;
  const elapsed = elapsedDays(harvestDateYmd, forecastYmd);
  const progress = Math.max(0, Math.min(elapsed / regrowDays, 1));
  return qty * (1 - progress) * share;
}

export function computeLoveableZoneAtDate(
  zoneMaxKg: number,
  harvests: ScenarioHarvestDef[],
  forecastYmd: string,
  regrowthConfig: RegrowthReferenceConfig = DEFAULT_REGROWTH_REFERENCE_CONFIG,
  inventoryOverride?: InventoryOverrideDef,
): LoveableZoneResult {
  const forecastMs = parseYmdLocal(forecastYmd).getTime();

  if (inventoryOverride) {
    const overrideMs = parseYmdLocal(inventoryOverride.date).getTime();
    if (forecastMs >= overrideMs) {
      const daysSinceOverride = elapsedDays(inventoryOverride.date, forecastYmd);
      const deficit = zoneMaxKg - inventoryOverride.updatedKg;
      let baseProjected = inventoryOverride.updatedKg;
      let regrowing = 0;

      if (deficit > 0) {
        const recoveryDays = regrowthConfig.overrideRecoveryDays;
        const recovered = Math.min(deficit, deficit * (daysSinceOverride / recoveryDays));
        baseProjected = inventoryOverride.updatedKg + recovered;
        regrowing = Math.max(0, deficit - recovered);
      }

      let plannedDeduction = 0;
      for (const h of harvests) {
        const hMs = parseYmdLocal(h.date).getTime();
        if (hMs > overrideMs && hMs <= forecastMs) {
          plannedDeduction += h.qty;
        }
      }

      const available = Math.max(
        0,
        Math.min(zoneMaxKg, Math.round(baseProjected - plannedDeduction)),
      );
      return {
        available,
        depleted: zoneMaxKg - available,
        regrowing,
        byHarvestDepletion: {},
        mode: "override",
      };
    }
  }

  let depleted = 0;
  const byHarvestDepletion: Record<string, number> = {};

  for (const h of harvests) {
    const regrowDays = regrowthDaysForScenarioHarvest(h, regrowthConfig);
    const dep = depletionForHarvest(h.date, h.qty, forecastYmd, regrowDays);
    if (dep != null) {
      byHarvestDepletion[h.id] = dep;
      depleted += dep;
    }
  }

  return {
    available: Math.max(0, zoneMaxKg - depleted),
    depleted,
    regrowing: depleted,
    byHarvestDepletion,
    mode: "depleted",
  };
}

export { diffDays, parseYmdLocal };
