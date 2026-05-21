/** STS `users.id` allowed to use the app while maintenance mode is on. */
export const MAINTENANCE_BYPASS_USER_IDS = new Set<number>([409]);

/** Normalize API/store user id (may be number, string, or missing). */
export function parseMaintenanceUserId(raw: unknown): number | undefined {
  if (raw == null || raw === "") return undefined;
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

export function userIdMayBypassMaintenance(
  userId: number | string | undefined | null,
): boolean {
  const n = parseMaintenanceUserId(userId);
  if (n == null) return false;
  return MAINTENANCE_BYPASS_USER_IDS.has(n);
}
