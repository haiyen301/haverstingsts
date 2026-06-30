"use client";

import RequireAuth from "@/features/auth/RequireAuth";
import { HelpCategoriesTab } from "@/features/help/ui/HelpCategoriesTab";
import { HelpAdminShell } from "@/features/help/ui/HelpAdminShell";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function HelpAdminCategoriesPage() {
  return (
    <RequireAuth>
      <DashboardLayout>
        <HelpAdminShell>
          <HelpCategoriesTab />
        </HelpAdminShell>
      </DashboardLayout>
    </RequireAuth>
  );
}
