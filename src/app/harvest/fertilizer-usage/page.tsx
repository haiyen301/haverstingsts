"use client";

import RequireAuth from "@/features/auth/RequireAuth";
import { FertilizerUsageTab } from "@/features/fertilizer/FertilizerUsageTab";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function FertilizerUsagePage() {
  return (
    <RequireAuth>
      <DashboardLayout>
        <FertilizerUsageTab />
      </DashboardLayout>
    </RequireAuth>
  );
}
