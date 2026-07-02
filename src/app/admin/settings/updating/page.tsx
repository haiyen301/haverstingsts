"use client";

import RequireAuth from "@/features/auth/RequireAuth";
import { UpdatingSettingsTab } from "@/features/admin/ui/UpdatingSettingsTab";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function AdminUpdatingSettingsPage() {
  return (
    <RequireAuth>
      <DashboardLayout>
        <UpdatingSettingsTab />
      </DashboardLayout>
    </RequireAuth>
  );
}
