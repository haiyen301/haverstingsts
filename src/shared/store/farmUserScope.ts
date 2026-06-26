"use client";

import { useMemo } from "react";

import {
  canViewAllModuleData,
  isSuperAdmin,
  type AppPermissionModule,
} from "@/shared/auth/permissions";
import {
  mapRowsToSelectOptions,
  parseFarmIdsFromMeta,
  type HarvestSelectOption,
} from "@/shared/lib/harvestReferenceData";
import type { SessionUser } from "@/shared/lib/sessionUser";
import { getSessionUser, useAuthUserStore } from "@/shared/store/authUserStore";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";

export function farmUserMetaFromSessionUser(
  user: Pick<SessionUser, "farm_user_id" | "farmUserId"> | null | undefined,
): string | undefined {
  if (!user) return undefined;
  const raw = String(user.farm_user_id ?? user.farmUserId ?? "").trim();
  return raw || undefined;
}

/** Raw `farm_user_id` meta for API pass-through (server still enforces scope). */
export function readFarmUserMetaFromSession(): string | undefined {
  return farmUserMetaFromSessionUser(getSessionUser());
}

/**
 * Farm ids the current user may pick in farm filters.
 * `null` = unrestricted (super admin, view-all, or no farm meta).
 */
export function readUserFarmScopeIds(options?: {
  user?: SessionUser | null;
  bypassScope?: boolean;
}): string[] | null {
  if (options?.bypassScope) return null;
  const user = options?.user ?? getSessionUser();
  if (!user || isSuperAdmin(user)) return null;
  const ids = parseFarmIdsFromMeta(farmUserMetaFromSessionUser(user));
  return ids.length > 0 ? ids : null;
}

export function filterFarmCatalogByScope(
  farms: unknown[],
  scopeIds: string[] | null,
): unknown[] {
  if (!scopeIds?.length) return farms;
  const allowed = new Set(scopeIds);
  return farms.filter((row) => {
    if (!row || typeof row !== "object") return false;
    const id = String((row as Record<string, unknown>).id ?? "").trim();
    return id !== "" && allowed.has(id);
  });
}

export function clampFarmIdsToScope(
  ids: string[],
  scopeIds: string[] | null,
): string[] {
  if (!scopeIds?.length) return ids;
  const allowed = new Set(scopeIds);
  return ids.map((x) => x.trim()).filter((id) => id !== "" && allowed.has(id));
}

export function buildScopedFarmSelectOptions(
  farms: unknown[],
  scopeIds: string[] | null,
): HarvestSelectOption[] {
  return mapRowsToSelectOptions(filterFarmCatalogByScope(farms, scopeIds), "name");
}

export type ResolvedFarmUserScope = {
  scopeIds: string[] | null;
  scopeKey: string;
  farmUserMeta: string | undefined;
  canViewAllModule: boolean;
};

/** Pure resolver — parity Flutter `FarmUserScope.resolve`. */
export function resolveFarmUserScopeForUser(
  user: SessionUser | null | undefined,
  module: AppPermissionModule = "harvests",
  aclReady = true,
): ResolvedFarmUserScope {
  if (!user) {
    return {
      scopeIds: null,
      scopeKey: "",
      farmUserMeta: undefined,
      canViewAllModule: false,
    };
  }

  const farmUserMeta = farmUserMetaFromSessionUser(user);
  const scopeIdsFromMeta = parseFarmIdsFromMeta(farmUserMeta);

  if (scopeIdsFromMeta.length > 0) {
    if (aclReady && isSuperAdmin(user)) {
      return {
        scopeIds: null,
        scopeKey: "",
        farmUserMeta: undefined,
        canViewAllModule: true,
      };
    }
    return {
      scopeIds: scopeIdsFromMeta,
      scopeKey: scopeIdsFromMeta.join(","),
      farmUserMeta,
      canViewAllModule: false,
    };
  }

  if (!aclReady) {
    return {
      scopeIds: null,
      scopeKey: "",
      farmUserMeta: undefined,
      canViewAllModule: false,
    };
  }

  if (isSuperAdmin(user) || canViewAllModuleData(user, module)) {
    return {
      scopeIds: null,
      scopeKey: "",
      farmUserMeta: undefined,
      canViewAllModule: true,
    };
  }

  return {
    scopeIds: null,
    scopeKey: "",
    farmUserMeta: undefined,
    canViewAllModule: false,
  };
}

/** `farm_user_id` pass-through for harvest index API when server should enforce farm scope. */
export function resolveFarmUserMetaForApi(
  user: SessionUser | null | undefined,
  module: AppPermissionModule = "harvests",
  aclReady = true,
): string | undefined {
  const scope = resolveFarmUserScopeForUser(user, module, aclReady);
  if (scope.canViewAllModule) return undefined;
  return scope.farmUserMeta;
}

export function useFarmUserScope(module: AppPermissionModule = "harvests") {
  const user = useAuthUserStore((s) => s.user);
  const aclReady = useAuthUserStore((s) => s.aclReady);

  return useMemo(
    () => resolveFarmUserScopeForUser(user, module, aclReady),
    [aclReady, module, user],
  );
}

/** Zustand-backed scoped farm catalog for filter dropdowns. */
export function useScopedFarmSelectOptions(module: AppPermissionModule = "harvests") {
  const farms = useHarvestingDataStore((s) => s.farms);
  const { scopeIds } = useFarmUserScope(module);
  return useMemo(
    () => buildScopedFarmSelectOptions(farms, scopeIds),
    [farms, scopeIds],
  );
}
