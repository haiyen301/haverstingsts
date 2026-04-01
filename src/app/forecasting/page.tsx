"use client";

import RequireAuth from "@/features/auth/RequireAuth";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function ForecastingPage() {
  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="p-4 lg:p-8">
          <h1 className="text-2xl lg:text-3xl font-semibold text-gray-900 mb-2">Forecasting</h1>
          <p className="text-sm text-gray-600 mb-8">UI cloned from source package. Data logic will be integrated next.</p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white p-6 rounded-lg border border-gray-200">
              <p className="text-sm text-gray-600">Inventory Status</p>
              <p className="text-2xl font-semibold text-gray-900 mt-2">Coming Soon</p>
            </div>
            <div className="bg-white p-6 rounded-lg border border-gray-200">
              <p className="text-sm text-gray-600">6-Month Forecast</p>
              <p className="text-2xl font-semibold text-gray-900 mt-2">Coming Soon</p>
            </div>
            <div className="bg-white p-6 rounded-lg border border-gray-200">
              <p className="text-sm text-gray-600">Regrowth Timeline</p>
              <p className="text-2xl font-semibold text-gray-900 mt-2">Coming Soon</p>
            </div>
          </div>
        </div>
      </DashboardLayout>
    </RequireAuth>
  );
}
