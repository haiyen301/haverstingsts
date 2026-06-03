"use client";

import { useState } from "react";

import RequireAuth from "@/features/auth/RequireAuth";

import type { ForecastHorizonMonths } from "@/features/forecasting/ForecastHorizonStrip";
import { InventoryForecast } from "@/features/forecasting/inventoryForecastView";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function ForecastingPage() {
  const [forecastMonths, setForecastMonths] = useState<ForecastHorizonMonths>(3);

  return (
    <RequireAuth>
      <DashboardLayout>
        <main className="min-h-screen bg-gray-50">
          <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
            <InventoryForecast
              forecastMonths={forecastMonths}
              onForecastMonthsChange={setForecastMonths}
            />
          </div>
        </main>
      </DashboardLayout>
    </RequireAuth>
  );
}
