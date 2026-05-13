"use client";

import { canAccessModule, type PermissionModule } from "@/shared/auth/permissions";
import { useAuthUserStore } from "@/shared/store/authUserStore";

export function useModuleAccess(moduleName: PermissionModule) {
  const user = useAuthUserStore((s) => s.user);
  return {
    canShow: canAccessModule(user, moduleName, "show"),
    canCreate: canAccessModule(user, moduleName, "create"),
    canEdit: canAccessModule(user, moduleName, "edit"),
    canDelete: canAccessModule(user, moduleName, "delete"),
    canImport: canAccessModule(user, moduleName, "import"),
  };
}
