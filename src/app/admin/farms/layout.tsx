import type { ReactNode } from "react";
import { requireModuleAccessOr404 } from "@/shared/server/accessGuard";

export default async function AdminFarmsLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireModuleAccessOr404("admin_farms");
  return <>{children}</>;
}
