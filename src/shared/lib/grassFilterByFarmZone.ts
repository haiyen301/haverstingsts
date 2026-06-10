import type { ZoneConfigurationRow } from "@/features/admin/api/adminApi";
import { isForecastExcludedZone } from "@/features/forecasting/forecastingInventoryConversion";

import {
  mapRowsToSelectOptions,
  pickGrassCatalogRows,
  type GrassCatalogPickMode,
} from "@/shared/lib/harvestReferenceData";

export type GrassFilterSelectOption = { value: string; label: string };

export type ZoneConfigGrassLinkRow = Pick<
  ZoneConfigurationRow,
  "farm_id" | "grass_id" | "turfgrass" | "zone"
>;

export function buildGrassCatalogLabelById(catalog: unknown[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const g of catalog) {
    if (!g || typeof g !== "object") continue;
    const rec = g as Record<string, unknown>;
    const id = String(rec.id ?? "").trim();
    if (!id) continue;
    const label = String(rec.title ?? rec.name ?? "").trim();
    if (label) map.set(id, label);
  }
  return map;
}

/**
 * Grass ids configured in zone setup for the selected farm(s).
 * `null` when no farm is selected → caller should show the full grass catalog.
 */
export function collectGrassIdsFromZoneConfigForFarms(
  zoneConfigs: readonly ZoneConfigGrassLinkRow[],
  selectedFarmIds: readonly string[],
): Set<string> | null {
  const farms = selectedFarmIds.map((id) => String(id).trim()).filter(Boolean);
  if (farms.length === 0) return null;
  const farmSet = new Set(farms);
  const ids = new Set<string>();
  for (const row of zoneConfigs) {
    if (!farmSet.has(String(row.farm_id ?? "").trim())) continue;
    if (isForecastExcludedZone(row.zone)) continue;
    const grassId = String(row.grass_id ?? "").trim();
    if (grassId) ids.add(grassId);
  }
  return ids;
}

export type BuildGrassFilterOptionsForFarmsArgs = {
  grasses: unknown[];
  zoneConfigs: readonly ZoneConfigGrassLinkRow[];
  selectedFarmIds: readonly string[];
  /** URL / edit selections to keep visible when showing the full catalog. */
  pinnedGrassIds?: readonly string[];
  catalogMode?: GrassCatalogPickMode;
  refYmds?: string[];
};

/**
 * All farms → every grass type (respecting `catalogMode`).
 * Specific farm(s) → grasses from zone configuration only.
 */
export function buildGrassFilterOptionsForFarms(
  args: BuildGrassFilterOptionsForFarmsArgs,
): GrassFilterSelectOption[] {
  const pinnedGrassIds = [...(args.pinnedGrassIds ?? [])];
  const grassIdsFromZones = collectGrassIdsFromZoneConfigForFarms(
    args.zoneConfigs,
    args.selectedFarmIds,
  );
  const catalogLabelById = buildGrassCatalogLabelById(args.grasses);

  if (grassIdsFromZones === null) {
    const picked = pickGrassCatalogRows({
      catalog: args.grasses,
      mode: args.catalogMode ?? "all",
      refYmds: args.refYmds ?? [],
      pinnedGrassIds,
    });
    return mapRowsToSelectOptions(picked, "title")
      .map((o) => ({ value: o.id, label: o.label }))
      .filter((o) => o.value)
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  const options: GrassFilterSelectOption[] = [];
  const seen = new Set<string>();
  const pushOption = (id: string, turfLabel: string | null) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    options.push({
      value: id,
      label: catalogLabelById.get(id) ?? turfLabel ?? id,
    });
  };

  for (const id of grassIdsFromZones) {
    const sample = args.zoneConfigs.find((row) => String(row.grass_id ?? "").trim() === id);
    const turf =
      sample?.turfgrass != null && String(sample.turfgrass).trim() !== ""
        ? String(sample.turfgrass).trim()
        : null;
    pushOption(id, turf);
  }

  // Edit / URL pins: keep grass visible even when it is not in zone config for the farm.
  for (const rawId of pinnedGrassIds) {
    const id = String(rawId ?? "").trim();
    if (!id) continue;
    const sample = args.zoneConfigs.find((row) => String(row.grass_id ?? "").trim() === id);
    const turf =
      sample?.turfgrass != null && String(sample.turfgrass).trim() !== ""
        ? String(sample.turfgrass).trim()
        : null;
    pushOption(id, turf);
  }

  return options.sort((a, b) => a.label.localeCompare(b.label));
}

/** Drop grass filter values that are not allowed for the current farm selection. */
export function pruneGrassIdsToFarmZoneOptions(
  selectedGrassIds: readonly string[],
  options: readonly GrassFilterSelectOption[],
): string[] {
  if (selectedGrassIds.length === 0) return [];
  const allowed = new Set(options.map((o) => o.value));
  return selectedGrassIds.filter((id) => allowed.has(id));
}

/** Keep rows whose `productId` is configured for the selected farm(s); pass through when `allowedGrassIds` is null. */
export function filterRowsByFarmZoneGrassSelection<
  T extends { productId: string },
>(rows: readonly T[], allowedGrassIds: Set<string> | null): T[] {
  if (allowedGrassIds === null) return [...rows];
  return rows.filter((row) => allowedGrassIds.has(row.productId));
}
