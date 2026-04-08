"use client";

import RequireAuth from "@/features/auth/RequireAuth";
import { InventoryForecast } from "@/features/forecasting/InventoryForecast";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function ForecastingPage() {
  return (
    <RequireAuth>
      <DashboardLayout>
        <InventoryForecast />
      </DashboardLayout>
    </RequireAuth>
  );
}
