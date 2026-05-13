"use client";

import RequireAuth from "@/features/auth/RequireAuth";
import { ArchitectCatalogTab } from "@/features/admin/ui/ArchitectCatalogTab";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function AdminArchitectsPage() {
  return (
    <RequireAuth>
      <DashboardLayout>
        <ArchitectCatalogTab />
      </DashboardLayout>
    </RequireAuth>
  );
}
