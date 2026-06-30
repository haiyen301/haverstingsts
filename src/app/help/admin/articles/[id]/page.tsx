"use client";

import { use } from "react";

import RequireAuth from "@/features/auth/RequireAuth";
import { HelpArticleForm } from "@/features/help/ui/HelpArticleForm";
import { HelpAdminShell } from "@/features/help/ui/HelpAdminShell";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function HelpAdminEditArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const articleId = Number(id);

  return (
    <RequireAuth>
      <DashboardLayout>
        <HelpAdminShell>
          <HelpArticleForm articleId={Number.isFinite(articleId) ? articleId : undefined} />
        </HelpAdminShell>
      </DashboardLayout>
    </RequireAuth>
  );
}
