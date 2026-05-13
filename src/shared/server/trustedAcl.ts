import { buildAclSnapshotFromProfile } from "@/shared/auth/permissions";
import { getStsApiUrlCandidates } from "@/shared/api/stsLogin";
import { fetchJsonWithBaseUrlFallback } from "@/shared/server/stsUpstreamFetch";

const CURRENT_USER_API_PATH = "/api/base/react_get_current_logged_in_user";

export type TrustedAclResult = {
  is_admin: boolean;
  permissions: Record<string, unknown>;
  /** STS `users.id` when present on the profile payload. */
  userId?: number;
};

function parseUserIdFromProfile(profile: unknown): number | undefined {
  if (!profile || typeof profile !== "object") return undefined;
  const o = profile as Record<string, unknown>;
  const n = Number(o.id ?? o.user_id ?? o.userId);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export async function fetchTrustedAclByToken(
  token: string,
): Promise<TrustedAclResult | null> {
  const candidates = getStsApiUrlCandidates(CURRENT_USER_API_PATH);
  const upstream = await fetchJsonWithBaseUrlFallback(candidates, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  if (!upstream.ok) return null;

  const payload = upstream.data;
  if (!payload || typeof payload !== "object") return null;
  const root = payload as { success?: boolean; data?: unknown };
  if (root.success !== true) return null;

  const acl = buildAclSnapshotFromProfile(root.data);
  return {
    is_admin: acl.is_admin,
    permissions: acl.permissions as Record<string, unknown>,
    userId: parseUserIdFromProfile(root.data),
  };
}
