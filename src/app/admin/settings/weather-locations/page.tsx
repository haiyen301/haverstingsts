"use client";

import RequireAuth from "@/features/auth/RequireAuth";
import { WeatherLocationsSettingsTab } from "@/features/admin/ui/WeatherLocationsSettingsTab";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function AdminWeatherLocationsPage() {
  return (
    <RequireAuth>
      <DashboardLayout>
        <WeatherLocationsSettingsTab />
      </DashboardLayout>
    </RequireAuth>
  );
}
