"use client";

import { useCallback, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { MaintenanceEvictionOverlay } from "@/features/system/ui/MaintenanceEvictionOverlay";
import { fetchMaintenanceStatus } from "@/features/admin/api/maintenanceApi";
import {
  parseMaintenanceUserId,
  userIdMayBypassMaintenance,
} from "@/shared/auth/maintenanceAccess";
import { subscribeMaintenanceConfigChanged } from "@/shared/auth/maintenanceBroadcast";
import { setMaintenanceGraceCookie } from "@/shared/auth/maintenanceGraceCookie";
import {
  disableMaintenancePolling,
  enableMaintenancePolling,
  isMaintenancePollingDisabled,
} from "@/shared/auth/maintenancePollControl";
import { saveMaintenanceReturnPath } from "@/shared/auth/maintenanceReturnPath";
import { MAINTENANCE_STATUS_POLL_MS } from "@/shared/config/maintenanceEvictionConfig";
import { fetchSessionStatus } from "@/shared/lib/sessionUser";
import { useMaintenanceEvictionStore } from "@/shared/store/maintenanceEvictionStore";
import { useAuthUserStore } from "@/shared/store/authUserStore";

const EXEMPT_PATHS = new Set(["/maintenance", "/"]);

function shouldEnforceMaintenance(pathname: string): boolean {
  if (EXEMPT_PATHS.has(pathname)) return false;
  if (pathname.startsWith("/api/authentication")) return false;
  return true;
}

function currentPath(pathname: string, searchParams: URLSearchParams): string {
  const q = searchParams.toString();
  return pathname + (q ? `?${q}` : "");
}

/**
 * Polls maintenance status for logged-in non-bypass users.
 * Shows corner countdown when maintenance turns on (no refresh required).
 */
export function MaintenanceGate() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const user = useAuthUserStore((s) => s.user);
  const startEviction = useMaintenanceEvictionStore((s) => s.startEviction);
  const evicting = useMaintenanceEvictionStore((s) => s.evicting);
  const resolveUserId = useCallback(async (): Promise<number | undefined> => {
    const fromStore = parseMaintenanceUserId(user?.id);
    if (fromStore != null) return fromStore;

    const session = await fetchSessionStatus();
    if (!session.authenticated) return undefined;
    return session.userId;
  }, [user?.id]);

  const beginEviction = useCallback(() => {
    if (useMaintenanceEvictionStore.getState().evicting) return;
    saveMaintenanceReturnPath(currentPath(pathname, searchParams));
    setMaintenanceGraceCookie();
    disableMaintenancePolling("evicted");
    startEviction();
  }, [pathname, searchParams, startEviction]);

  useEffect(() => {
    if (!evicting || !shouldEnforceMaintenance(pathname)) return;
    saveMaintenanceReturnPath(currentPath(pathname, searchParams));
  }, [evicting, pathname, searchParams]);

  useEffect(() => {
    if (!shouldEnforceMaintenance(pathname)) return;
    if (isMaintenancePollingDisabled()) return;

    const storeUserId = parseMaintenanceUserId(user?.id);
    if (userIdMayBypassMaintenance(storeUserId)) {
      disableMaintenancePolling("bypass");
      return;
    }

    let cancelled = false;

    const check = async () => {
      if (cancelled || useMaintenanceEvictionStore.getState().evicting) return;
      if (isMaintenancePollingDisabled()) return;

      try {
        const status = await fetchMaintenanceStatus();
        if (!status.enabled) return;

        const userId = await resolveUserId();

        if (userId == null) {
          const session = await fetchSessionStatus();
          if (session.authenticated) return;
          return;
        }

        if (userIdMayBypassMaintenance(userId)) {
          disableMaintenancePolling("bypass");
          return;
        }

        if (!useMaintenanceEvictionStore.getState().evicting) {
          beginEviction();
        }
      } catch {
        /* ignore transient network errors */
      }
    };

    void check();
    const intervalId = window.setInterval(() => void check(), MAINTENANCE_STATUS_POLL_MS);
    const unsubBroadcast = subscribeMaintenanceConfigChanged(() => {
      enableMaintenancePolling();
      void check();
    });
    const onVis = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("visibilitychange", onVis);
      unsubBroadcast();
    };
  }, [pathname, resolveUserId, beginEviction, user?.id, searchParams]);

  return <MaintenanceEvictionOverlay />;
}
