"use client";

import RequireAuth from "@/features/auth/RequireAuth";
import { EquipmentCategoryTab } from "@/features/admin/ui/EquipmentCategoryTab";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function AdminEquipmentCategoryPage() {
  return (
    <RequireAuth>
      <DashboardLayout>
        <EquipmentCategoryTab />
      </DashboardLayout>
    </RequireAuth>
  );
}
