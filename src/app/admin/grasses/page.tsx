"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";
import RequireAuth from "@/features/auth/RequireAuth";
import {
  fetchGrassTypes,
  removeGrassType,
  saveGrassType,
  type GrassTypeRow,
} from "@/features/admin/api/adminApi";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import {
  grassCatalogMutationAffectsForecast,
  onGrassCatalogForecastMutation,
} from "@/features/forecasting/forecastDataSync";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";
import { DatePicker } from "@/shared/ui/date-picker";

const inputClass =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";
const btnOutline =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const btnPrimary =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const btnGhost =
  "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type FormState = {
  id?: number;
  title: string;
  country: string;
  description: string;
  sales_from: string;
  sales_to: string;
};

function emptyForm(): FormState {
  return { title: "", country: "", description: "", sales_from: "", sales_to: "" };
}

/** Empty DB date / sentinel → blank for `<input type="date">` and DatePicker. */
function parseGrassDateInput(v: string | null | undefined): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (s.startsWith("0000-00-00")) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return "";
}

function formatDateCell(v: string | null | undefined): string {
  const d = parseGrassDateInput(v);
  return d === "" ? "—" : d;
}

function truncatePlainText(raw: string | null | undefined, maxLen: number): string {
  const s = String(raw ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "—";
  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(0, maxLen - 1))}…`;
}

const INACTIVE_STATUS_VALUES = new Set(["inactive", "0", "false", "disabled"]);

function isGrassActive(status: string | null | undefined): boolean {
  const s = String(status ?? "active").trim().toLowerCase();
  return !INACTIVE_STATUS_VALUES.has(s);
}

function notifyGrassForecastRebuildQueued(t: (key: string) => string): void {
  toast.success(t("notices.savedRebuildQueued"), {
    containerId: TOAST_CONTAINER_TOP_RIGHT,
    autoClose: 10000,
  });
  onGrassCatalogForecastMutation();
}

export default function AdminGrassesPage() {
  const t = useTranslations("AdminGrasses");
  const [rows, setRows] = useState<GrassTypeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [statusPendingId, setStatusPendingId] = useState<number | null>(null);
  const fetchAllHarvestingReferenceData = useHarvestingDataStore(
    (s) => s.fetchAllHarvestingReferenceData,
  );

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchGrassTypes();
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

  const openCreate = () => {
    setForm(emptyForm());
    setError(null);
    setOpen(true);
  };

  const openEdit = (row: GrassTypeRow) => {
    setForm({
      id: Number(row.id),
      title: String(row.title ?? ""),
      country: String(row.country ?? ""),
      description: String(row.description ?? ""),
      sales_from: parseGrassDateInput(row.sales_from),
      sales_to: parseGrassDateInput(row.sales_to),
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
      const saved = await saveGrassType({
        id: form.id,
        title,
        country: form.country.trim() || null,
        description: form.description.trim() || null,
        sales_from: form.sales_from.trim() || null,
        sales_to: form.sales_to.trim() || null,
      });
      setRows((prev) => {
        const idx = prev.findIndex((r) => Number(r.id) === Number(saved.id));
        if (idx < 0) {
          return [...prev, saved].sort((a, b) => String(a.title).localeCompare(String(b.title)));
        }
        const next = [...prev];
        next[idx] = saved;
        return next.sort((a, b) => String(a.title).localeCompare(String(b.title)));
      });
      setOpen(false);
      setForm(emptyForm());
      void fetchAllHarvestingReferenceData(true);
      const existing = form.id
        ? rows.find((r) => Number(r.id) === Number(form.id)) ?? null
        : null;
      const afterCatalog = {
        status: existing?.status ?? "active",
        sales_from: form.sales_from.trim() || null,
        sales_to: form.sales_to.trim() || null,
      };
      if (
        grassCatalogMutationAffectsForecast(
          existing
            ? {
                status: existing.status,
                sales_from: existing.sales_from,
                sales_to: existing.sales_to,
              }
            : null,
          afterCatalog,
        )
      ) {
        notifyGrassForecastRebuildQueued(t);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.save"));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (row: GrassTypeRow) => {
    const id = Number(row.id);
    if (!Number.isFinite(id) || id <= 0) return;
    const nextStatus = isGrassActive(row.status) ? "inactive" : "active";
    try {
      setStatusPendingId(id);
      setError(null);
      const saved = await saveGrassType({
        id,
        title: String(row.title ?? ""),
        country: row.country ?? null,
        description: row.description ?? null,
        sales_from: row.sales_from ?? null,
        sales_to: row.sales_to ?? null,
        status: nextStatus,
      });
      setRows((prev) => {
        const next = prev.map((r) => (Number(r.id) === id ? saved : r));
        return next.sort((a, b) => String(a.title).localeCompare(String(b.title)));
      });
      void fetchAllHarvestingReferenceData(true);
      notifyGrassForecastRebuildQueued(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.statusToggle"));
    } finally {
      setStatusPendingId(null);
    }
  };

  const handleDelete = async (row: GrassTypeRow) => {
    const id = Number(row.id);
    if (!Number.isFinite(id) || id <= 0) return;
    if (!window.confirm(t("deleteConfirm"))) return;
    try {
      setSaving(true);
      setError(null);
      await removeGrassType(id);
      setRows((prev) => prev.filter((r) => Number(r.id) !== id));
      void fetchAllHarvestingReferenceData(true);
      notifyGrassForecastRebuildQueued(t);
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
            </div>
            <button type="button" className={btnPrimary} onClick={openCreate}>
              <Plus className="h-4 w-4" />
              {t("add")}
            </button>
          </div>

          {loading ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-4 py-3 text-left font-medium">{t("table.title")}</th>
                      {/* <th className="px-4 py-3 text-left font-medium">{t("table.country")}</th>
                      <th className="min-w-[140px] px-4 py-3 text-left font-medium">
                        {t("table.description")}
                      </th> */}
                      <th className="px-4 py-3 text-left font-medium whitespace-nowrap">
                        {t("table.salesFrom")}
                      </th>
                      <th className="px-4 py-3 text-left font-medium whitespace-nowrap">
                        {t("table.salesTo")}
                      </th>
                      <th className="px-4 py-3 text-left font-medium whitespace-nowrap">
                        {t("table.status")}
                      </th>
                      <th className="px-4 py-3 text-right font-medium">{t("table.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-b border-border last:border-b-0">
                        <td className="px-4 py-3 font-medium">{row.title}</td>
                        {/* <td className="px-4 py-3 text-muted-foreground">
                          {row.country?.trim() ? row.country : "—"}
                        </td>
                        <td className="max-w-[220px] px-4 py-3 text-muted-foreground">
                          <span className="line-clamp-2" title={row.description ?? undefined}>
                            {truncatePlainText(row.description, 120)}
                          </span>
                        </td> */}
                        <td className="px-4 py-3 whitespace-nowrap">{formatDateCell(row.sales_from)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{formatDateCell(row.sales_to)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              role="switch"
                              aria-checked={isGrassActive(row.status)}
                              className={cn(
                                "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                isGrassActive(row.status)
                                  ? "bg-lime-500"
                                  : "bg-muted-foreground/40",
                                (saving || statusPendingId === Number(row.id)) &&
                                  "cursor-not-allowed opacity-60",
                              )}
                              disabled={saving || statusPendingId === Number(row.id)}
                              onClick={() => void handleToggleStatus(row)}
                            >
                              <span
                                className={cn(
                                  "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                                  isGrassActive(row.status) ? "translate-x-5" : "translate-x-1",
                                )}
                              />
                            </button>
                            <span
                              className={cn(
                                "text-xs font-medium",
                                isGrassActive(row.status)
                                  ? "text-foreground"
                                  : "text-muted-foreground",
                              )}
                            >
                              {statusPendingId === Number(row.id)
                                ? t("saving")
                                : isGrassActive(row.status)
                                  ? t("status.active")
                                  : t("status.inactive")}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button type="button" className={btnGhost} onClick={() => openEdit(row)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
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
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!loading && rows.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
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

        {open ? (
          <Modal
            title={form.id ? t("edit") : t("add")}
            onClose={() => {
              if (saving) return;
              setOpen(false);
              setForm(emptyForm());
            }}
          >
            <p className="text-xs text-muted-foreground sm:col-span-2">
              {t("form.commercialWindowHint")}
            </p>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label={t("form.title")}>
                  <input
                    className={inputClass}
                    value={form.title}
                    onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                  />
                </Field>
              </div>
              {/* <Field label={t("form.country")}>
                <input
                  className={inputClass}
                  value={form.country}
                  onChange={(e) => setForm((p) => ({ ...p, country: e.target.value }))}
                />
              </Field> */}

              {/* <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">{t("form.description")}</label>
                <textarea
                  className={cn(inputClass, "min-h-[88px] resize-y py-2")}
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  rows={4}
                />
              </div> */}

              <Field label={t("form.salesFrom")}>
                <DatePicker
                  value={form.sales_from}
                  onChange={(v) => setForm((p) => ({ ...p, sales_from: v }))}
                  placeholder={t("form.datePlaceholder")}
                  disabled={saving}
                />
              </Field>
              <Field label={t("form.salesTo")}>
                <DatePicker
                  value={form.sales_to}
                  onChange={(v) => setForm((p) => ({ ...p, sales_to: v }))}
                  placeholder={t("form.datePlaceholder")}
                  disabled={saving}
                />
              </Field>
            </div>

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
              <button type="button" className={btnPrimary} disabled={saving} onClick={() => void handleSave()}>
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
  return (
    <div className="fixed inset-0 z-80 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-2xl">
        <CardContent className="max-h-[90vh] space-y-5 overflow-y-auto p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{title}</h2>
            <button type="button" className={btnGhost} onClick={onClose}>
              <X className="h-4 w-4" />
            </button>
          </div>
          {children}
        </CardContent>
      </Card>
    </div>
  );
}
