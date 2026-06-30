"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, FileText } from "lucide-react";
import { toast } from "react-toastify";

import {
  fetchHelpCategoryDetail,
  type HelpCategoryRow,
} from "@/features/help/api/helpApi";
import { Card, CardContent } from "@/components/ui/card";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";

export function HelpCategoryView() {
  const t = useTranslations("Help");
  const params = useParams();
  const categoryId = Number(params?.id);
  const [category, setCategory] = useState<HelpCategoryRow | null>(null);
  const [articles, setArticles] = useState<{ id: number; title: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!Number.isFinite(categoryId) || categoryId <= 0) return;
    setLoading(true);
    try {
      const data = await fetchHelpCategoryDetail(categoryId);
      setCategory(data.category);
      setArticles(data.articles);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.load"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
    } finally {
      setLoading(false);
    }
  }, [categoryId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  }

  if (!category) {
    return <p className="text-sm text-muted-foreground">{t("notFound")}</p>;
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 lg:p-8">
      <Link
        href="/help"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("backToHelp")}
      </Link>

      <div>
        <h1 className="text-2xl font-semibold text-foreground">{category.title}</h1>
        {category.description ? (
          <div
            className="mt-2 text-sm text-muted-foreground prose prose-sm max-w-none dark:prose-invert"
            dangerouslySetInnerHTML={{ __html: category.description }}
          />
        ) : null}
      </div>

      {articles.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noArticles")}</p>
      ) : (
        <div className="space-y-2">
          {articles.map((article) => (
            <Link key={article.id} href={`/help/article/${article.id}`}>
              <Card className="transition-shadow hover:shadow-sm">
                <CardContent className="flex items-center gap-3 p-4">
                  <FileText className="h-5 w-5 shrink-0 text-primary" />
                  <span className="font-medium text-foreground">{article.title}</span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
