import type { ReactNode } from "react";
import { requireModuleAccessOr404 } from "@/shared/server/accessGuard";

export default async function AdminArchitectsLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireModuleAccessOr404("admin_architects");
  return <>{children}</>;
}
