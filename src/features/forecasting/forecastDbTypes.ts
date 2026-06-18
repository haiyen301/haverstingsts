/** DB snapshot series types — chart reads `inventory_daily_snapshots`, not client simulate. */

export type RollingDailyAvailableDay = {
  date: string;
  previousAvailableKg: number;
  regrowthKg: number;
  harvestKg: number;
  /** `previousAvailableKg + regrowthKg` before today's harvest deduction. */
  beforeHarvestKg: number;
  /** After capacity cap when cap > 0. */
  availableKg: number;
  rawAvailableKg: number;
  capacityCapKg: number;
  overlimitKg: number;
};

export type DailySeriesResult = {
  aggregate: RollingDailyAvailableDay[];
  byFarmProduct: Map<string, Map<string, RollingDailyAvailableDay>>;
};

export type ZoneInventoryDaySnapshot = {
  previousKg: number;
  regrowthKg: number;
  harvestKg: number;
  rollingBeforeManualSetKg: number | null;
  calculatedKg: number;
  effectiveKg: number;
  maxKg: number;
  pct: number;
  isManualOverrideActive: boolean;
  manualOverrideDate: string | null;
  manualOverrideKg: number | null;
  exactManualSetToday: boolean;
  isOpeningDay: boolean;
};
