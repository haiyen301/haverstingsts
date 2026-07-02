"use client";

import RequireAuth from "@/features/auth/RequireAuth";
import { UnitTypesSettingsTab } from "@/features/admin/ui/UnitTypesSettingsTab";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function AdminUnitTypesPage() {
  return (
    <RequireAuth>
      <DashboardLayout>
        <UnitTypesSettingsTab />
      </DashboardLayout>
    </RequireAuth>
  );
}
