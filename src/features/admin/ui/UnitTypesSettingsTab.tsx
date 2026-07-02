"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";

import {
  fetchAdminUnitTypes,
  removeAdminUnitType,
  saveAdminUnitType,
  type UnitTypeRow,
} from "@/features/admin/api/unitTypesApi";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
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
  unit_type_id?: number;
  unit_code: string;
  unit_name: string;
  unit_symbol: string;
  order: string;
  display: boolean;
  note: string;
};

function emptyForm(): FormState {
  return {
    unit_code: "",
    unit_name: "",
    unit_symbol: "",
    order: "",
    display: true,
    note: "",
  };
}

function cellText(value: string | number | null | undefined): string {
  const s = String(value ?? "").trim();
  return s || "—";
}

function isDisplayTruthy(value: UnitTypeRow["display"]): boolean {
  return value === true || value === 1 || String(value) === "1";
}

function rowToForm(row: UnitTypeRow): FormState {
  return {
    unit_type_id: Number(row.unit_type_id),
    unit_code: String(row.unit_code ?? ""),
    unit_name: String(row.unit_name ?? ""),
    unit_symbol: String(row.unit_symbol ?? ""),
    order: row.order != null ? String(row.order) : "",
    display: isDisplayTruthy(row.display),
    note: String(row.note ?? ""),
  };
}

export function UnitTypesSettingsTab() {
  const t = useTranslations("AdminUnitTypes");
  const { canCreate, canEdit, canDelete } = useModuleAccess("admin_units");
  const [rows, setRows] = useState<UnitTypeRow[]>([]);
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
      const data = await fetchAdminUnitTypes();
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
    if (!q) return rows;
    return rows.filter((row) => {
      const hay = [row.unit_type_id, row.unit_code, row.unit_name, row.unit_symbol, row.note]
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

  const openEdit = (row: UnitTypeRow) => {
    setForm(rowToForm(row));
    setError(null);
    setOpen(true);
  };

  const handleSave = async () => {
    const unitName = form.unit_name.trim();
    if (!unitName) {
      setError(t("errors.nameRequired"));
      return;
    }
    const orderRaw = form.order.trim();
    const order = orderRaw !== "" ? Number(orderRaw) : 0;
    if (orderRaw !== "" && !Number.isFinite(order)) {
      setError(t("errors.orderInvalid"));
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const saved = await saveAdminUnitType({
        unit_type_id: form.unit_type_id,
        unit_code: form.unit_code.trim() || undefined,
        unit_name: unitName,
        unit_symbol: form.unit_symbol.trim() || undefined,
        order,
        display: form.display,
        note: form.note.trim() || undefined,
      });
      setRows((prev) => {
        const idx = prev.findIndex((r) => Number(r.unit_type_id) === Number(saved.unit_type_id));
        if (idx < 0) {
          return [...prev, saved].sort(
            (a, b) =>
              Number(a.order ?? 0) - Number(b.order ?? 0) ||
              String(a.unit_name).localeCompare(String(b.unit_name)),
          );
        }
        const next = [...prev];
        next[idx] = saved;
        return next.sort(
          (a, b) =>
            Number(a.order ?? 0) - Number(b.order ?? 0) ||
            String(a.unit_name).localeCompare(String(b.unit_name)),
        );
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

  const handleDelete = async (row: UnitTypeRow) => {
    const id = Number(row.unit_type_id);
    if (!Number.isFinite(id) || id <= 0) return;
    if (!window.confirm(t("deleteConfirm"))) return;
    try {
      setSaving(true);
      setError(null);
      await removeAdminUnitType(id);
      setRows((prev) => prev.filter((r) => Number(r.unit_type_id) !== id));
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
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="w-20 px-4 py-3 text-left font-medium">{t("table.id")}</th>
                  <th className="px-4 py-3 text-left font-medium">{t("table.code")}</th>
                  <th className="px-4 py-3 text-left font-medium">{t("table.name")}</th>
                  <th className="px-4 py-3 text-left font-medium">{t("table.symbol")}</th>
                  <th className="px-4 py-3 text-left font-medium">{t("table.order")}</th>
                  <th className="px-4 py-3 text-left font-medium">{t("table.display")}</th>
                  <th className="px-4 py-3 text-right font-medium">{t("table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.unit_type_id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-3 text-muted-foreground">{row.unit_type_id}</td>
                    <td className="px-4 py-3 text-muted-foreground">{cellText(row.unit_code)}</td>
                    <td className="px-4 py-3 font-medium">{cellText(row.unit_name)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{cellText(row.unit_symbol)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{cellText(row.order)}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {isDisplayTruthy(row.display) ? t("table.yes") : t("table.no")}
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
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-background p-6 shadow-lg">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {form.unit_type_id ? t("editTitle") : t("createTitle")}
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
                  value={form.unit_name}
                  onChange={(e) => setForm((f) => ({ ...f, unit_name: e.target.value }))}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">{t("form.code")}</span>
                <input
                  className={inputClass}
                  value={form.unit_code}
                  onChange={(e) => setForm((f) => ({ ...f, unit_code: e.target.value }))}
                  placeholder={t("form.codePlaceholder")}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">{t("form.symbol")}</span>
                <input
                  className={inputClass}
                  value={form.unit_symbol}
                  onChange={(e) => setForm((f) => ({ ...f, unit_symbol: e.target.value }))}
                  placeholder={t("form.symbolPlaceholder")}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">{t("form.order")}</span>
                <input
                  className={inputClass}
                  type="number"
                  value={form.order}
                  onChange={(e) => setForm((f) => ({ ...f, order: e.target.value }))}
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.display}
                  onChange={(e) => setForm((f) => ({ ...f, display: e.target.checked }))}
                />
                <span className="text-sm">{t("form.display")}</span>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">{t("form.note")}</span>
                <textarea
                  className={cn(inputClass, "min-h-[72px] py-2")}
                  rows={2}
                  value={form.note}
                  onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                />
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
