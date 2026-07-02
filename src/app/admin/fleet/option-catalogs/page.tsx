"use client";

import RequireAuth from "@/features/auth/RequireAuth";
import { FleetOptionCatalogsTab } from "@/features/admin/ui/FleetOptionCatalogsTab";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function AdminFleetOptionCatalogsPage() {
  return (
    <RequireAuth>
      <DashboardLayout>
        <FleetOptionCatalogsTab />
      </DashboardLayout>
    </RequireAuth>
  );
}
