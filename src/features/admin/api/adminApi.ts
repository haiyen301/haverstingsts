"use client";

import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import { stsProxyGet, stsProxyPostJson } from "@/shared/api/stsProxyClient";

export type ProjectSettingRow = {
  id: number;
  setting_key: string;
  label: string;
  route: string;
  icon?: string | null;
  sort_order: number;
  status: string;
};

export type ArchitectRow = {
  id?: number;
  name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  status?: string;
};

export type ZoneConfigurationRow = {
  id: number;
  farm_name: string;
  country?: string | null;
  turfgrass: string;
  zone: string;
  size_m2: string | number;
  inventory_kg_per_m2: string | number;
  max_inventory_kg: string | number;
  date_planted?: string | null;
};

export type RegrowthRuleRow = {
  id: number;
  harvest_type: string;
  label: string;
  max_kg_per_m2?: string | number | null;
  regrowth_days: number;
  sort_order: number;
  status: string;
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
    regrowth_days: number;
  }>;
};

export async function fetchProjectSettings(): Promise<ProjectSettingRow[]> {
  const data = await stsProxyGet<unknown[]>(STS_API_PATHS.projectSetting);
  return Array.isArray(data) ? (data as ProjectSettingRow[]) : [];
}

export async function fetchArchitects(): Promise<ArchitectRow[]> {
  const data = await stsProxyGet<unknown[]>(STS_API_PATHS.staffs);
  return Array.isArray(data) ? (data as ArchitectRow[]) : [];
}

export async function fetchZoneConfigurations(): Promise<ZoneConfigurationRow[]> {
  const data = await stsProxyGet<unknown[]>(STS_API_PATHS.zoneConfigurations);
  return Array.isArray(data) ? (data as ZoneConfigurationRow[]) : [];
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
