"use client";

import RequireAuth from "@/features/auth/RequireAuth";
import { HelpArticlesTab } from "@/features/help/ui/HelpArticlesTab";
import { HelpAdminShell } from "@/features/help/ui/HelpAdminShell";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function HelpAdminArticlesPage() {
  return (
    <RequireAuth>
      <DashboardLayout>
        <HelpAdminShell>
          <HelpArticlesTab />
        </HelpAdminShell>
      </DashboardLayout>
    </RequireAuth>
  );
}
