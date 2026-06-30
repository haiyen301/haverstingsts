"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BookOpen, FolderOpen, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "react-toastify";

import {
  fetchCanManageHelp,
  fetchHelpCategories,
  fetchHelpSuggestions,
  type HelpCategoryRow,
  type HelpSuggestion,
} from "@/features/help/api/helpApi";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";

const inputClass =
  "flex h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";

export function HelpBrowseHome() {
  const t = useTranslations("Help");
  const router = useRouter();
  const [categories, setCategories] = useState<HelpCategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [canManage, setCanManage] = useState(false);
  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState<HelpSuggestion[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cats, manage] = await Promise.all([
        fetchHelpCategories("help"),
        fetchCanManageHelp().catch(() => false),
      ]);
      setCategories(cats);
      setCanManage(manage);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.load"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!search.trim()) {
      setSuggestions([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void fetchHelpSuggestions(search.trim())
        .then(setSuggestions)
        .catch(() => setSuggestions([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 p-4 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Link
              href="/help/admin/articles"
              className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Pencil className="h-4 w-4" />
              {t("manageArticles")}
            </Link>
            <Link
              href="/help/admin/categories"
              className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-muted/80"
            >
              <FolderOpen className="h-4 w-4" />
              {t("manageCategories")}
            </Link>
          </div>
        ) : null}
      </div>

      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          className={cn(inputClass, "pl-9")}
          placeholder={t("searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {suggestions.length > 0 ? (
          <div className="absolute z-20 mt-1 w-full rounded-md border border-input bg-popover shadow-md">
            {suggestions.map((s) => (
              <button
                key={s.value}
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => router.push(`/help/article/${s.value}`)}
              >
                <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                {s.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : categories.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noCategories")}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((cat) => (
            <Link key={cat.id} href={`/help/category/${cat.id}`}>
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardContent className="space-y-2 p-5">
                  <h2 className="text-lg font-semibold text-foreground">{cat.title}</h2>
                  {cat.description ? (
                    <div
                      className="line-clamp-3 text-sm text-muted-foreground prose prose-sm max-w-none dark:prose-invert"
                      dangerouslySetInnerHTML={{ __html: cat.description }}
                    />
                  ) : null}
                  <p className="text-xs font-medium text-primary">
                    {cat.total_articles ?? 0} {t("articles")}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
