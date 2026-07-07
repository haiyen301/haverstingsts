/**
 * STS `users.id` allowed for privileged admin screens (maintenance, balance
 * updating, activity log, alert settings, weather locations, …).
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

export function userIdIsPrivilegedAdmin(userId: unknown): boolean {
  const n = parsePrivilegedAdminUserId(userId);
  if (n == null) return false;
  return PRIVILEGED_ADMIN_USER_ID_SET.has(n);
}

/** Sidebar `restrictToUserIds` — true when user id is in the allowed list. */
export function userIdInRestrictList(
  userId: unknown,
  allowedIds: readonly number[] | undefined,
): boolean {
  if (!allowedIds?.length) return true;
  const uid = parsePrivilegedAdminUserId(userId);
  if (uid == null) return false;
  return allowedIds.includes(uid);
}

/** Zone config rows created by privileged admins (409) are hidden from everyone else. */
export function zoneConfigIsPrivateOwner(createdBy: unknown): boolean {
  const ownerId = parsePrivilegedAdminUserId(createdBy);
  if (ownerId == null) return false;
  return userIdIsPrivilegedAdmin(ownerId);
}

export function zoneConfigRowVisibleToUser(
  row: { created_by?: number | string | null },
  viewerUserId: unknown,
): boolean {
  if (!zoneConfigIsPrivateOwner(row.created_by)) return true;
  return userIdIsPrivilegedAdmin(viewerUserId);
}
