"use client";

import RequireAuth from "@/features/auth/RequireAuth";
import { ActivityLogSettingsTab } from "@/features/admin/ui/ActivityLogSettingsTab";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function AdminActivityLogPage() {
  return (
    <RequireAuth>
      <DashboardLayout>
        <ActivityLogSettingsTab />
      </DashboardLayout>
    </RequireAuth>
  );
}
