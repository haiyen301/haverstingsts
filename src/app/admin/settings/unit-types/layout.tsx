import type { ReactNode } from "react";
import { requireModuleAccessOr404 } from "@/shared/server/accessGuard";

export default async function AdminUnitTypesLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireModuleAccessOr404("admin_units");
  return <>{children}</>;
}
