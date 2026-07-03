"use client";

import RequireAuth from "@/features/auth/RequireAuth";
import { ItemsImportTab } from "@/features/admin/ui/ItemsImportTab";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function AdminItemsImportPage() {
  return (
    <RequireAuth>
      <DashboardLayout>
        <ItemsImportTab />
      </DashboardLayout>
    </RequireAuth>
  );
}
