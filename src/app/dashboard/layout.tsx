import type { ReactNode } from "react";
import { getModuleAccess } from "@/shared/server/accessGuard";
import { BlankPage } from "@/shared/ui/BlankPage";

export default async function DashboardLayoutGuard({
  children,
}: {
  children: ReactNode;
}) {
 
  const access = await getModuleAccess("dashboard");
  
  if (!access.create && !access.edit && !access.delete) {
    return <BlankPage title="Dashboard" />;
  }

  return <>{children}</>;
}
