import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  hasModulePermission,
  type PermissionAction,
  type PermissionModule,
} from "@/shared/auth/permissions";
import { AUTH_COOKIE_NAME } from "@/shared/lib/authCookie";
import { fetchTrustedAclByToken } from "@/shared/server/trustedAcl";

export type ModuleAccess = {
  show: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
  import: boolean;
};

const EMPTY_ACCESS: ModuleAccess = {
  show: false,
  create: false,
  edit: false,
  delete: false,
  import: false,
};

export async function getModuleAccess(
  moduleName: PermissionModule,
): Promise<ModuleAccess> {
  const store = await cookies();
  const token = store.get(AUTH_COOKIE_NAME)?.value?.trim();
  if (!token) return EMPTY_ACCESS;

  const acl = await fetchTrustedAclByToken(token);
  if (!acl) return EMPTY_ACCESS;

  return {
    show: hasModulePermission(moduleName, acl.permissions, "show", acl.is_admin),
    create: hasModulePermission(moduleName, acl.permissions, "create", acl.is_admin),
    edit: hasModulePermission(moduleName, acl.permissions, "edit", acl.is_admin),
    delete: hasModulePermission(moduleName, acl.permissions, "delete", acl.is_admin),
    import: hasModulePermission(moduleName, acl.permissions, "import", acl.is_admin),
  };
}

export async function requireModuleAccessOr404(
  moduleName: PermissionModule,
  action: PermissionAction = "show",
): Promise<void> {
  const store = await cookies();
  const token = store.get(AUTH_COOKIE_NAME)?.value?.trim();
  if (!token) {
    redirect("/");
  }

  const acl = await fetchTrustedAclByToken(token);
  if (!acl) {
    notFound();
  }

  const allowed = hasModulePermission(
    moduleName,
    acl?.permissions ?? {},
    action,
    acl?.is_admin,
  );
  if (!allowed) {
    notFound();
  }
}
