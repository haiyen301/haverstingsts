"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Pencil, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { toast } from "react-toastify";
import { useTranslations } from "next-intl";
import RequireAuth from "@/features/auth/RequireAuth";
import {
  fetchFertilizerProducts,
  removeFertilizerProduct,
  saveFertilizerProduct,
  sortFertilizerProductRowsByName,
  type FertilizerProductRow,
} from "@/features/admin/api/adminApi";
import { fetchActiveCountries, type CountryRow } from "@/features/admin/api/countriesApi";
import { FertilizerProductImportDialog } from "@/features/admin/ui/FertilizerProductImportDialog";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { buildCountrySelectOptions } from "@/shared/lib/harvestReferenceData";
import { MultiSelect } from "@/shared/ui/multi-select";
import { Checkbox } from "@/shared/ui/checkbox";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";
import { canAccessModule } from "@/shared/auth/permissions";
import { useAuthUserStore } from "@/shared/store/authUserStore";

const inputClass =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";
const btnOutline =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const btnPrimary =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const btnGhost =
  "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";
const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm";
const selectChevron = <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />;

type FormState = {
  id?: number;
  name: string;
  uom: string;
  country_id: string;
};

type BulkFormState = {
  updateUom: boolean;
  uom: string;
  updateCountry: boolean;
  country_id: string;
};

function emptyForm(): FormState {
  return { name: "", uom: "", country_id: "" };
}

function emptyBulkForm(): BulkFormState {
  return { updateUom: false, uom: "", updateCountry: false, country_id: "" };
}

export default function AdminFertilizerProductPage() {
  const t = useTranslations("AdminFertilizerProduct");
  const user = useAuthUserStore((s) => s.user);
  const canCreate = canAccessModule(user, "admin_fertilizer_product", "create");
  const canEdit = canAccessModule(user, "admin_fertilizer_product", "edit");
  const canDelete = canAccessModule(user, "admin_fertilizer_product", "delete");

  const [rows, setRows] = useState<FertilizerProductRow[]>([]);
  const [countries, setCountries] = useState<CountryRow[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [bulkForm, setBulkForm] = useState<BulkFormState>(emptyBulkForm());
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, countryData] = await Promise.all([
        fetchFertilizerProducts(),
        fetchActiveCountries(),
      ]);
      setRows(sortFertilizerProductRowsByName(data));
      setCountries(countryData);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.load"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const countryOptions = useMemo(
    () => buildCountrySelectOptions(countries, form.country_id || null),
    [countries, form.country_id],
  );

  const countryNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const option of countryOptions) {
      map.set(String(option.id), option.name);
    }
    return map;
  }, [countryOptions]);

  const bulkCountryOptions = useMemo(
    () => buildCountrySelectOptions(countries, null),
    [countries],
  );

  const showSelection = canEdit || canDelete;
  const selectedCount = selectedIds.size;
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.has(Number(row.id))),
    [rows, selectedIds],
  );
  const filteredRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return rows;

    return rows.filter((row) => {
      const country =
        row.country_name?.trim() ||
        (row.country_id
          ? countryNameById.get(String(row.country_id)) ?? row.country_id
          : t("table.global"));
      const searchableText = [row.name, country, row.uom]
        .map((value) => String(value ?? "").toLocaleLowerCase())
        .join(" ");

      return searchableText.includes(query);
    });
  }, [countryNameById, rows, search, t]);
  const allRowsSelected =
    filteredRows.length > 0 &&
    filteredRows.every((row) => selectedIds.has(Number(row.id)));
  const someRowsSelected = filteredRows.some((row) => selectedIds.has(Number(row.id)));

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const openCreate = () => {
    setForm(emptyForm());
    setError(null);
    setOpen(true);
  };

  const openEdit = (row: FertilizerProductRow) => {
    setForm({
      id: Number(row.id),
      name: String(row.name ?? ""),
      uom: String(row.uom ?? ""),
      country_id: row.country_id ? String(row.country_id) : "",
    });
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
      const saved = await saveFertilizerProduct({
        id: form.id,
        name,
        uom: form.uom.trim(),
        country_id: form.country_id ? Number(form.country_id) : null,
      });
      setRows((prev) => {
        const exists = prev.some((r) => Number(r.id) === Number(saved.id));
        const merged = exists
          ? prev.map((r) => (Number(r.id) === Number(saved.id) ? saved : r))
          : [...prev, saved];
        return sortFertilizerProductRowsByName(merged);
      });
      setOpen(false);
      setForm(emptyForm());
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.save"));
    } finally {
      setSaving(false);
    }
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const toggleRowSelection = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllRows = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const row of filteredRows) {
        const id = Number(row.id);
        if (allRowsSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const openBulkEdit = () => {
    if (selectedCount === 0) return;
    setBulkForm(emptyBulkForm());
    setError(null);
    setBulkOpen(true);
  };

  const handleBulkSave = async () => {
    if (selectedCount === 0) return;
    if (!bulkForm.updateUom && !bulkForm.updateCountry) {
      setError(t("errors.bulkNoFields"));
      return;
    }

    try {
      setSaving(true);
      setError(null);

      let saved = 0;
      let failed = 0;
      const updatedById = new Map<number, FertilizerProductRow>();

      for (const row of selectedRows) {
        const id = Number(row.id);
        if (!Number.isFinite(id) || id <= 0) {
          failed += 1;
          continue;
        }

        const name = String(row.name ?? "").trim();
        if (!name) {
          failed += 1;
          continue;
        }

        const nextUom = bulkForm.updateUom ? bulkForm.uom.trim() : String(row.uom ?? "").trim();
        const nextCountryId = bulkForm.updateCountry
          ? bulkForm.country_id
            ? Number(bulkForm.country_id)
            : null
          : row.country_id
            ? Number(row.country_id)
            : null;

        try {
          const result = await saveFertilizerProduct({
            id,
            name,
            uom: nextUom,
            country_id: nextCountryId,
          });
          updatedById.set(id, result);
          saved += 1;
        } catch {
          failed += 1;
        }
      }

      if (saved > 0) {
        setRows((prev) =>
          sortFertilizerProductRowsByName(
            prev.map((row) => updatedById.get(Number(row.id)) ?? row),
          ),
        );
      }

      if (failed > 0) {
        const message = t("bulkEditPartial", { saved, failed });
        setError(message);
        toast.error(message, { containerId: TOAST_CONTAINER_TOP_RIGHT });
      } else {
        toast.success(t("bulkEditSuccess", { count: saved }), {
          containerId: TOAST_CONTAINER_TOP_RIGHT,
        });
        setBulkOpen(false);
        setBulkForm(emptyBulkForm());
        clearSelection();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.save"));
    } finally {
      setSaving(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedCount === 0) return;
    if (!window.confirm(t("bulkDeleteConfirm", { count: selectedCount }))) return;

    try {
      setSaving(true);
      setError(null);

      let deleted = 0;
      let failed = 0;
      const deletedIds = new Set<number>();

      for (const row of selectedRows) {
        const id = Number(row.id);
        if (!Number.isFinite(id) || id <= 0) {
          failed += 1;
          continue;
        }
        try {
          await removeFertilizerProduct(id);
          deletedIds.add(id);
          deleted += 1;
        } catch {
          failed += 1;
        }
      }

      if (deleted > 0) {
        setRows((prev) => prev.filter((row) => !deletedIds.has(Number(row.id))));
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (const id of deletedIds) next.delete(id);
          return next;
        });
      }

      if (failed > 0) {
        const message = t("bulkDeletePartial", { deleted, failed });
        setError(message);
        toast.error(message, { containerId: TOAST_CONTAINER_TOP_RIGHT });
      } else {
        toast.success(t("bulkDeleteSuccess", { count: deleted }), {
          containerId: TOAST_CONTAINER_TOP_RIGHT,
        });
        clearSelection();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.delete"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: FertilizerProductRow) => {
    const id = Number(row.id);
    if (!Number.isFinite(id) || id <= 0) return;
    if (!window.confirm(t("deleteConfirm"))) return;
    try {
      setSaving(true);
      setError(null);
      await removeFertilizerProduct(id);
      setRows((prev) => prev.filter((r) => Number(r.id) !== id));
      setSelectedIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.delete"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="space-y-6 p-4 lg:p-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold">{t("title")}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
            </div>
            {canCreate ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={btnOutline}
                  onClick={() => setImportOpen(true)}
                  disabled={saving}
                >
                  <Upload className="h-4 w-4" />
                  {t("importExcel")}
                </button>
                <button
                  type="button"
                  className={btnPrimary}
                  onClick={openCreate}
                  disabled={saving}
                >
                  <Plus className="h-4 w-4" />
                  {t("add")}
                </button>
              </div>
            ) : null}
          </div>

          <div className="flex justify-start">
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                className={cn(inputClass, "pl-9")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("search")}
                aria-label={t("search")}
              />
            </div>
          </div>

          {loading ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {showSelection && selectedCount > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 px-4 py-3">
              <span className="text-sm text-muted-foreground">
                {t("selectedCount", { count: selectedCount })}
              </span>
              {canEdit ? (
                <button
                  type="button"
                  className={btnOutline}
                  disabled={saving}
                  onClick={openBulkEdit}
                >
                  <Pencil className="h-4 w-4" />
                  {t("bulkEdit", { count: selectedCount })}
                </button>
              ) : null}
              {canDelete ? (
                <button
                  type="button"
                  className={cn(
                    btnOutline,
                    "border-destructive/40 text-destructive hover:bg-destructive/10",
                  )}
                  disabled={saving}
                  onClick={() => void handleBulkDelete()}
                >
                  <Trash2 className="h-4 w-4" />
                  {t("bulkDelete", { count: selectedCount })}
                </button>
              ) : null}
              <button
                type="button"
                className={btnOutline}
                disabled={saving}
                onClick={clearSelection}
              >
                {t("clearSelection")}
              </button>
            </div>
          ) : null}

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      {showSelection ? (
                        <th className="w-10 px-3 py-3">
                          <Checkbox
                            checked={allRowsSelected}
                            indeterminate={someRowsSelected && !allRowsSelected}
                            disabled={loading || saving || filteredRows.length === 0}
                            onChange={toggleSelectAllRows}
                            aria-label={t("toggleAll")}
                          />
                        </th>
                      ) : null}
                      <th className="px-4 py-3 text-left font-medium">{t("table.name")}</th>
                      <th className="px-4 py-3 text-left font-medium">{t("table.country")}</th>
                      <th className="px-4 py-3 text-left font-medium">{t("table.uom")}</th>
                      <th className="px-4 py-3 text-right font-medium">{t("table.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => {
                      const rowId = Number(row.id);
                      const isSelected = selectedIds.has(rowId);
                      return (
                      <tr
                        key={row.id}
                        className={cn(
                          "border-b border-border last:border-b-0 transition-colors hover:bg-muted/30",
                          isSelected && "bg-primary/5",
                        )}
                      >
                        {showSelection ? (
                          <td className="px-3 py-3">
                            <Checkbox
                              checked={isSelected}
                              disabled={loading || saving}
                              onChange={() => toggleRowSelection(rowId)}
                              aria-label={t("toggleRow", { name: row.name })}
                            />
                          </td>
                        ) : null}
                        <td className="px-4 py-3 font-medium">{row.name}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {row.country_name?.trim() ||
                            (row.country_id
                              ? countryNameById.get(String(row.country_id)) ?? row.country_id
                              : t("table.global"))}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {row.uom?.trim() ? row.uom : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {canEdit ? (
                              <button
                                type="button"
                                className={btnGhost}
                                disabled={saving}
                                onClick={() => openEdit(row)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            ) : null}
                            {canDelete ? (
                              <button
                                type="button"
                                className={cn(
                                  btnGhost,
                                  "text-destructive hover:bg-destructive/10",
                                )}
                                disabled={saving}
                                onClick={() => void handleDelete(row)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            ) : null}
                            {!canEdit && !canDelete ? (
                              <span className="text-muted-foreground">—</span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                    })}
                    {!loading && filteredRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={showSelection ? 5 : 4}
                          className="px-4 py-8 text-center text-muted-foreground"
                        >
                          {t("empty")}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        <FertilizerProductImportDialog
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onImported={() => void loadRows()}
          existingRows={rows}
          countries={countries}
          canImport={canCreate}
        />

        {bulkOpen ? (
          <Modal
            title={t("bulkEditTitle", { count: selectedCount })}
            onClose={() => {
              if (saving) return;
              setBulkOpen(false);
              setBulkForm(emptyBulkForm());
            }}
          >
            <p className="text-sm text-muted-foreground">{t("bulkEditHint")}</p>

            <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm">
              {selectedRows.map((row) => row.name).join(", ")}
            </div>

            <label className="flex items-start gap-3 rounded-lg border border-border p-3">
              <Checkbox
                checked={bulkForm.updateUom}
                disabled={saving}
                onChange={(e) =>
                  setBulkForm((prev) => ({ ...prev, updateUom: e.target.checked }))
                }
                rootClassName="mt-0.5"
              />
              <div className="min-w-0 flex-1 space-y-2">
                <span className="text-sm font-medium">{t("bulkUpdateUom")}</span>
                <input
                  className={inputClass}
                  value={bulkForm.uom}
                  placeholder={t("form.uomPlaceholder")}
                  disabled={saving || !bulkForm.updateUom}
                  onChange={(e) => setBulkForm((prev) => ({ ...prev, uom: e.target.value }))}
                />
              </div>
            </label>

            <label className="flex items-start gap-3 rounded-lg border border-border p-3">
              <Checkbox
                checked={bulkForm.updateCountry}
                disabled={saving}
                onChange={(e) =>
                  setBulkForm((prev) => ({ ...prev, updateCountry: e.target.checked }))
                }
                rootClassName="mt-0.5"
              />
              <div className="min-w-0 flex-1 space-y-2">
                <span className="text-sm font-medium">{t("bulkUpdateCountry")}</span>
                <MultiSelect
                  options={[
                    { value: "", label: t("form.countryGlobal") },
                    ...bulkCountryOptions.map((country) => ({
                      value: country.id,
                      label: country.name,
                    })),
                  ]}
                  values={bulkForm.country_id ? [bulkForm.country_id] : []}
                  onChange={(next) =>
                    setBulkForm((prev) => ({
                      ...prev,
                      country_id: next[0]?.trim() ? next[0] : "",
                    }))
                  }
                  multi={false}
                  placeholder={t("form.countryGlobal")}
                  className={selectClass}
                  rightIcon={selectChevron}
                  showSelectedChipsInPopover={false}
                  selectionSummary="full"
                  disabled={saving || !bulkForm.updateCountry}
                />
              </div>
            </label>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                className={btnOutline}
                onClick={() => {
                  if (saving) return;
                  setBulkOpen(false);
                  setBulkForm(emptyBulkForm());
                }}
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={saving}
                onClick={() => void handleBulkSave()}
              >
                {saving ? t("saving") : t("bulkSave", { count: selectedCount })}
              </button>
            </div>
          </Modal>
        ) : null}

        {open ? (
          <Modal
            title={form.id ? t("edit") : t("add")}
            onClose={() => {
              if (saving) return;
              setOpen(false);
              setForm(emptyForm());
            }}
          >
            <Field label={t("form.name")}>
              <input
                className={inputClass}
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              />
            </Field>

            <Field label={t("form.uom")}>
              <input
                className={inputClass}
                value={form.uom}
                placeholder={t("form.uomPlaceholder")}
                onChange={(e) => setForm((p) => ({ ...p, uom: e.target.value }))}
              />
            </Field>

            <Field label={t("form.country")}>
              <MultiSelect
                options={[
                  { value: "", label: t("form.countryGlobal") },
                  ...countryOptions.map((country) => ({
                    value: country.id,
                    label: country.name,
                  })),
                ]}
                values={form.country_id ? [form.country_id] : []}
                onChange={(next) =>
                  setForm((p) => ({ ...p, country_id: next[0]?.trim() ? next[0] : "" }))
                }
                multi={false}
                placeholder={t("form.countryGlobal")}
                className={selectClass}
                rightIcon={selectChevron}
                showSelectedChipsInPopover={false}
                selectionSummary="full"
                disabled={saving}
              />
            </Field>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                className={btnOutline}
                onClick={() => {
                  if (saving) return;
                  setOpen(false);
                  setForm(emptyForm());
                }}
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={saving}
                onClick={() => void handleSave()}
              >
                {saving ? t("saving") : t("save")}
              </button>
            </div>
          </Modal>
        ) : null}
      </DashboardLayout>
    </RequireAuth>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-80 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40 animate-in fade-in duration-200"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="fertilizer-product-panel-title"
        className="relative z-10 flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl animate-in fade-in zoom-in-95 duration-200"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <h2 id="fertilizer-product-panel-title" className="text-lg font-semibold">
            {title}
          </h2>
          <button type="button" className={btnGhost} onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="space-y-5">{children}</div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
