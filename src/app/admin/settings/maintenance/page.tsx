"use client";

import RequireAuth from "@/features/auth/RequireAuth";
import { MaintenanceSettingsTab } from "@/features/admin/ui/MaintenanceSettingsTab";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function AdminMaintenanceSettingsPage() {
  return (
    <RequireAuth>
      <DashboardLayout>
        <MaintenanceSettingsTab />
      </DashboardLayout>
    </RequireAuth>
  );
}
