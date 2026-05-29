import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { userIdIsPrivilegedAdmin } from "@/shared/auth/privilegedAdminAccess";
import { AUTH_COOKIE_NAME } from "@/shared/lib/authCookie";
import { fetchTrustedAclByToken } from "@/shared/server/trustedAcl";

export default async function AdminAlertSettingsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const token = (await cookies()).get(AUTH_COOKIE_NAME)?.value?.trim();
  if (!token) {
    redirect("/");
  }
  const acl = await fetchTrustedAclByToken(token);
  if (!userIdIsPrivilegedAdmin(acl?.userId)) {
    redirect("/admin/people");
  }
  return <>{children}</>;
}
