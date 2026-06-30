"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "react-toastify";

import {
  fetchHelpCategories,
  removeHelpCategory,
  saveHelpCategory,
  type HelpCategoryRow,
} from "@/features/help/api/helpApi";
import { HelpRichTextEditor } from "@/features/help/ui/HelpRichTextEditor";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";

const inputClass =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";
const btnPrimary =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50";
const btnOutline =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/80";
const btnGhost =
  "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted disabled:opacity-50";

type FormState = {
  id?: number;
  title: string;
  description: string;
  sort: string;
  articles_order: string;
  status: string;
};

function emptyForm(): FormState {
  return {
    title: "",
    description: "",
    sort: "0",
    articles_order: "",
    status: "active",
  };
}

function rowToForm(row: HelpCategoryRow): FormState {
  return {
    id: row.id,
    title: row.title ?? "",
    description: row.description ?? "",
    sort: String(row.sort ?? 0),
    articles_order: row.articles_order ?? "",
    status: row.status ?? "active",
  };
}

export function HelpCategoriesTab() {
  const t = useTranslations("HelpAdmin");
  const [rows, setRows] = useState<HelpCategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchHelpCategories("help", true);
      setRows(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.load"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const handleSave = async () => {
    if (!form.title.trim()) {
      toast.warn(t("titleRequired"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      return;
    }
    setSaving(true);
    try {
      await saveHelpCategory({
        id: form.id,
        title: form.title.trim(),
        description: form.description,
        type: "help",
        sort: Number(form.sort) || 0,
        articles_order: form.articles_order,
        status: form.status,
      });
      toast.success(t("saved"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      setOpen(false);
      setForm(emptyForm());
      await loadRows();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.save"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm(t("confirmDeleteCategory"))) return;
    try {
      await removeHelpCategory(id);
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
          <h1 className="text-xl font-semibold text-foreground">{t("categoriesTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("categoriesSubtitle")}</p>
        </div>
        <button
          type="button"
          className={btnPrimary}
          onClick={() => {
            setForm(emptyForm());
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          {t("addCategory")}
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">{t("colTitle")}</th>
                  <th className="px-4 py-3 font-medium">{t("colStatus")}</th>
                  <th className="px-4 py-3 font-medium">{t("colSort")}</th>
                  <th className="px-4 py-3 font-medium">{t("colArticles")}</th>
                  <th className="px-4 py-3 font-medium text-right">{t("colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-border/60">
                    <td className="px-4 py-3 font-medium text-foreground">{row.title}</td>
                    <td className="px-4 py-3 capitalize">{row.status ?? "—"}</td>
                    <td className="px-4 py-3">{row.sort ?? 0}</td>
                    <td className="px-4 py-3">{row.total_articles ?? 0}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          className={btnGhost}
                          title={t("edit")}
                          onClick={() => {
                            setForm(rowToForm(row));
                            setOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
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

      {open ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-background p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-foreground">
              {form.id ? t("editCategory") : t("addCategory")}
            </h2>
            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">{t("fieldTitle")}</label>
                <input
                  className={inputClass}
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">{t("fieldDescription")}</label>
                <HelpRichTextEditor
                  value={form.description}
                  onChange={(html) => setForm((f) => ({ ...f, description: html }))}
                  minHeight={160}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">{t("fieldSort")}</label>
                  <input
                    type="number"
                    min={0}
                    className={inputClass}
                    value={form.sort}
                    onChange={(e) => setForm((f) => ({ ...f, sort: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">{t("fieldArticlesOrder")}</label>
                  <select
                    className={cn(inputClass, "h-9")}
                    value={form.articles_order}
                    onChange={(e) => setForm((f) => ({ ...f, articles_order: e.target.value }))}
                  >
                    <option value="">A-Z</option>
                    <option value="Z-A">Z-A</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-4">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={form.status === "active"}
                    onChange={() => setForm((f) => ({ ...f, status: "active" }))}
                  />
                  {t("statusActive")}
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={form.status === "inactive"}
                    onChange={() => setForm((f) => ({ ...f, status: "inactive" }))}
                  />
                  {t("statusInactive")}
                </label>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" className={btnOutline} onClick={() => setOpen(false)}>
                {t("cancel")}
              </button>
              <button type="button" className={btnPrimary} disabled={saving} onClick={() => void handleSave()}>
                {saving ? t("saving") : t("save")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
