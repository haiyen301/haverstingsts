import type { ReactNode } from "react";
import { requireModuleAccessOr404 } from "@/shared/server/accessGuard";

/** sts_items list under this route loads Active rows only — see `constants.ts`. */
export default async function AdminItemsLayout({ children }: { children: ReactNode }) {
  await requireModuleAccessOr404("admin_items");
  return <>{children}</>;
}
