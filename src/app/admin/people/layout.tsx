import type { ReactNode } from "react";
import { requireModuleAccessOr404 } from "@/shared/server/accessGuard";

export default async function AdminPeopleLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireModuleAccessOr404("admin_people");
  return <>{children}</>;
}
