"use client";

import RequireAuth from "@/features/auth/RequireAuth";
import { ProjectTypesCatalogTab } from "@/features/admin/ui/ProjectTypesCatalogTab";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function AdminProjectTypesPage() {
  return (
    <RequireAuth>
      <DashboardLayout>
        <ProjectTypesCatalogTab />
      </DashboardLayout>
    </RequireAuth>
  );
}
