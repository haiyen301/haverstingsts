"use client";

import RequireAuth from "@/features/auth/RequireAuth";
import { HelpBrowseHome } from "@/features/help/ui/HelpBrowseHome";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function HelpPage() {
  return (
    <RequireAuth>
      <DashboardLayout>
        <HelpBrowseHome />
      </DashboardLayout>
    </RequireAuth>
  );
}
