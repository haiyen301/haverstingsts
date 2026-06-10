"use client";

import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import { stsProxyGet, stsProxyPostJson } from "@/shared/api/stsProxyClient";

export const QUICK_ROLE_MODULES = [
  "my_alerts",
  "projects",
  "forecasting",
  "inventory",
  "harvest_schedule",
  "harvests",
  "admin_people",
  "admin_project_types",
  "admin_architects",
  "admin_farms",
  "admin_zones",
  "admin_regrowth",
  "admin_grasses",
  "admin_key_areas",
  "admin_project_paces",
  "admin_countries",
  "dashboard",
] as const;

export const ROLE_ACTIONS = [
  "can_show",
  "can_edit",
  "can_create",
  "can_delete",
  "can_import",
  "can_export",
] as const;

/** Same modules as Quick Toggle — each row can grant full data visibility (requires show). */
export const VIEW_ALL_DATA_ROLE_MODULES = QUICK_ROLE_MODULES;

export const VIEW_ALL_DATA_ACTION = "can_view_all_data" as const;

export type RoleAction = (typeof ROLE_ACTIONS)[number];
export type RoleModule = (typeof QUICK_ROLE_MODULES)[number];
export type RolePermissionKey = `${RoleAction}_${RoleModule}`;

const FULL_MODULE_ACTIONS: RoleAction[] = [...ROLE_ACTIONS];

/** Per-module allowed actions in the roles UI (others get the full set). */
export const MODULE_ALLOWED_ACTIONS: Record<RoleModule, RoleAction[]> = {
  my_alerts: FULL_MODULE_ACTIONS,
  projects: FULL_MODULE_ACTIONS,
  forecasting: ["can_show","can_export",],
  inventory: ["can_show", "can_edit", "can_create", "can_delete","can_export"],
  harvest_schedule: ["can_show","can_export"],
  harvests: FULL_MODULE_ACTIONS,
  admin_people: FULL_MODULE_ACTIONS,
  admin_project_types: FULL_MODULE_ACTIONS,
  admin_architects: FULL_MODULE_ACTIONS,
  admin_farms: FULL_MODULE_ACTIONS,
  admin_zones: FULL_MODULE_ACTIONS,
  admin_regrowth: FULL_MODULE_ACTIONS,
  admin_grasses: FULL_MODULE_ACTIONS,
  admin_key_areas: FULL_MODULE_ACTIONS,
  admin_project_paces: FULL_MODULE_ACTIONS,
  admin_countries: FULL_MODULE_ACTIONS,
  dashboard: ["can_show","can_export"],
};

/** Modules that expose the "view all data" permission in the roles UI. */
export const MODULE_SUPPORTS_VIEW_ALL: Record<RoleModule, boolean> = {
  my_alerts: true,
  projects: true,
  forecasting: true,
  inventory: true,
  harvest_schedule: true,
  harvests: true,
  admin_people: true,
  admin_project_types: true,
  admin_architects: true,
  admin_farms: true,
  admin_zones: true,
  admin_regrowth: true,
  admin_grasses: true,
  admin_key_areas: true,
  admin_project_paces: true,
  admin_countries: true,
  dashboard: true,
};

export function moduleAllowsAction(moduleName: RoleModule, action: RoleAction): boolean {
  return MODULE_ALLOWED_ACTIONS[moduleName].includes(action);
}

export function moduleSupportsViewAll(moduleName: RoleModule): boolean {
  return MODULE_SUPPORTS_VIEW_ALL[moduleName];
}

/** Modules that support a given action (for quick-toggle "select all"). */
export function modulesForAction(action: RoleAction): RoleModule[] {
  return QUICK_ROLE_MODULES.filter((moduleName) => moduleAllowsAction(moduleName, action));
}

/** Modules that support view-all in the roles UI. */
export function modulesForViewAll(): RoleModule[] {
  return QUICK_ROLE_MODULES.filter((moduleName) => moduleSupportsViewAll(moduleName));
}

export type RoleRow = {
  id: number;
  title: string;
  permissions: Record<string, string>;
};

export async function fetchRoles(): Promise<RoleRow[]> {
  const data = await stsProxyGet<unknown[]>(STS_API_PATHS.roles);
  return Array.isArray(data) ? (data as RoleRow[]) : [];
}

export async function saveRole(payload: {
  id?: number;
  title: string;
  permissions: Record<string, string>;
}): Promise<RoleRow> {
  return stsProxyPostJson<RoleRow>(STS_API_PATHS.rolesSave, payload);
}

export async function removeRole(id: number): Promise<{ id: number }> {
  return stsProxyPostJson<{ id: number }>(STS_API_PATHS.rolesRemove, { id });
}
