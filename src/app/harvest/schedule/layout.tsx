import type { ReactNode } from "react";
import { requireModuleAccessOr404 } from "@/shared/server/accessGuard";

export default async function HarvestScheduleLayoutGuard({
  children,
}: {
  children: ReactNode;
}) {
  await requireModuleAccessOr404("harvest_schedule");
  return <>{children}</>;
}
