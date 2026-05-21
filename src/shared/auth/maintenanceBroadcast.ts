export const MAINTENANCE_BROADCAST_CHANNEL = "sts-maintenance-v1";

export function broadcastMaintenanceConfigChanged(): void {
  if (typeof BroadcastChannel === "undefined") return;
  const ch = new BroadcastChannel(MAINTENANCE_BROADCAST_CHANNEL);
  ch.postMessage({ type: "config-changed", at: Date.now() });
  ch.close();
}

export function subscribeMaintenanceConfigChanged(
  onChanged: () => void,
): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const ch = new BroadcastChannel(MAINTENANCE_BROADCAST_CHANNEL);
  ch.onmessage = () => onChanged();
  return () => ch.close();
}
