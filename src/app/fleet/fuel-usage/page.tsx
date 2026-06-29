"use client";

import RequireAuth from "@/features/auth/RequireAuth";
import { FuelUsageTab } from "@/features/fleet/FuelUsageTab";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function FuelUsagePage() {
  return (
    <RequireAuth>
      <DashboardLayout>
        <FuelUsageTab />
      </DashboardLayout>
    </RequireAuth>
  );
}
