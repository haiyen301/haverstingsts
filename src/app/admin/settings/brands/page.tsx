"use client";

import RequireAuth from "@/features/auth/RequireAuth";
import { BrandsSettingsTab } from "@/features/admin/ui/BrandsSettingsTab";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function AdminBrandsPage() {
  return (
    <RequireAuth>
      <DashboardLayout>
        <BrandsSettingsTab />
      </DashboardLayout>
    </RequireAuth>
  );
}
