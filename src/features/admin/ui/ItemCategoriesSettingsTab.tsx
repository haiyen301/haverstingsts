"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";

import {
  fetchAdminItemCategories,
  removeAdminItemCategory,
  saveAdminItemCategory,
  type ItemCategoryRow,
} from "@/features/admin/api/itemCategoriesApi";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  itemCategoryDisplayPath,
  sortItemCategoriesByPath,
} from "@/shared/lib/itemCategoryPath";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";
import { useModuleAccess } from "@/shared/auth/useModuleAccess";

const inputClass =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";
const btnPrimary =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
const btnOutline =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const btnGhost =
  "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

type FormState = {
  id?: number;
  title: string;
  parent_id: string;
};

function emptyForm(): FormState {
  return { title: "", parent_id: "" };
}

function cellText(value: string | null | undefined): string {
  const s = String(value ?? "").trim();
  return s || "—";
}

export function ItemCategoriesSettingsTab() {
  const t = useTranslations("AdminItemCategories");
  const { canCreate, canEdit, canDelete } = useModuleAccess("admin_item_categories");
  const [rows, setRows] = useState<ItemCategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());

  const sortedRows = useMemo(() => sortItemCategoriesByPath(rows), [rows]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminItemCategories();
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.load"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedRows;
    return sortedRows.filter((row) => {
      const path = itemCategoryDisplayPath(row, sortedRows);
      const parentRow = row.parent_id
        ? sortedRows.find((r) => Number(r.id) === Number(row.parent_id))
        : undefined;
      const parentPath = parentRow ? itemCategoryDisplayPath(parentRow, sortedRows) : "";
      const hay = [row.id, row.title, path, parentPath]
        .map((v) => String(v ?? "").toLowerCase())
        .join(" ");
      return hay.includes(q);
    });
  }, [sortedRows, search]);

  const parentOptions = useMemo(
    () =>
      sortItemCategoriesByPath(
        rows.filter((row) => !form.id || Number(row.id) !== form.id),
      ),
    [rows, form.id],
  );

  const openCreate = () => {
    setForm(emptyForm());
    setError(null);
    setOpen(true);
  };

  const openEdit = (row: ItemCategoryRow) => {
    setForm({
      id: Number(row.id),
      title: String(row.title ?? ""),
      parent_id: row.parent_id ? String(row.parent_id) : "",
    });
    setError(null);
    setOpen(true);
  };

  const handleSave = async () => {
    const title = form.title.trim();
    if (!title) {
      setError(t("errors.titleRequired"));
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const saved = await saveAdminItemCategory({
        id: form.id,
        title,
        parent_id: form.parent_id ? Number(form.parent_id) : null,
      });
      setRows((prev) => {
        const idx = prev.findIndex((r) => Number(r.id) === Number(saved.id));
        if (idx < 0) return sortItemCategoriesByPath([...prev, saved]);
        const next = [...prev];
        next[idx] = saved;
        return sortItemCategoriesByPath(next);
      });
      setOpen(false);
      setForm(emptyForm());
      toast.success(t("saved"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.save"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: ItemCategoryRow) => {
    const id = Number(row.id);
    if (!Number.isFinite(id) || id <= 0) return;
    if (!window.confirm(t("deleteConfirm"))) return;
    try {
      setSaving(true);
      setError(null);
      await removeAdminItemCategory(id);
      setRows((prev) => prev.filter((r) => Number(r.id) !== id));
      toast.success(t("deleted"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.delete"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <button type="button" className={btnPrimary} onClick={openCreate} disabled={!canCreate}>
          <Plus className="h-4 w-4" />
          {t("add")}
        </button>
      </div>

      <div className="flex justify-end">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className={cn(inputClass, "pl-9")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("search")}
          />
        </div>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : null}
      {error && !open ? <p className="text-sm text-destructive">{error}</p> : null}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="w-20 px-4 py-3 text-left font-medium">{t("table.id")}</th>
                  <th className="px-4 py-3 text-left font-medium">{t("table.title")}</th>
                  <th className="px-4 py-3 text-left font-medium">{t("table.parent")}</th>
                  <th className="px-4 py-3 text-right font-medium">{t("table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-3 text-muted-foreground">{row.id}</td>
                    <td className="px-4 py-3 font-medium">
                      {cellText(itemCategoryDisplayPath(row, sortedRows))}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {row.parent_id
                        ? cellText(
                            itemCategoryDisplayPath(
                              sortedRows.find((r) => Number(r.id) === Number(row.parent_id)) ?? {
                                id: Number(row.parent_id),
                                title: "",
                              },
                              sortedRows,
                            ),
                          )
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {(canEdit || canDelete) ? (
                        <div className="flex items-center justify-end gap-1">
                          {canEdit ? (
                            <button type="button" className={btnGhost} onClick={() => openEdit(row)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                          {canDelete ? (
                            <button
                              type="button"
                              className={cn(btnGhost, "text-destructive hover:bg-destructive/10")}
                              disabled={saving}
                              onClick={() => void handleDelete(row)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        <span className="block text-right text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!loading && filtered.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                      {t("table.empty")}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-background p-6 shadow-lg">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {form.id ? t("editTitle") : t("createTitle")}
              </h2>
              <button type="button" className={btnGhost} onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
            <div className="mt-4 space-y-4">
              <label className="block space-y-1">
                <span className="text-xs font-medium">{t("form.title")} *</span>
                <input
                  className={inputClass}
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">{t("form.parent")}</span>
                <select
                  className={inputClass}
                  value={form.parent_id}
                  onChange={(e) => setForm((f) => ({ ...f, parent_id: e.target.value }))}
                >
                  <option value="">{t("form.noParent")}</option>
                  {parentOptions.map((row) => (
                    <option key={row.id} value={String(row.id)}>
                      {itemCategoryDisplayPath(row, sortedRows)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" className={btnOutline} onClick={() => setOpen(false)}>
                {t("cancel")}
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={saving}
                onClick={() => void handleSave()}
              >
                {t("save")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
