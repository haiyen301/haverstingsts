import type { SessionUser } from "@/shared/lib/sessionUser";

export type PermissionAction =
  | "show"
  | "create"
  | "edit"
  | "delete"
  | "import"
  | (string & {});
export type PermissionModule = string;

type PermissionMap = Record<string, unknown>;
export const APP_PERMISSION_ACTIONS = [
  "show",
  "create",
  "edit",
  "delete",
  "import",
] as const;

export const APP_PERMISSION_MODULES = [
  "dashboard",
  "my_alerts",
  "projects",
  "forecasting",
  "inventory",
  "harvest_schedule",
  "harvests",
  "admin_people",
  "admin_roles",
  "admin_project_types",
  "admin_architects",
  "admin_zones",
  "admin_regrowth",
  "admin_grasses",
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
  return hasModulePermission(moduleName, user, action);
}

export function buildAclSnapshotFromProfile(profile: unknown): PermissionAclSnapshot {
  const data = asRecord(profile);
  const permissions = asRecord(data.permissions);
  const compactPermissions: PermissionMap = {};
  for (const moduleName of APP_PERMISSION_MODULES) {
    for (const action of APP_PERMISSION_ACTIONS) {
      const key = buildPermissionKey(moduleName, action);
      if (permissions[key] !== undefined) {
        compactPermissions[key] = permissions[key];
      }
    }
    // Keep compatibility with legacy `<module>: all` values.
    if (permissions[moduleName] !== undefined) {
      compactPermissions[moduleName] = permissions[moduleName];
    }
  }
  return {
    is_admin:
      toTruthyPermission(data.is_admin) || toTruthyPermission(permissions.is_admin),
    permissions: compactPermissions,
  };
}
