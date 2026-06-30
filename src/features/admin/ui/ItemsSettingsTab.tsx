"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";

import {
  fetchAdminItems,
  fetchItemFormOptions,
  ITEM_RATE_CATEGORY_TITLES,
  itemCategorySupportsRate,
  removeAdminItem,
  saveAdminItem,
  type ItemFormOptions,
  type ItemRow,
} from "@/features/admin/api/itemsApi";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
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
  sku_sts: string;
  old_sku: string;
  commodity_code: string;
  thai_code: string;
  myanmar_code: string;
  malaysia_code: string;
  singapore_code: string;
  commodity_name: string;
  vietnamese_name: string;
  thai_name: string;
  description: string;
  brand_id: string;
  category_id: string;
  unit_id: string;
  purchase_price: string;
  rate: string;
  rate_uom: string;
};

function emptyForm(): FormState {
  return {
    sku_sts: "",
    old_sku: "",
    commodity_code: "",
    thai_code: "",
    myanmar_code: "",
    malaysia_code: "",
    singapore_code: "",
    commodity_name: "",
    vietnamese_name: "",
    thai_name: "",
    description: "",
    brand_id: "",
    category_id: "",
    unit_id: "",
    purchase_price: "",
    rate: "",
    rate_uom: "",
  };
}

function cellText(value: string | null | undefined): string {
  const s = String(value ?? "").trim();
  return s || "—";
}

function rowToForm(row: ItemRow): FormState {
  return {
    id: Number(row.id),
    sku_sts: String(row.sku_sts ?? ""),
    old_sku: String(row.old_sku ?? ""),
    commodity_code: String(row.commodity_code ?? ""),
    thai_code: String(row.thai_code ?? ""),
    myanmar_code: String(row.myanmar_code ?? ""),
    malaysia_code: String(row.malaysia_code ?? ""),
    singapore_code: String(row.singapore_code ?? ""),
    commodity_name: String(row.commodity_name ?? ""),
    vietnamese_name: String(row.vietnamese_name ?? ""),
    thai_name: String(row.thai_name ?? ""),
    description: String(row.description ?? ""),
    brand_id: row.brand_id ? String(row.brand_id) : "",
    category_id: row.category_id ? String(row.category_id) : "",
    unit_id: row.unit_id ? String(row.unit_id) : "",
    purchase_price: row.purchase_price != null ? String(row.purchase_price) : "",
    rate: row.rate != null ? String(row.rate) : "",
    rate_uom: String(row.rate_uom ?? ""),
  };
}

function formatRateCell(row: ItemRow, rateCategoryTitles: readonly string[]): string {
  if (!itemCategorySupportsRate(row.category_title, rateCategoryTitles)) {
    return "—";
  }
  const rate = String(row.rate ?? "").trim();
  const uom = String(row.rate_uom ?? "").trim();
  if (!rate && !uom) return "—";
  if (rate && uom) return `${rate} ${uom}`;
  return rate || uom;
}

function categoryTitleById(
  categories: ItemFormOptions["categories"],
  categoryId: string,
): string {
  const id = Number(categoryId);
  if (!Number.isFinite(id) || id <= 0) return "";
  return categories.find((c) => Number(c.id) === id)?.title ?? "";
}

export function ItemsSettingsTab() {
  const t = useTranslations("AdminItems");
  const { canCreate, canEdit, canDelete } = useModuleAccess("admin_items");
  const [rows, setRows] = useState<ItemRow[]>([]);
  const [options, setOptions] = useState<ItemFormOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: { category_id?: number } = {};
      if (categoryFilter !== "all") {
        const categoryId = Number(categoryFilter);
        if (Number.isFinite(categoryId) && categoryId > 0) {
          params.category_id = categoryId;
        }
      }
      const [data, formOptions] = await Promise.all([
        fetchAdminItems(params),
        options ? Promise.resolve(options) : fetchItemFormOptions(),
      ]);
      setRows(data);
      if (!options) setOptions(formOptions);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.load"));
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, options, t]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const hay = [
        row.id,
        row.sku_sts,
        row.commodity_name,
        row.brand_name,
        row.category_title,
        row.unit_name,
      ]
        .map((v) => String(v ?? "").toLowerCase())
        .join(" ");
      return hay.includes(q);
    });
  }, [rows, search]);

  const openCreate = () => {
    setForm(emptyForm());
    setError(null);
    setOpen(true);
  };

  const openEdit = (row: ItemRow) => {
    setForm(rowToForm(row));
    setError(null);
    setOpen(true);
  };

  const handleSave = async () => {
    const commodityName = form.commodity_name.trim();
    const brandId = Number(form.brand_id);
    const categoryId = Number(form.category_id);
    const unitId = Number(form.unit_id);
    if (!commodityName) {
      setError(t("errors.nameRequired"));
      return;
    }
    if (!Number.isFinite(brandId) || brandId <= 0) {
      setError(t("errors.brandRequired"));
      return;
    }
    if (!Number.isFinite(categoryId) || categoryId <= 0) {
      setError(t("errors.categoryRequired"));
      return;
    }
    if (!Number.isFinite(unitId) || unitId <= 0) {
      setError(t("errors.unitRequired"));
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const saved = await saveAdminItem({
        id: form.id,
        sku_sts: form.sku_sts.trim() || undefined,
        old_sku: form.old_sku.trim() || undefined,
        commodity_code: form.commodity_code.trim() || undefined,
        thai_code: form.thai_code.trim() || undefined,
        myanmar_code: form.myanmar_code.trim() || undefined,
        malaysia_code: form.malaysia_code.trim() || undefined,
        singapore_code: form.singapore_code.trim() || undefined,
        commodity_name: commodityName,
        vietnamese_name: form.vietnamese_name.trim() || undefined,
        thai_name: form.thai_name.trim() || undefined,
        description: form.description.trim() || undefined,
        brand_id: brandId,
        category_id: categoryId,
        unit_id: unitId,
        purchase_price: form.purchase_price.trim() || undefined,
        ...(formSupportsRate
          ? {
              rate: form.rate.trim() || null,
              rate_uom: form.rate_uom.trim() || null,
            }
          : {
              rate: null,
              rate_uom: null,
            }),
      });
      setRows((prev) => {
        const idx = prev.findIndex((r) => Number(r.id) === Number(saved.id));
        if (idx < 0) return [...prev, saved].sort((a, b) => Number(a.id) - Number(b.id));
        const next = [...prev];
        next[idx] = saved;
        return next;
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

  const handleDelete = async (row: ItemRow) => {
    const id = Number(row.id);
    if (!Number.isFinite(id) || id <= 0) return;
    if (!window.confirm(t("deleteConfirm"))) return;
    try {
      setSaving(true);
      setError(null);
      await removeAdminItem(id);
      setRows((prev) => prev.filter((r) => Number(r.id) !== id));
      toast.success(t("deleted"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.delete"));
    } finally {
      setSaving(false);
    }
  };

  const categoryOptions = options?.categories ?? [];
  const brandOptions = options?.brands ?? [];
  const unitOptions = options?.units ?? [];
  const brandMultiOptions = useMemo(
    () => brandOptions.map((b) => ({ value: String(b.id), label: b.name })),
    [brandOptions],
  );
  const categoryMultiOptions = useMemo(
    () => categoryOptions.map((c) => ({ value: String(c.id), label: c.title })),
    [categoryOptions],
  );
  const unitMultiOptions = useMemo(
    () => unitOptions.map((u) => ({ value: String(u.unit_type_id), label: u.unit_name })),
    [unitOptions],
  );
  const rateCategoryTitles = options?.rate_category_titles ?? ITEM_RATE_CATEGORY_TITLES;
  const selectedCategoryTitle = categoryTitleById(categoryOptions, form.category_id);
  const formSupportsRate = itemCategorySupportsRate(selectedCategoryTitle, rateCategoryTitles);

  const handleCategoryChange = (categoryId: string) => {
    const title = categoryTitleById(categoryOptions, categoryId);
    const supportsRate = itemCategorySupportsRate(title, rateCategoryTitles);
    setForm((f) => ({
      ...f,
      category_id: categoryId,
      rate: supportsRate ? f.rate : "",
      rate_uom: supportsRate ? f.rate_uom : "",
    }));
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

      <div className="flex flex-wrap justify-end gap-3">
        <div className="w-full max-w-[220px]">
          <MultiSelect
            options={categoryMultiOptions}
            values={categoryFilter !== "all" ? [categoryFilter] : []}
            onChange={(next) => setCategoryFilter(next[0] ?? "all")}
            multi={false}
            showAllOption
            allOptionLabel={t("filters.allCategories")}
            placeholder={t("filters.allCategories")}
            className={selectClass}
            rightIcon={selectChevron}
            showSelectedChipsInPopover={false}
          />
        </div>
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
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-3 text-left font-medium">{t("table.sku")}</th>
                  <th className="px-4 py-3 text-left font-medium">{t("table.name")}</th>
                  <th className="px-4 py-3 text-left font-medium">{t("table.brand")}</th>
                  <th className="px-4 py-3 text-left font-medium">{t("table.category")}</th>
                  <th className="px-4 py-3 text-left font-medium">{t("table.unit")}</th>
                  <th className="px-4 py-3 text-left font-medium">{t("table.rate")}</th>
                  <th className="px-4 py-3 text-right font-medium">{t("table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-3 font-medium">{cellText(row.sku_sts)}</td>
                    <td className="px-4 py-3">{cellText(row.commodity_name)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{cellText(row.brand_name)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{cellText(row.category_title)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{cellText(row.unit_name)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatRateCell(row, rateCategoryTitles)}</td>
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
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
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
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-background p-6 shadow-lg">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {form.id ? t("editTitle") : t("createTitle")}
              </h2>
              <button type="button" className={btnGhost} onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-medium">{t("form.skuSts")}</span>
                <input className={inputClass} value={form.sku_sts} onChange={(e) => setForm((f) => ({ ...f, sku_sts: e.target.value }))} />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium">{t("form.oldSku")}</span>
                <input className={inputClass} value={form.old_sku} onChange={(e) => setForm((f) => ({ ...f, old_sku: e.target.value }))} />
              </label>
              <label className="col-span-full space-y-1">
                <span className="text-xs font-medium">{t("form.commodityName")} *</span>
                <input className={inputClass} value={form.commodity_name} onChange={(e) => setForm((f) => ({ ...f, commodity_name: e.target.value }))} />
              </label>
              <div className="space-y-1">
                <span className="text-xs font-medium">{t("form.brand")} *</span>
                <MultiSelect
                  options={brandMultiOptions}
                  values={form.brand_id ? [form.brand_id] : []}
                  onChange={(next) => setForm((f) => ({ ...f, brand_id: next[0] ?? "" }))}
                  multi={false}
                  placeholder={t("form.select")}
                  className={selectClass}
                  rightIcon={selectChevron}
                  showSelectedChipsInPopover={false}
                />
              </div>
              <div className="space-y-1">
                <span className="text-xs font-medium">{t("form.category")} *</span>
                <MultiSelect
                  options={categoryMultiOptions}
                  values={form.category_id ? [form.category_id] : []}
                  onChange={(next) => handleCategoryChange(next[0] ?? "")}
                  multi={false}
                  placeholder={t("form.select")}
                  className={selectClass}
                  rightIcon={selectChevron}
                  showSelectedChipsInPopover={false}
                />
              </div>
              <div className="space-y-1">
                <span className="text-xs font-medium">{t("form.unit")} *</span>
                <MultiSelect
                  options={unitMultiOptions}
                  values={form.unit_id ? [form.unit_id] : []}
                  onChange={(next) => setForm((f) => ({ ...f, unit_id: next[0] ?? "" }))}
                  multi={false}
                  placeholder={t("form.select")}
                  className={selectClass}
                  rightIcon={selectChevron}
                  showSelectedChipsInPopover={false}
                />
              </div>
              {formSupportsRate ? (
                <>
                  <label className="space-y-1">
                    <span className="text-xs font-medium">{t("form.rate")}</span>
                    <input className={inputClass} value={form.rate} onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium">{t("form.rateUom")}</span>
                    <input
                      className={inputClass}
                      value={form.rate_uom}
                      onChange={(e) => setForm((f) => ({ ...f, rate_uom: e.target.value }))}
                      placeholder={t("form.rateUomPlaceholder")}
                    />
                  </label>
                </>
              ) : null}
              <label className="space-y-1">
                <span className="text-xs font-medium">{t("form.commodityCode")}</span>
                <input className={inputClass} value={form.commodity_code} onChange={(e) => setForm((f) => ({ ...f, commodity_code: e.target.value }))} />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium">{t("form.thaiCode")}</span>
                <input className={inputClass} value={form.thai_code} onChange={(e) => setForm((f) => ({ ...f, thai_code: e.target.value }))} />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium">{t("form.myanmarCode")}</span>
                <input className={inputClass} value={form.myanmar_code} onChange={(e) => setForm((f) => ({ ...f, myanmar_code: e.target.value }))} />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium">{t("form.malaysiaCode")}</span>
                <input className={inputClass} value={form.malaysia_code} onChange={(e) => setForm((f) => ({ ...f, malaysia_code: e.target.value }))} />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium">{t("form.singaporeCode")}</span>
                <input className={inputClass} value={form.singapore_code} onChange={(e) => setForm((f) => ({ ...f, singapore_code: e.target.value }))} />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium">{t("form.vietnameseName")}</span>
                <input className={inputClass} value={form.vietnamese_name} onChange={(e) => setForm((f) => ({ ...f, vietnamese_name: e.target.value }))} />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium">{t("form.thaiName")}</span>
                <input className={inputClass} value={form.thai_name} onChange={(e) => setForm((f) => ({ ...f, thai_name: e.target.value }))} />
              </label>
              <label className="col-span-full space-y-1">
                <span className="text-xs font-medium">{t("form.description")}</span>
                <textarea className={cn(inputClass, "min-h-[72px] py-2")} rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" className={btnOutline} onClick={() => setOpen(false)}>
                {t("cancel")}
              </button>
              <button type="button" className={btnPrimary} disabled={saving} onClick={() => void handleSave()}>
                {t("save")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
