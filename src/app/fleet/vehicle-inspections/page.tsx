"use client";

import RequireAuth from "@/features/auth/RequireAuth";
import { VehicleInspectionsTab } from "@/features/fleet/VehicleInspectionsTab";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function VehicleInspectionsPage() {
  return (
    <RequireAuth>
      <DashboardLayout>
        <VehicleInspectionsTab />
      </DashboardLayout>
    </RequireAuth>
  );
}
