export const ALERTS_UPDATED_EVENT = "stsrenew:alerts-updated";

export function emitAlertsUpdated(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ALERTS_UPDATED_EVENT));
}
