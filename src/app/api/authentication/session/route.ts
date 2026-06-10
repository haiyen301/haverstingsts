import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { buildAclSnapshotFromProfile } from "@/shared/auth/permissions";
import { parsePrivilegedAdminUserId } from "@/shared/auth/privilegedAdminAccess";
import {
  AUTH_ACL_COOKIE_NAME,
  AUTH_COOKIE_NAME,
  AUTH_USER_ID_COOKIE_NAME,
} from "@/shared/lib/authCookie";
import { AUTH_COOKIE_OPTIONS } from "@/shared/server/stsAuthBearer";
import {
  fetchCurrentUserProfileByToken,
  fetchTrustedAclByToken,
} from "@/shared/server/trustedAcl";

export async function GET() {
  const token = (await cookies()).get(AUTH_COOKIE_NAME)?.value?.trim();
  if (!token) {
    return NextResponse.json({ authenticated: false, userId: null, user: null });
  }

  const [profile, acl] = await Promise.all([
    fetchCurrentUserProfileByToken(token),
    fetchTrustedAclByToken(token),
  ]);
  if (!profile || !acl) {
    return NextResponse.json({ authenticated: false, userId: null, user: null });
  }

  const userId = parsePrivilegedAdminUserId(acl.userId) ?? null;

  const aclSnapshot = buildAclSnapshotFromProfile(profile);

  const profilePermissions =
    profile &&
    typeof profile === "object" &&
    "permissions" in profile &&
    profile.permissions &&
    typeof profile.permissions === "object" &&
    !Array.isArray(profile.permissions)
      ? (profile.permissions as Record<string, unknown>)
      : {};

  const res = NextResponse.json({
    authenticated: true,
    userId,
    user: {
      ...profile,
      role_id: (profile as Record<string, unknown>).role_id,
      role_title: (profile as Record<string, unknown>).role_title,
      permissions: { ...profilePermissions, ...acl.permissions },
      is_admin: acl.is_admin,
    },
  });
  res.cookies.set(AUTH_ACL_COOKIE_NAME, JSON.stringify(aclSnapshot), AUTH_COOKIE_OPTIONS);
  if (userId != null) {
    res.cookies.set(AUTH_USER_ID_COOKIE_NAME, String(userId), AUTH_COOKIE_OPTIONS);
  }

  return res;
}
