"use client";

import RequireAuth from "@/features/auth/RequireAuth";
import { HelpArticleView } from "@/features/help/ui/HelpArticleView";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function HelpArticlePage() {
  return (
    <RequireAuth>
      <DashboardLayout>
        <HelpArticleView />
      </DashboardLayout>
    </RequireAuth>
  );
}
