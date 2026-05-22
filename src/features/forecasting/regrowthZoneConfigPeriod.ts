import type { ZoneConfigurationRow } from "@/features/admin/api/adminApi";
import {
  findActiveZoneConfiguration,
  forecastZoneKeyFromParts,
  zoneConfigHasPeriod,
  zoneConfigCoversYmd,
  zoneConfigYmdSlice,
  zoneConfigurationMaxKg,
} from "@/features/forecasting/inventoryRegrowthCalculator";
import { FORECAST_NOZONE_ZONE } from "@/features/forecasting/forecastingInventoryConversion";
import type { ZoneRegrowthBreakdown } from "@/features/forecasting/regrowthAllocation";

export type RegrowthZoneSetupKind = "period" | "default" | "not_set";

export type RegrowthZoneSetupBadge = {
  zone: string;
  kind: RegrowthZoneSetupKind;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  maxKg: number;
};

function normalizeZoneForMatch(zone: string): string {
  const s = String(zone ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, " ");
  if (!s || s === "no-zone" || s === "no zone") return FORECAST_NOZONE_ZONE;
  return s;
}

function zoneFromForecastZoneKey(zoneKey: string): string {
  const parts = String(zoneKey ?? "").split("|");
  if (parts.length !== 3) return "";
  return parts[1] ?? "";
}

function configsForIdentity(
  zoneConfigs: ZoneConfigurationRow[],
  farmId: number,
  productId: number,
  zone: string,
): ZoneConfigurationRow[] {
  const z = normalizeZoneForMatch(zone);
  return zoneConfigs.filter((row) => {
    if (Number(row.farm_id) !== farmId || Number(row.grass_id) !== productId) return false;
    const rowZone = normalizeZoneForMatch(String(row.zone ?? ""));
    return rowZone === z;
  });
}

/**
 * Which zone setup applies on regrowth day: dated period row, always-on default, or none.
 */
export function resolveZoneSetupAtRegrowthDate(
  zoneConfigs: ZoneConfigurationRow[],
  params: { farmId: number; productId: number; zone: string; regrowthYmd: string },
): RegrowthZoneSetupBadge {
  const zone = String(params.zone ?? "").trim() || FORECAST_NOZONE_ZONE;
  const { farmId, productId, regrowthYmd } = params;
  const empty: RegrowthZoneSetupBadge = {
    zone,
    kind: "not_set",
    effectiveFrom: null,
    effectiveTo: null,
    maxKg: 0,
  };

  const matches = configsForIdentity(zoneConfigs, farmId, productId, zone);
  if (matches.length === 0) return empty;

  const periodCovering = matches
    .filter((row) => zoneConfigHasPeriod(row) && zoneConfigCoversYmd(row, regrowthYmd))
    .sort((a, b) =>
      zoneConfigYmdSlice(b.effective_from).localeCompare(zoneConfigYmdSlice(a.effective_from)),
    )[0];

  if (periodCovering) {
    return {
      zone,
      kind: "period",
      effectiveFrom: zoneConfigYmdSlice(periodCovering.effective_from) || null,
      effectiveTo: zoneConfigYmdSlice(periodCovering.effective_to) || null,
      maxKg: zoneConfigurationMaxKg(periodCovering),
    };
  }

  const defaultRow = matches.find((row) => !zoneConfigHasPeriod(row));
  if (defaultRow) {
    return {
      zone,
      kind: "default",
      effectiveFrom: null,
      effectiveTo: null,
      maxKg: zoneConfigurationMaxKg(defaultRow),
    };
  }

  const active = findActiveZoneConfiguration(zoneConfigs, {
    farmId,
    productId,
    zone,
    ymd: regrowthYmd,
  });
  if (active) {
    if (zoneConfigHasPeriod(active)) {
      return {
        zone,
        kind: "period",
        effectiveFrom: zoneConfigYmdSlice(active.effective_from) || null,
        effectiveTo: zoneConfigYmdSlice(active.effective_to) || null,
        maxKg: zoneConfigurationMaxKg(active),
      };
    }
    return {
      zone,
      kind: "default",
      effectiveFrom: null,
      effectiveTo: null,
      maxKg: zoneConfigurationMaxKg(active),
    };
  }

  return empty;
}

export function collectZonesForRegrowthEvent(params: {
  farmId: number;
  productId: number;
  fragments: Array<{ zoneKey: string; zoneLabel: string }>;
  zoneBreakdowns: ZoneRegrowthBreakdown[];
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const add = (rawZone: string) => {
    const zone = String(rawZone ?? "").trim();
    const key = normalizeZoneForMatch(zone || FORECAST_NOZONE_ZONE);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(zone || FORECAST_NOZONE_ZONE);
  };

  for (const f of params.fragments) {
    const fromKey = zoneFromForecastZoneKey(f.zoneKey);
    add(fromKey || f.zoneLabel);
  }
  for (const z of params.zoneBreakdowns) {
    if (z.capKg > 0 || z.grossZonedKg > 0 || z.nozoneFillKg > 0 || z.creditedTotalKg > 0) {
      add(z.zoneLabel);
    }
  }

  if (out.length === 0) {
    add(FORECAST_NOZONE_ZONE);
  }

  return out;
}

export function buildRegrowthZoneSetupBadges(
  zoneConfigs: ZoneConfigurationRow[],
  params: {
    farmId: number;
    productId: number;
    regrowthYmd: string;
    fragments: Array<{ zoneKey: string; zoneLabel: string }>;
    zoneBreakdowns: ZoneRegrowthBreakdown[];
  },
): RegrowthZoneSetupBadge[] {
  const zones = collectZonesForRegrowthEvent({
    farmId: params.farmId,
    productId: params.productId,
    fragments: params.fragments,
    zoneBreakdowns: params.zoneBreakdowns,
  });

  return zones.map((zone) =>
    resolveZoneSetupAtRegrowthDate(zoneConfigs, {
      farmId: params.farmId,
      productId: params.productId,
      zone,
      regrowthYmd: params.regrowthYmd,
    }),
  );
}

/** Stable key for React lists (farm + grass + zone identity). */
export function regrowthZoneSetupBadgeKey(
  farmId: number,
  productId: number,
  badge: RegrowthZoneSetupBadge,
): string {
  return `${farmId}|${productId}|${normalizeZoneForMatch(badge.zone)}|${badge.kind}|${badge.effectiveFrom ?? ""}|${badge.effectiveTo ?? ""}`;
}

export { forecastZoneKeyFromParts };
