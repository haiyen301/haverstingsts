const SESSION_KEY = "sts_maintenance_poll_disabled";

export type MaintenancePollDisableReason = "evicted" | "bypass";

/** Stop client-side maintenance status polling for this tab session. */
export function disableMaintenancePolling(
  _reason: MaintenancePollDisableReason,
): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    /* ignore */
  }
}

/** Re-enable polling after a fresh login (e.g. user may no longer be evicted). */
export function enableMaintenancePolling(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function isMaintenancePollingDisabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}
