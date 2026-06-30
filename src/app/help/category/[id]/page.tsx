"use client";

import RequireAuth from "@/features/auth/RequireAuth";
import { HelpCategoryView } from "@/features/help/ui/HelpCategoryView";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function HelpCategoryPage() {
  return (
    <RequireAuth>
      <DashboardLayout>
        <HelpCategoryView />
      </DashboardLayout>
    </RequireAuth>
  );
}
