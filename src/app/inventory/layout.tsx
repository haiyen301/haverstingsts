import type { ReactNode } from "react";
import { requireModuleAccessOr404 } from "@/shared/server/accessGuard";

export default async function InventoryLayoutGuard({
  children,
}: {
  children: ReactNode;
}) {
  await requireModuleAccessOr404("inventory");
  return <>{children}</>;
}
