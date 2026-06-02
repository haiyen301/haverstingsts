import type { ReactNode } from "react";
import { requireModuleAccessOr404 } from "@/shared/server/accessGuard";

export default async function AdminProjectPacesLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireModuleAccessOr404("admin_project_paces");
  return <>{children}</>;
}
