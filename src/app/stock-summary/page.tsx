"use client";

import RequireAuth from "@/features/auth/RequireAuth";
import { StockSummaryTab } from "@/features/warehouse/StockSummaryTab";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function StockSummaryPage() {
  return (
    <RequireAuth>
      <DashboardLayout>
        <StockSummaryTab />
      </DashboardLayout>
    </RequireAuth>
  );
}
