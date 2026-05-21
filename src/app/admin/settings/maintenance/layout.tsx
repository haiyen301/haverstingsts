import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { userIdMayBypassMaintenance } from "@/shared/auth/maintenanceAccess";
import { AUTH_COOKIE_NAME } from "@/shared/lib/authCookie";
import { fetchTrustedAclByToken } from "@/shared/server/trustedAcl";

export default async function AdminMaintenanceSettingsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const token = (await cookies()).get(AUTH_COOKIE_NAME)?.value?.trim();
  if (!token) {
    redirect("/");
  }
  const acl = await fetchTrustedAclByToken(token);
  if (!userIdMayBypassMaintenance(acl?.userId)) {
    redirect("/admin/settings/countries");
  }
  return <>{children}</>;
}
