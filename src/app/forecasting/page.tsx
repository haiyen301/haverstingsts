"use client";

import { useState } from "react";

import RequireAuth from "@/features/auth/RequireAuth";

import { InventoryForecast } from "@/features/forecasting/inventoryForecastView";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import type { KpiDeliveryDateFilter } from "@/shared/lib/dashboardKpiProjectFilters";

export default function ForecastingPage() {
  const [forecastDateFilter, setForecastDateFilter] = useState<KpiDeliveryDateFilter>({
    preset: "next3Months",
  });

  return (
    <RequireAuth>
      <DashboardLayout>
        <main className="min-h-screen bg-gray-50">
          <div className="mx-auto w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8">
            <InventoryForecast
              forecastDateFilter={forecastDateFilter}
              onForecastDateFilterChange={setForecastDateFilter}
            />
          </div>
        </main>
      </DashboardLayout>
    </RequireAuth>
  );
}
