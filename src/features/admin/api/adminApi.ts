"use client";

import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import { stsProxyGet, stsProxyGetWithParams, stsProxyPostJson } from "@/shared/api/stsProxyClient";

/**
 * Row from `project_form_catalog` (STSPortal). Shared catalog for project-type entries
 * and architect firm/unit entries; distinct from per-project `project_settings`.
 */
export type ProjectFormCatalogRow = {
  id: number;
  setting_key: string;
  label: string;
  route: string;
  icon?: string | null;
  sort_order: number;
  status: string;
  odoo_id?: string | null;
  /** LONGTEXT: JSON, HTML, or long article; optional */
  value?: string | null;
};

export type ProjectFormCatalogSegment = "project" | "architect";

export type ProjectFormCatalogSavePayload = {
  id?: number;
  catalog_segment: ProjectFormCatalogSegment;
  /** Optional; primary copy often lives in `value` */
  label?: string;
  route?: string;
  icon?: string | null;
  sort_order?: number;
  active?: boolean;
  odoo_id?: string | null;
  /** Main body: plain name, JSON, or HTML — omit on PATCH when unchanged */
  value?: string | null;
};

/** Rows for Architects admin: `setting_key` starts with `architect`. */
export function isArchitectCatalogKey(settingKey: string | null | undefined): boolean {
  return String(settingKey ?? "").trim().toLowerCase().startsWith("architect");
}

/** Rows for Projects admin: `setting_key` starts with `project`. */
export function isProjectCatalogKey(settingKey: string | null | undefined): boolean {
  return String(settingKey ?? "").trim().toLowerCase().startsWith("project");
}

export type ZoneSetupRow = {
  id: number | string;
  /** Comma-separated farm ids, e.g. `"1,2,3"`. `"0"` when global. */
  farm_id: number | string;
  is_global?: boolean;
  farm_name?: string | null;
  farm_names?: string[];
  country_name?: string | null;
  zone_name: string;
  label?: string | null;
  created_by?: number | string | null;
  created_by_name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ZoneSetupSavePayload = {
  id?: number;
  /** Comma-separated farm ids, e.g. `"1,2,3"`. */
  farm_id?: string;
  is_global?: boolean;
  zone_name: string;
};

export type ZoneConfigurationRow = {
  id: number;
  /** FK to `sts_farms.id` stored on `sts_zone_configurations`. */
  farm_id: number;
  /** Joined from `sts_farms` when the API includes it (inventory / admin UIs). */
  farm_name?: string | null;
  country?: string | null;
  /** FK to sts_grasses.id (persisted). */
  grass_id: number;
  /** Grass title from JOIN — use for display / matching legacy UI. */
  turfgrass?: string;
  /** When `sts_zones` exists: `sts_zones.id` as string; legacy rows may still hold zone_name text. */
  zone: string;
  size_m2: string | number;
  inventory_kg_per_m2: string | number;
  max_inventory_kg: string | number;
  date_planted?: string | null;
  /** Inclusive start of zone setup validity (yyyy-MM-dd). */
  effective_from?: string | null;
  /** Inclusive end of zone setup validity; null = open-ended. */
  effective_to?: string | null;
};

export type ZoneConfigurationSavePayload = {
  id?: number;
  /** FK to `sts_farms.id` on `sts_zone_configurations`. */
  farm_id: number;
  country?: string | null;
  grass_id: number;
  /** `sts_zones.id` (string/number accepted); server validates against farm/global scope. */
  zone: string;
  size_m2: number;
  inventory_kg_per_m2: number;
  max_inventory_kg?: number;
  date_planted?: string | null;
  effective_from?: string | null;
  effective_to?: string | null;
  status?: string;
};

export type InventoryBalanceRow = {
  id: number;
  zone_configuration_id?: number | null;
  farm_id: number;
  farm_name?: string | null;
  grass_id: number;
  turfgrass?: string | null;
  zone: string;
  balance_date: string;
  available_kg: string | number;
  calculated_kg?: string | number | null;
  max_inventory_kg?: string | number | null;
  created_by?: number | string;
  created_by_name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type InventoryBalanceSavePayload = {
  id?: number;
  zone_configuration_id?: number | null;
  farm_id: number;
  grass_id: number;
  zone: string;
  balance_date: string;
  available_kg: number;
  calculated_kg?: number | null;
};

export type GrassCultivarProfileRow = {
  id: number;
  cultivar_key: string;
  display_name: string;
  grass_group: string;
  base_inventory_kg_per_m2: string | number;
  base_recovery_days: string | number;
  recovery_multiplier: string | number;
  min_recovery_days: string | number;
  max_recovery_days: string | number;
  default_mowing_height_mm: string | number;
  default_nitrogen_kg_ha_month: string | number;
};

export type ZoneAutoConfigurationRow = {
  id: number;
  zone_configuration_id: number;
  grass_cultivar_profile_id: number;
  auto_enabled: string | number | boolean;
  weather_location_id?: string | null;
  management_level?: string | null;
  soil_type?: string | null;
  soil_factor?: string | number | null;
  drainage_score?: string | number | null;
  ph_value?: string | number | null;
  organic_matter_pct?: string | number | null;
  compaction_score?: string | number | null;
  shade_percent?: string | number | null;
  irrigation_mode?: string | null;
  irrigation_mm_per_week?: string | number | null;
  nitrogen_kg_ha_month?: string | number | null;
  potassium_factor?: string | number | null;
  mowing_height_mm?: string | number | null;
  mowing_frequency_per_week?: string | number | null;
  traffic_level?: string | number | null;
  pest_disease_risk_score?: string | number | null;
  allow_auto_update_inventory?: string | number | boolean;
  allow_auto_fill_harvest_area?: string | number | boolean;
  last_inventory_kg_per_m2?: string | number | null;
  last_recovery_days?: string | number | null;
  last_confidence_pct?: string | number | null;
  last_factor_json?: string | null;
  last_reason_json?: string | null;
  last_calculated_at?: string | null;
  farm_name?: string;
  country?: string | null;
  turfgrass?: string;
  zone?: string;
  cultivar_key?: string;
  cultivar_display_name?: string;
};

export type ZoneAutoConfigSavePayload = {
  zone_configuration_id: number;
  grass_cultivar_profile_id?: number;
  auto_enabled: boolean;
  weather_location_id?: string;
  management_level?: string;
  soil_type?: string;
  soil_factor?: number;
  drainage_score?: number;
  ph_value?: number | null;
  organic_matter_pct?: number | null;
  compaction_score?: number;
  shade_percent?: number;
  irrigation_mode?: string;
  irrigation_mm_per_week?: number;
  nitrogen_kg_ha_month?: number;
  potassium_factor?: number;
  mowing_height_mm?: number;
  mowing_frequency_per_week?: number;
  traffic_level?: number;
  pest_disease_risk_score?: number;
  allow_auto_update_inventory?: boolean;
  allow_auto_fill_harvest_area?: boolean;
};

export type ZoneAutoRecommendation = {
  zone_configuration_id: number;
  zone_auto_configuration_id: number;
  inventory_kg_per_m2: number;
  recovery_days: number;
  confidence_pct: number;
  factors?: Record<string, number>;
  reasons?: string[];
  weather?: Record<string, unknown>;
};

export type RegrowthRuleRow = {
  id: number;
  harvest_type: string;
  label: string;
  max_kg_per_m2?: string | number | null;
  band_comparator?: "LT" | "LTE" | "EQ" | "GTE" | "GT" | null;
  band_threshold_kg_per_m2?: string | number | null;
  regrowth_days: number;
  sort_order: number;
  status: string;
};

/** Row from `sts_grasses` (STSPortal `grasses` table). */
export type GrassTypeRow = {
  id: number;
  title: string;
  country?: string | null;
  sales_from?: string | null;
  sales_to?: string | null;
  description?: string | null;
  /** `active` | `inactive` — column from migration `AddStatusToStsGrasses`. */
  status?: string | null;
};

export type GrassTypeSavePayload = {
  id?: number;
  title: string;
  country?: string | null;
  description?: string | null;
  sales_from?: string | null;
  sales_to?: string | null;
  status?: string | null;
};

/** Row from `sts_farms` (STSPortal `farms` table). */
export type FarmRow = {
  id: number;
  name: string;
  country_id: number;
  country_name?: string | null;
  hotline?: string | null;
  address?: string | null;
};

export type FarmSavePayload = {
  id?: number;
  name: string;
  country_id: number;
  hotline?: string | null;
  address?: string | null;
};

/** POST body for `/api/regrowth_rules/save` */
export type RegrowthRulesSavePayload = {
  sod_days: number;
  sod_for_sprig_days: number;
  override_recovery_days: number;
  sprig_bands: Array<{
    id: string | number;
    label: string;
    /** Omit or `null` for open-ended (∞) band */
    max_kg_per_m2: number | null;
    /** Explicit comparator avoids relying on label symbols in UI. */
    band_comparator?: "LT" | "LTE" | "EQ" | "GTE" | "GT";
    /** Numeric threshold used with `band_comparator`. */
    band_threshold_kg_per_m2?: number | null;
    regrowth_days: number;
  }>;
};

export async function fetchProjectFormCatalog(): Promise<ProjectFormCatalogRow[]> {
  const data = await stsProxyGetWithParams<unknown[]>(STS_API_PATHS.projectFormCatalog, {
    admin: 1,
  });
  return Array.isArray(data) ? (data as ProjectFormCatalogRow[]) : [];
}

export async function saveProjectFormCatalogRow(
  payload: ProjectFormCatalogSavePayload,
): Promise<ProjectFormCatalogRow> {
  return stsProxyPostJson<ProjectFormCatalogRow>(
    STS_API_PATHS.projectFormCatalogSave,
    payload,
  );
}

export async function removeProjectFormCatalogRow(
  id: number,
  catalog_segment: ProjectFormCatalogSegment,
): Promise<{ id: number }> {
  return stsProxyPostJson<{ id: number }>(STS_API_PATHS.projectFormCatalogRemove, {
    id,
    catalog_segment,
  });
}

export async function fetchArchitectCatalogRows(): Promise<ProjectFormCatalogRow[]> {
  const rows = await fetchProjectFormCatalog();
  return rows.filter((r) => isArchitectCatalogKey(r.setting_key));
}

export async function fetchZones(): Promise<ZoneSetupRow[]> {
  const data = await stsProxyGet<unknown[]>(STS_API_PATHS.zones);
  return Array.isArray(data) ? (data as ZoneSetupRow[]) : [];
}

export async function saveZone(payload: ZoneSetupSavePayload): Promise<ZoneSetupRow> {
  return stsProxyPostJson<ZoneSetupRow>(STS_API_PATHS.zonesSave, payload);
}

export async function removeZone(id: number): Promise<{ id: number }> {
  return stsProxyPostJson<{ id: number }>(STS_API_PATHS.zonesRemove, { id });
}

export async function fetchZoneConfigurations(): Promise<ZoneConfigurationRow[]> {
  const data = await stsProxyGet<unknown[]>(STS_API_PATHS.zoneConfigurations);
  return Array.isArray(data) ? (data as ZoneConfigurationRow[]) : [];
}

export async function saveZoneConfiguration(
  payload: ZoneConfigurationSavePayload,
): Promise<ZoneConfigurationRow> {
  return stsProxyPostJson<ZoneConfigurationRow>(
    STS_API_PATHS.zoneConfigurationsSave,
    payload,
  );
}

export async function removeZoneConfiguration(id: number): Promise<{ id: number }> {
  return stsProxyPostJson<{ id: number }>(STS_API_PATHS.zoneConfigurationsRemove, {
    id,
  });
}

export async function fetchInventoryBalanceRows(): Promise<InventoryBalanceRow[]> {
  const data = await stsProxyGet<unknown[]>(STS_API_PATHS.inventoryBalance);
  return Array.isArray(data) ? (data as InventoryBalanceRow[]) : [];
}

export async function saveInventoryBalance(
  payload: InventoryBalanceSavePayload,
): Promise<InventoryBalanceRow> {
  return stsProxyPostJson<InventoryBalanceRow>(
    STS_API_PATHS.inventoryBalanceSave,
    payload,
  );
}

export async function removeInventoryBalance(id: number): Promise<{ id: number }> {
  return stsProxyPostJson<{ id: number }>(STS_API_PATHS.inventoryBalanceRemove, {
    id,
  });
}

export async function fetchGrassCultivarProfiles(): Promise<GrassCultivarProfileRow[]> {
  const data = await stsProxyGet<unknown[]>(STS_API_PATHS.zoneAutoProfiles);
  return Array.isArray(data) ? (data as GrassCultivarProfileRow[]) : [];
}

export async function fetchZoneAutoConfigurations(): Promise<ZoneAutoConfigurationRow[]> {
  const data = await stsProxyGet<unknown[]>(STS_API_PATHS.zoneAutoConfigurations);
  return Array.isArray(data) ? (data as ZoneAutoConfigurationRow[]) : [];
}

export async function saveZoneAutoConfiguration(
  payload: ZoneAutoConfigSavePayload,
): Promise<{ config: ZoneAutoConfigurationRow | null; recommendation: ZoneAutoRecommendation | null }> {
  return stsProxyPostJson<{
    config: ZoneAutoConfigurationRow | null;
    recommendation: ZoneAutoRecommendation | null;
  }>(STS_API_PATHS.zoneAutoSave, payload);
}

export async function calculateZoneAutoConfiguration(
  zoneConfigurationId: number,
): Promise<ZoneAutoRecommendation> {
  return stsProxyPostJson<ZoneAutoRecommendation>(STS_API_PATHS.zoneAutoCalculate, {
    zone_configuration_id: zoneConfigurationId,
    save_result: true,
  });
}

export async function runDailyZoneAutoConfigurations(): Promise<{
  run_date: string;
  count: number;
  results: ZoneAutoRecommendation[];
}> {
  return stsProxyPostJson<{
    run_date: string;
    count: number;
    results: ZoneAutoRecommendation[];
  }>(STS_API_PATHS.zoneAutoRunDaily, {});
}

export async function fetchRegrowthRules(): Promise<RegrowthRuleRow[]> {
  const data = await stsProxyGet<unknown[]>(STS_API_PATHS.regrowthRules);
  return Array.isArray(data) ? (data as RegrowthRuleRow[]) : [];
}

export async function saveRegrowthRules(
  payload: RegrowthRulesSavePayload,
): Promise<RegrowthRuleRow[]> {
  const data = await stsProxyPostJson<unknown[]>(
    STS_API_PATHS.regrowthRulesSave,
    payload,
  );
  return Array.isArray(data) ? (data as RegrowthRuleRow[]) : [];
}

export async function fetchGrassTypes(): Promise<GrassTypeRow[]> {
  const data = await stsProxyGet<unknown[]>(STS_API_PATHS.grasses);
  return Array.isArray(data) ? (data as GrassTypeRow[]) : [];
}

export async function saveGrassType(payload: GrassTypeSavePayload): Promise<GrassTypeRow> {
  return stsProxyPostJson<GrassTypeRow>(STS_API_PATHS.grassesSave, payload);
}

export async function removeGrassType(id: number): Promise<{ id: number }> {
  return stsProxyPostJson<{ id: number }>(STS_API_PATHS.grassesRemove, { id });
}

export async function fetchFarms(): Promise<FarmRow[]> {
  const data = await stsProxyGet<unknown[]>(STS_API_PATHS.farms);
  const rows = Array.isArray(data) ? (data as FarmRow[]) : [];
  return [...rows].sort((a, b) => Number(a.id) - Number(b.id));
}

export async function saveFarm(payload: FarmSavePayload): Promise<FarmRow> {
  return stsProxyPostJson<FarmRow>(STS_API_PATHS.farmsSave, payload);
}

export async function removeFarm(id: number): Promise<{ id: number }> {
  return stsProxyPostJson<{ id: number }>(STS_API_PATHS.farmsRemove, { id });
}

export type KeyAreaRow = {
  id: number;
  title: string;
  sort_order?: number | null;
};

export type KeyAreaSavePayload = {
  id?: number;
  title: string;
  sort_order?: number;
};

/** Alphabetical tie-breaker / default placement for new or renamed rows. */
export function compareKeyAreaRowsByTitle(a: KeyAreaRow, b: KeyAreaRow): number {
  return (
    String(a.title ?? "").localeCompare(String(b.title ?? ""), undefined, {
      sensitivity: "base",
    }) || Number(a.id) - Number(b.id)
  );
}

export function sortKeyAreaRowsByTitle(list: KeyAreaRow[]): KeyAreaRow[] {
  return [...list].sort(compareKeyAreaRowsByTitle);
}

/** Display order: persisted sort_order first, then title. */
export function sortKeyAreaRowsBySortOrder(list: KeyAreaRow[]): KeyAreaRow[] {
  return [...list].sort(
    (a, b) =>
      Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) ||
      compareKeyAreaRowsByTitle(a, b),
  );
}

export function sortKeyAreaRows(list: KeyAreaRow[]): KeyAreaRow[] {
  return sortKeyAreaRowsBySortOrder(list);
}

/** Place one row at its alphabetical slot; keeps each row's current sort_order until persisted. */
export function keyAreaListInAlphaOrder(
  list: KeyAreaRow[],
  item: KeyAreaRow,
): KeyAreaRow[] {
  const without = list.filter((row) => Number(row.id) !== Number(item.id));
  return sortKeyAreaRowsByTitle([...without, item]);
}

export async function fetchKeyAreas(): Promise<KeyAreaRow[]> {
  const data = await stsProxyGet<unknown[]>(STS_API_PATHS.keyareas);
  return sortKeyAreaRowsBySortOrder(Array.isArray(data) ? (data as KeyAreaRow[]) : []);
}

export async function saveKeyArea(payload: KeyAreaSavePayload): Promise<KeyAreaRow> {
  return stsProxyPostJson<KeyAreaRow>(STS_API_PATHS.keyareasSave, payload);
}

export async function removeKeyArea(id: number): Promise<{ id: number }> {
  return stsProxyPostJson<{ id: number }>(STS_API_PATHS.keyareasRemove, { id });
}

export type ProjectPaceRow = {
  id: number;
  pace_key: string;
  title: string;
  duration_months: number;
  harvest_batches: number;
  harvest_every_weeks: number;
  sort_order?: number | null;
};

export type ProjectPaceSavePayload = {
  id?: number;
  pace_key: string;
  title: string;
  duration_months: number;
  harvest_batches: number;
  harvest_every_weeks: number;
  sort_order?: number;
};

export function sortProjectPaceRows(list: ProjectPaceRow[]): ProjectPaceRow[] {
  return [...list].sort(
    (a, b) =>
      Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) ||
      String(a.title ?? "").localeCompare(String(b.title ?? ""), undefined, {
        sensitivity: "base",
      }) ||
      Number(a.id) - Number(b.id),
  );
}

export async function fetchProjectPaces(): Promise<ProjectPaceRow[]> {
  const data = await stsProxyGet<unknown[]>(STS_API_PATHS.projectPaces);
  return sortProjectPaceRows(Array.isArray(data) ? (data as ProjectPaceRow[]) : []);
}

export async function saveProjectPace(
  payload: ProjectPaceSavePayload,
): Promise<ProjectPaceRow> {
  return stsProxyPostJson<ProjectPaceRow>(STS_API_PATHS.projectPacesSave, payload);
}

export async function removeProjectPace(id: number): Promise<{ id: number }> {
  return stsProxyPostJson<{ id: number }>(STS_API_PATHS.projectPacesRemove, { id });
}
