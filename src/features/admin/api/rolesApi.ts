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
  "admin_zones",
  "admin_regrowth",
  "admin_grasses",
  "dashboard",
] as const;

export const ROLE_ACTIONS = [
  "can_show",
  "can_edit",
  "can_create",
  "can_delete",
  "can_import",
] as const;

export type RoleAction = (typeof ROLE_ACTIONS)[number];
export type RoleModule = (typeof QUICK_ROLE_MODULES)[number];
export type RolePermissionKey = `${RoleAction}_${RoleModule}`;

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
