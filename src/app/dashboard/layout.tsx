import type { ReactNode } from "react";
import { getModuleAccess } from "@/shared/server/accessGuard";
import { BlankPage } from "@/shared/ui/BlankPage";

export default async function DashboardLayoutGuard({
  children,
}: {
  children: ReactNode;
}) {
 
  const access = await getModuleAccess("dashboard");
  const canViewDashboard = access.viewAllData;
  if (!canViewDashboard) {
    return (
      <>
        <BlankPage title="Dashboard" />
      </>
    );
  }

  return (
    <>
      {children}
    </>
  );
}
