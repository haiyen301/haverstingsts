"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { toast } from "react-toastify";

import {
  fetchHelpArticle,
  fetchHelpCategories,
  saveHelpArticle,
  type HelpCategoryRow,
} from "@/features/help/api/helpApi";
import { HelpRichTextEditor } from "@/features/help/ui/HelpRichTextEditor";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";

const inputClass =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";
const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm";
const btnPrimary =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50";
const btnOutline =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/80";

type HelpArticleFormProps = {
  articleId?: number;
};

export function HelpArticleForm({ articleId }: HelpArticleFormProps) {
  const t = useTranslations("HelpAdmin");
  const router = useRouter();
  const isEdit = Boolean(articleId && articleId > 0);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<HelpCategoryRow[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [sort, setSort] = useState("0");
  const [status, setStatus] = useState("active");

  const load = useCallback(async () => {
    try {
      const cats = await fetchHelpCategories("help", true);
      setCategories(cats);
      if (isEdit && articleId) {
        const article = await fetchHelpArticle(articleId);
        setTitle(article.title ?? "");
        setDescription(article.description ?? "");
        setCategoryId(String(article.category_id ?? ""));
        setSort(String(article.sort ?? 0));
        setStatus(article.status ?? "active");
      } else if (cats[0]?.id) {
        setCategoryId(String(cats[0].id));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.load"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
    } finally {
      setLoading(false);
    }
  }, [articleId, isEdit, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    const cat = Number(categoryId);
    if (!title.trim() || !Number.isFinite(cat) || cat <= 0) {
      toast.warn(t("articleRequiredFields"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      return;
    }
    setSaving(true);
    try {
      const saved = await saveHelpArticle({
        id: isEdit ? articleId : undefined,
        title: title.trim(),
        description,
        category_id: cat,
        sort: Number(sort) || 0,
        status,
      });
      toast.success(t("saved"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      router.push(`/help/admin/articles/${saved.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.save"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/help/admin/articles"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("backToArticles")}
          </Link>
          <h1 className="text-xl font-semibold text-foreground">
            {isEdit ? t("editArticle") : t("addArticle")}
          </h1>
        </div>
        {isEdit && articleId ? (
          <Link
            href={`/help/article/${articleId}`}
            className={btnOutline}
            target="_blank"
          >
            <ExternalLink className="h-4 w-4" />
            {t("view")}
          </Link>
        ) : null}
      </div>

      <div className="space-y-4 rounded-lg border border-border bg-card p-5">
        <div>
          <label className="mb-1 block text-sm font-medium">{t("fieldTitle")}</label>
          <input
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">{t("fieldCategory")}</label>
          <select
            className={selectClass}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">{t("selectCategory")}</option>
            {categories.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.title}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">{t("fieldContent")}</label>
          <HelpRichTextEditor
            value={description}
            onChange={setDescription}
            placeholder={t("contentPlaceholder")}
            minHeight={360}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">{t("fieldSort")}</label>
            <input
              type="number"
              min={0}
              className={inputClass}
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            />
          </div>
          <div className="flex items-end gap-4 pb-1">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={status === "active"}
                onChange={() => setStatus("active")}
              />
              {t("statusActive")}
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={status === "inactive"}
                onChange={() => setStatus("inactive")}
              />
              {t("statusInactive")}
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Link href="/help/admin/articles" className={btnOutline}>
            {t("cancel")}
          </Link>
          <button type="button" className={btnPrimary} disabled={saving} onClick={() => void handleSave()}>
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}
