import type { ReactNode } from "react";
import { requireModuleAccessOr404 } from "@/shared/server/accessGuard";

export default async function ForecastingLayoutGuard({
  children,
}: {
  children: ReactNode;
}) {
  await requireModuleAccessOr404("forecasting");
  return <>{children}</>;
}
