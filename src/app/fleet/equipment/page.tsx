"use client";

import RequireAuth from "@/features/auth/RequireAuth";
import { EquipmentTab } from "@/features/fleet/EquipmentTab";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function EquipmentPage() {
  return (
    <RequireAuth>
      <DashboardLayout>
        <EquipmentTab />
      </DashboardLayout>
    </RequireAuth>
  );
}
