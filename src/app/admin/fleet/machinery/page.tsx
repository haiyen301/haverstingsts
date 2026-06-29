"use client";

import RequireAuth from "@/features/auth/RequireAuth";
import { MachinerySettingsTab } from "@/features/admin/ui/MachinerySettingsTab";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function AdminMachineryPage() {
  return (
    <RequireAuth>
      <DashboardLayout>
        <MachinerySettingsTab />
      </DashboardLayout>
    </RequireAuth>
  );
}
