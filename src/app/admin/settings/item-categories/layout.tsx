import type { ReactNode } from "react";
import { requireModuleAccessOr404 } from "@/shared/server/accessGuard";

export default async function AdminItemCategoriesLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireModuleAccessOr404("admin_item_categories");
  return <>{children}</>;
}
