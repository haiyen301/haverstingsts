import { DEFAULT_MAINTENANCE_EVICTION_COUNTDOWN_SEC } from "@/shared/config/maintenanceEvictionConfig";

/** Normalize server/client maintenance eviction countdown (5–120 seconds). */
export function normalizeMaintenanceEvictionCountdownSec(
  raw: unknown,
): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_MAINTENANCE_EVICTION_COUNTDOWN_SEC;
  return Math.min(120, Math.max(5, Math.round(n)));
}
