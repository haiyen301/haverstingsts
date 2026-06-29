"use client";

import RequireAuth from "@/features/auth/RequireAuth";
import { ItemsSettingsTab } from "@/features/admin/ui/ItemsSettingsTab";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function AdminItemsPage() {
  return (
    <RequireAuth>
      <DashboardLayout>
        <ItemsSettingsTab />
      </DashboardLayout>
    </RequireAuth>
  );
}
