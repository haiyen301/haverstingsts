import type { ReactNode } from "react";
import { requireModuleAccessOr404 } from "@/shared/server/accessGuard";

export default async function FuelUsageLayoutGuard({
  children,
}: {
  children: ReactNode;
}) {
  await requireModuleAccessOr404("fuel_usage");
  return <>{children}</>;
}
