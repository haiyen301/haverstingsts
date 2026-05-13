"use client";

import RequireAuth from "@/features/auth/RequireAuth";
import { AlertFeedSettingsView } from "@/features/alerts/admin/AlertFeedSettingsView";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function AdminAlertSettingsPage() {
  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="space-y-6 p-4 lg:p-8">
          <AlertFeedSettingsView />
        </div>
      </DashboardLayout>
    </RequireAuth>
  );
}
