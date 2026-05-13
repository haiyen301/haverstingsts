import type { ReactNode } from "react";
import { requireModuleAccessOr404 } from "@/shared/server/accessGuard";

export default async function AdminRegrowthLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireModuleAccessOr404("admin_regrowth");
  return <>{children}</>;
}
