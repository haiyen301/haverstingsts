"use client";

import RequireAuth from "@/features/auth/RequireAuth";
import { ItemCategoriesSettingsTab } from "@/features/admin/ui/ItemCategoriesSettingsTab";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function AdminItemCategoriesPage() {
  return (
    <RequireAuth>
      <DashboardLayout>
        <ItemCategoriesSettingsTab />
      </DashboardLayout>
    </RequireAuth>
  );
}
