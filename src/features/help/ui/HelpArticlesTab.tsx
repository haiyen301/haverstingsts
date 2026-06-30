"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "react-toastify";

import {
  fetchHelpArticles,
  fetchHelpCategories,
  removeHelpArticle,
  type HelpArticleRow,
  type HelpCategoryRow,
} from "@/features/help/api/helpApi";
import { Card, CardContent } from "@/components/ui/card";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";

const selectClass =
  "h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm";
const btnPrimary =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90";
const btnGhost =
  "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted disabled:opacity-50";

export function HelpArticlesTab() {
  const t = useTranslations("HelpAdmin");
  const [rows, setRows] = useState<HelpArticleRow[]>([]);
  const [categories, setCategories] = useState<HelpCategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState("all");

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const params: { type: "help"; category_id?: number } = { type: "help" };
      if (categoryFilter !== "all") {
        const id = Number(categoryFilter);
        if (Number.isFinite(id) && id > 0) params.category_id = id;
      }
      const [articles, cats] = await Promise.all([
        fetchHelpArticles(params),
        fetchHelpCategories("help", true),
      ]);
      setRows(articles);
      setCategories(cats);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.load"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, t]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const categoryOptions = useMemo(
    () => categories.map((c) => ({ id: c.id, title: c.title })),
    [categories],
  );

  const handleDelete = async (id: number) => {
    if (!window.confirm(t("confirmDeleteArticle"))) return;
    try {
      await removeHelpArticle(id);
      toast.success(t("deleted"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      await loadRows();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.delete"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{t("articlesTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("articlesSubtitle")}</p>
        </div>
        <Link href="/help/admin/articles/new" className={btnPrimary}>
          <Plus className="h-4 w-4" />
          {t("addArticle")}
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-muted-foreground">{t("filterCategory")}</label>
        <select
          className={selectClass}
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="all">{t("allCategories")}</option>
          {categoryOptions.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {c.title}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">{t("colTitle")}</th>
                  <th className="px-4 py-3 font-medium">{t("colCategory")}</th>
                  <th className="px-4 py-3 font-medium">{t("colStatus")}</th>
                  <th className="px-4 py-3 font-medium">{t("colViews")}</th>
                  <th className="px-4 py-3 font-medium">{t("colSort")}</th>
                  <th className="px-4 py-3 font-medium text-right">{t("colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-border/60">
                    <td className="px-4 py-3">
                      <Link
                        href={`/help/article/${row.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {row.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{row.category_title ?? "—"}</td>
                    <td className="px-4 py-3 capitalize">{row.status ?? "—"}</td>
                    <td className="px-4 py-3">{row.total_views ?? 0}</td>
                    <td className="px-4 py-3">{row.sort ?? 0}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Link
                          href={`/help/article/${row.id}`}
                          className={btnGhost}
                          title={t("view")}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Link>
                        <Link
                          href={`/help/admin/articles/${row.id}`}
                          className={btnGhost}
                          title={t("edit")}
                        >
                          <Pencil className="h-4 w-4" />
                        </Link>
                        <button
                          type="button"
                          className={btnGhost}
                          title={t("delete")}
                          onClick={() => void handleDelete(row.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
