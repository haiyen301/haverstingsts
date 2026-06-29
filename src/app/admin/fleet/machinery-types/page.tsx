"use client";

import RequireAuth from "@/features/auth/RequireAuth";
import { MachineryTypesTab } from "@/features/admin/ui/MachineryTypesTab";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function AdminMachineryTypesPage() {
  return (
    <RequireAuth>
      <DashboardLayout>
        <MachineryTypesTab />
      </DashboardLayout>
    </RequireAuth>
  );
}
