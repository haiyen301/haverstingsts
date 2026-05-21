"use client";

import RequireAuth from "@/features/auth/RequireAuth";
import { InventoryForecast } from "@/features/forecasting/inventoryForecastView";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function ForecastingPage() {
  return (
    <RequireAuth>
      <DashboardLayout>
        <main className="min-h-screen bg-gray-50">
          <InventoryForecast />
        </main>
      </DashboardLayout>
    </RequireAuth>
  );
}
