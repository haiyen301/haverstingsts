import { MAINTENANCE_EVICTION_COUNTDOWN_SEC } from "@/shared/config/maintenanceEvictionConfig";

/** Read by Next middleware during the eviction countdown window. */
export const MAINTENANCE_GRACE_COOKIE_NAME = "sts_maint_grace";

/** Forwarded to STSPortal so Bearer API calls still work during countdown. */
export const MAINTENANCE_GRACE_HEADER = "X-STS-Maintenance-Grace";

export function setMaintenanceGraceCookie(): void {
  if (typeof document === "undefined") return;
  const maxAge = MAINTENANCE_EVICTION_COUNTDOWN_SEC + 15;
  document.cookie = `${MAINTENANCE_GRACE_COOKIE_NAME}=1; path=/; max-age=${maxAge}; SameSite=Lax`;
}

export function clearMaintenanceGraceCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${MAINTENANCE_GRACE_COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
}
