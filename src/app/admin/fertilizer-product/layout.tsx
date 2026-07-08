import type { ReactNode } from "react";
import { requireModuleAccessOr404 } from "@/shared/server/accessGuard";

export default async function AdminFertilizerProductLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireModuleAccessOr404("admin_fertilizer_product");
  return <>{children}</>;
}
