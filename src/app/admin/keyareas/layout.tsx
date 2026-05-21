import type { ReactNode } from "react";
import { requireModuleAccessOr404 } from "@/shared/server/accessGuard";

export default async function AdminKeyAreasLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireModuleAccessOr404("admin_key_areas");
  return <>{children}</>;
}
