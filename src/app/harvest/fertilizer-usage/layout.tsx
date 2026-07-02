import type { ReactNode } from "react";
import { requireModuleAccessOr404 } from "@/shared/server/accessGuard";

export default async function FertilizerUsageLayoutGuard({
  children,
}: {
  children: ReactNode;
}) {
  await requireModuleAccessOr404("fertilizer_usage");
  return <>{children}</>;
}
