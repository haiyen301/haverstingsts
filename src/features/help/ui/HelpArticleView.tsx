"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { toast } from "react-toastify";

import {
  fetchHelpArticle,
  incrementHelpArticleView,
  type HelpArticleRow,
} from "@/features/help/api/helpApi";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";

import "@/components/tiptap/tiptap.css";

export function HelpArticleView() {
  const t = useTranslations("Help");
  const params = useParams();
  const articleId = Number(params?.id);
  const [article, setArticle] = useState<HelpArticleRow | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!Number.isFinite(articleId) || articleId <= 0) return;
    setLoading(true);
    try {
      const data = await fetchHelpArticle(articleId);
      setArticle(data);
      void incrementHelpArticleView(articleId).catch(() => undefined);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.load"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
    } finally {
      setLoading(false);
    }
  }, [articleId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="mx-auto w-full p-4 lg:p-8">
        <div className="rounded-lg border border-border bg-white p-6 shadow-sm dark:bg-card">
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        </div>
      </div>
    );
  }

  if (!article) {
    return (
      <div className="mx-auto w-full p-4 lg:p-8">
        <div className="rounded-lg border border-border bg-white p-6 shadow-sm dark:bg-card">
          <p className="text-sm text-muted-foreground">{t("notFound")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full p-4 lg:p-8">
      <div className="space-y-6 rounded-lg border border-border bg-white p-6 shadow-sm dark:bg-card lg:p-8">
      <Link
        href={article.category_id ? `/help/category/${article.category_id}` : "/help"}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {article.category_title ?? t("backToHelp")}
      </Link>

      <article className="space-y-4">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">{article.title}</h1>
          {article.total_views != null ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("views", { count: article.total_views })}
            </p>
          ) : null}
        </header>
        <div
          className="help-rich-content prose prose-sm max-w-none dark:prose-invert"
          dangerouslySetInnerHTML={{ __html: article.description ?? "" }}
        />
      </article>
      </div>
    </div>
  );
}
