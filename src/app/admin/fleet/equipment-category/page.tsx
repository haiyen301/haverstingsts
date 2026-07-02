"use client";

import RequireAuth from "@/features/auth/RequireAuth";
import { FleetCategorySettingsTab } from "@/features/admin/ui/FleetCategorySettingsTab";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function AdminEquipmentCategoryPage() {
  return (
    <RequireAuth>
      <DashboardLayout>
        <FleetCategorySettingsTab />
      </DashboardLayout>
    </RequireAuth>
  );
}
