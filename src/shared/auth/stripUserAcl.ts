import type { SessionUser } from "@/shared/lib/sessionUser";

const ACL_KEYS = ["permissions", "is_admin", "role_id", "role_title"] as const;

/** Remove ACL fields so stale role/permissions are never kept from localStorage or login cache. */
export function stripUserAcl(user: SessionUser | null): SessionUser | null {
  if (!user) return null;
  const next = { ...user };
  for (const key of ACL_KEYS) {
    delete next[key];
  }
  return next;
}
