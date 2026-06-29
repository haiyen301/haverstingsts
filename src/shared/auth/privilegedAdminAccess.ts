/**
 * STS `users.id` allowed for privileged admin screens (maintenance, activity log,
 * alert settings, weather locations, …).
 * Change this list in one place only.
 */
export const PRIVILEGED_ADMIN_USER_IDS = [409] as const;

export const PRIVILEGED_ADMIN_USER_ID_SET = new Set<number>(PRIVILEGED_ADMIN_USER_IDS);

/** Normalize API/store user id (may be number, string, or missing). */
export function parsePrivilegedAdminUserId(raw: unknown): number | undefined {
  if (raw == null || raw === "") return undefined;
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

export function userIdIsPrivilegedAdmin(
  userId: number | string | undefined | null,
): boolean {
  const n = parsePrivilegedAdminUserId(userId);
  if (n == null) return false;
  return PRIVILEGED_ADMIN_USER_ID_SET.has(n);
}
