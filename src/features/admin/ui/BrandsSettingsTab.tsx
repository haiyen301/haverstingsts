"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";

import {
  fetchAdminBrands,
  removeAdminBrand,
  saveAdminBrand,
  type BrandRow,
} from "@/features/admin/api/brandsApi";
import {
  fetchAdminItemCategories,
  type ItemCategoryRow,
} from "@/features/admin/api/itemCategoriesApi";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  itemCategoryDisplayPath,
  sortItemCategoriesByPath,
} from "@/shared/lib/itemCategoryPath";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";
import { MultiSelect } from "@/shared/ui/multi-select";
import { useModuleAccess } from "@/shared/auth/useModuleAccess";

const inputClass =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";
const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm";
const selectChevron = <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />;
const btnPrimary =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
const btnOutline =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const btnGhost =
  "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

type FormState = {
  id?: number;
  name: string;
  title: string;
  itemCategorieIds: string[];
};

function emptyForm(): FormState {
  return { name: "", title: "", itemCategorieIds: [] };
}

function cellText(value: string | number | null | undefined): string {
  const s = String(value ?? "").trim();
  return s || "—";
}

/** Parse the brand's category ids from either a CSV string or an array. */
function parseCategoryIds(row: BrandRow): string[] {
  const raw = row.item_categorie_ids;
  let ids: string[] = [];
  if (Array.isArray(raw)) {
    ids = raw.map((v) => String(v));
  } else if (typeof raw === "string" && raw.trim()) {
    ids = raw.split(",");
  } else if (row.item_categorie_id != null) {
    ids = [String(row.item_categorie_id)];
  }
  return ids
    .map((v) => v.trim())
    .filter((v) => v !== "" && Number(v) > 0);
}

function rowToForm(row: BrandRow): FormState {
  return {
    id: Number(row.id),
    name: String(row.name ?? ""),
    title: String(row.title ?? ""),
    itemCategorieIds: parseCategoryIds(row),
  };
}

export function BrandsSettingsTab() {
  const t = useTranslations("AdminBrands");
  const { canCreate, canEdit, canDelete } = useModuleAccess("admin_brands");
  const [rows, setRows] = useState<BrandRow[]>([]);
  const [categories, setCategories] = useState<ItemCategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminBrands();
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

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await fetchAdminItemCategories();
        if (active) setCategories(data);
      } catch {
        if (active) setCategories([]);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const sortedCategories = useMemo(
    () => sortItemCategoriesByPath(categories),
    [categories],
  );

  const categoryOptions = useMemo(
    () =>
      sortedCategories.map((row) => ({
        value: String(row.id),
        label: itemCategoryDisplayPath(row, sortedCategories),
      })),
    [sortedCategories],
  );

  const categoryPathById = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of sortedCategories) {
      map.set(String(row.id), itemCategoryDisplayPath(row, sortedCategories));
    }
    return map;
  }, [sortedCategories]);

  const brandCategoryText = useCallback(
    (row: BrandRow): string => {
      const ids = parseCategoryIds(row);
      const labels = ids.map((id) => categoryPathById.get(id) ?? id);
      return labels.join(", ");
    },
    [categoryPathById],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const hay = [row.id, row.name, row.title, brandCategoryText(row)]
        .map((v) => String(v ?? "").toLowerCase())
        .join(" ");
      return hay.includes(q);
    });
  }, [rows, search, brandCategoryText]);

  const openCreate = () => {
    setForm(emptyForm());
    setError(null);
    setOpen(true);
  };

  const openEdit = (row: BrandRow) => {
    setForm(rowToForm(row));
    setError(null);
    setOpen(true);
  };

  const handleSave = async () => {
    const name = form.name.trim();
    if (!name) {
      setError(t("errors.nameRequired"));
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const title = form.title.trim();
      const itemCategorieIds = form.itemCategorieIds
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v) && v > 0);
      const saved = await saveAdminBrand({
        id: form.id,
        name,
        title: title || undefined,
        item_categorie_ids: itemCategorieIds,
      });
      setRows((prev) => {
        const idx = prev.findIndex((r) => Number(r.id) === Number(saved.id));
        if (idx < 0) {
          return [...prev, saved].sort((a, b) => String(a.name).localeCompare(String(b.name)));
        }
        const next = [...prev];
        next[idx] = saved;
        return next.sort((a, b) => String(a.name).localeCompare(String(b.name)));
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

  const handleDelete = async (row: BrandRow) => {
    const id = Number(row.id);
    if (!Number.isFinite(id) || id <= 0) return;
    if (!window.confirm(t("deleteConfirm"))) return;
    try {
      setSaving(true);
      setError(null);
      await removeAdminBrand(id);
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

      <div className="flex justify-start">
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
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="w-20 px-4 py-3 text-left font-medium">{t("table.id")}</th>
                  <th className="px-4 py-3 text-left font-medium">{t("table.name")}</th>
                  <th className="px-4 py-3 text-left font-medium">{t("table.title")}</th>
                  <th className="px-4 py-3 text-left font-medium">{t("table.category")}</th>
                  <th className="px-4 py-3 text-right font-medium">{t("table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-3 text-muted-foreground">{row.id}</td>
                    <td className="px-4 py-3 font-medium">{cellText(row.name)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{cellText(row.title)}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {cellText(brandCategoryText(row))}
                    </td>
                    <td className="px-4 py-3">
                      {canEdit || canDelete ? (
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
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
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
                <span className="text-xs font-medium">{t("form.name")} *</span>
                <input
                  className={inputClass}
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">{t("form.title")}</span>
                <input
                  className={inputClass}
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder={t("form.titlePlaceholder")}
                />
              </label>
              <div className="space-y-1">
                <span className="text-xs font-medium">{t("form.category")}</span>
                <MultiSelect
                  options={categoryOptions}
                  values={form.itemCategorieIds}
                  onChange={(next) =>
                    setForm((f) => ({ ...f, itemCategorieIds: next }))
                  }
                  multi
                  selectionSummary="compact"
                  placeholder={t("form.categoryNone")}
                  className={selectClass}
                  rightIcon={selectChevron}
                />
              </div>
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
