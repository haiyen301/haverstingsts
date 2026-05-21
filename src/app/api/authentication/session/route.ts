import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { parseMaintenanceUserId } from "@/shared/auth/maintenanceAccess";
import {
  AUTH_COOKIE_NAME,
  AUTH_USER_ID_COOKIE_NAME,
} from "@/shared/lib/authCookie";
import { AUTH_COOKIE_OPTIONS } from "@/shared/server/stsAuthBearer";
import { fetchTrustedAclByToken } from "@/shared/server/trustedAcl";

export async function GET() {
  const token = (await cookies()).get(AUTH_COOKIE_NAME)?.value?.trim();
  if (!token) {
    return NextResponse.json({ authenticated: false, userId: null });
  }

  const acl = await fetchTrustedAclByToken(token);
  const userId = parseMaintenanceUserId(acl?.userId) ?? null;

  const res = NextResponse.json({
    authenticated: true,
    userId,
  });

  if (userId != null) {
    res.cookies.set(AUTH_USER_ID_COOKIE_NAME, String(userId), AUTH_COOKIE_OPTIONS);
  }

  return res;
}
