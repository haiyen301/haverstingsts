"use client";

import RequireAuth from "@/features/auth/RequireAuth";
import { HelpArticleForm } from "@/features/help/ui/HelpArticleForm";
import { HelpAdminShell } from "@/features/help/ui/HelpAdminShell";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function HelpAdminNewArticlePage() {
  return (
    <RequireAuth>
      <DashboardLayout>
        <HelpAdminShell>
          <HelpArticleForm />
        </HelpAdminShell>
      </DashboardLayout>
    </RequireAuth>
  );
}
