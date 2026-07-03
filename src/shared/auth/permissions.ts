import type { SessionUser } from "@/shared/lib/sessionUser";
import { isAclReady } from "@/shared/store/authUserStore";

export type PermissionAction =
  | "show"
  | "create"
  | "edit"
  | "delete"
  | "import"
  | "export"
  | (string & {});
export type PermissionModule = string;

type PermissionMap = Record<string, unknown>;
export const APP_PERMISSION_ACTIONS = [
  "show",
  "create",
  "edit",
  "delete",
  "import",
  "export",
  "view_all_data",
  "setting",
] as const;

export const APP_PERMISSION_MODULES = [
  "dashboard",
  "my_alerts",
  "projects",
  "forecasting",
  "inventory",
  "harvest_schedule",
  "harvests",
  "fertilizer_usage",
  "vehicle_inspections",
  "fuel_usage",
  "equipment",
  "admin_people",
  "admin_roles",
  "admin_project_types",
  "admin_architects",
  "admin_farms",
  "admin_zones",
  "admin_regrowth",
  "admin_grasses",
  "admin_key_areas",
  "admin_project_paces",
  "admin_countries",
  "admin_items",
  "admin_item_categories",
  "admin_brands",
  "admin_units",
  "admin_machinery_types",
  "admin_fleet_option_catalogs",
  "admin_equipment_category",
] as const;

export type AppPermissionModule = (typeof APP_PERMISSION_MODULES)[number];

export type PermissionAclSnapshot = {
  is_admin: boolean;
  permissions: PermissionMap;
};

function normalizePermissionToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function asPermissionMap(input: SessionUser | PermissionMap | null | undefined): PermissionMap {
  if (!input || typeof input !== "object") return {};
  const maybeUser = input as SessionUser;
  const raw = maybeUser.permissions;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as PermissionMap;
  }
  return input as PermissionMap;
}

function asRecord(input: unknown): PermissionMap {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input as PermissionMap;
}

function toTruthyPermission(value: unknown): boolean {
  if (value === true || value === 1) return true;
  const text = String(value ?? "").trim().toLowerCase();
  return text === "1" || text === "true" || text === "yes" || text === "all";
}

export function isSuperAdmin(userOrPermissions: SessionUser | PermissionMap | null | undefined): boolean {
  if (!userOrPermissions || typeof userOrPermissions !== "object") return false;
  const user = userOrPermissions as SessionUser;
  if (toTruthyPermission(user.is_admin)) return true;
  const permissions = asPermissionMap(userOrPermissions);
  return toTruthyPermission(permissions.is_admin);
}

export function buildPermissionKey(moduleName: PermissionModule, action: PermissionAction): string {
  const moduleKey = normalizePermissionToken(String(moduleName));
  const actionKey = normalizePermissionToken(String(action));
  return `can_${actionKey}_${moduleKey}`;
}

export function hasModulePermission(
  moduleName: PermissionModule,
  userOrPermissions: SessionUser | PermissionMap | null | undefined,
  action: PermissionAction = "show",
  isAdminOverride?: unknown,
): boolean {
  if (toTruthyPermission(isAdminOverride) || isSuperAdmin(userOrPermissions)) return true;
  const permissions = asPermissionMap(userOrPermissions);
  const key = buildPermissionKey(moduleName, action);
  if (toTruthyPermission(permissions[key])) return true;

  // Backward-compat fallback for legacy permissions like `inventory: "all"`.
  if (normalizePermissionToken(String(action)) === "show") {
    const legacyKey = normalizePermissionToken(String(moduleName));
    if (toTruthyPermission(permissions[legacyKey])) return true;
  }
  return false;
}

export function canAccessModule(
  user: SessionUser | PermissionMap | null | undefined,
  moduleName: PermissionModule,
  action: PermissionAction = "show",
): boolean {
  if (isSuperAdmin(user)) return true;
  if (typeof window !== "undefined" && !isAclReady()) {
    return false;
  }
  return hasModulePermission(moduleName, user, action);
}

/**
 * Privileged settings UI for a module (e.g. project pace recalc).
 * Super admin always allowed; other users need `can_setting_{module}` on their role.
 */
export function canAccessModuleSetting(
  user: SessionUser | PermissionMap | null | undefined,
  moduleName: PermissionModule,
): boolean {
  return canAccessModule(user, moduleName, "setting");
}

export function canManageHelpKnowledgeBase(
  user: SessionUser | PermissionMap | null | undefined,
): boolean {
  return isSuperAdmin(user);
}

/**
 * Full data visibility for a module (no farm_id / created_by scoping on the server).
 * Requires Show on the same module. Super admin always returns true.
 */
export function canViewAllModuleData(
  user: SessionUser | PermissionMap | null | undefined,
  moduleName: PermissionModule,
): boolean {
  if (!hasModulePermission(moduleName, user, "show")) return false;
  if (isSuperAdmin(user)) return true;
  const permissions = asPermissionMap(user);
  if (
    moduleName === "projects" &&
    toTruthyPermission(permissions.can_manage_all_projects)
  ) {
    return true;
  }
  return hasModulePermission(moduleName, user, "view_all_data");
}

export function buildAclSnapshotFromProfile(profile: unknown): PermissionAclSnapshot {
  const data = asRecord(profile);
  const permissions = asRecord(data.permissions);
  const compactPermissions: PermissionMap = {};
  for (const moduleName of APP_PERMISSION_MODULES) {
    for (const action of APP_PERMISSION_ACTIONS) {
      const key = buildPermissionKey(moduleName, action);
      const value = permissions[key];
      if (value !== undefined && toTruthyPermission(value)) {
        compactPermissions[key] = "1";
      }
    }
    // Keep compatibility with legacy `<module>: all` values.
    const legacyValue = permissions[moduleName];
    if (legacyValue !== undefined && toTruthyPermission(legacyValue)) {
      compactPermissions[moduleName] = legacyValue;
    }
  }
  return {
    is_admin:
      toTruthyPermission(data.is_admin) || toTruthyPermission(permissions.is_admin),
    permissions: compactPermissions,
  };
}
