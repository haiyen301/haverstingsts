"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import RequireAuth from "@/features/auth/RequireAuth";
import {
  fetchFarms,
  removeFarm,
  saveFarm,
  type FarmRow,
} from "@/features/admin/api/adminApi";
import { fetchActiveCountries } from "@/features/admin/api/countriesApi";
import { buildCountrySelectOptions } from "@/shared/lib/harvestReferenceData";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";

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
  name: string;
  country_id: string;
  address: string;
  hotline: string;
};

function emptyForm(): FormState {
  return { name: "", country_id: "", address: "", hotline: "" };
}

function cellText(value: string | null | undefined): string {
  const s = String(value ?? "").trim();
  return s || "—";
}

export default function AdminFarmsPage() {
  const t = useTranslations("AdminFarms");
  const [rows, setRows] = useState<FarmRow[]>([]);
  const [countries, setCountries] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const fetchAllHarvestingReferenceData = useHarvestingDataStore(
    (s) => s.fetchAllHarvestingReferenceData,
  );

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [farmData, countryData] = await Promise.all([fetchFarms(), fetchActiveCountries()]);
      setRows(farmData);
      setCountries(countryData);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.load"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const countryOptions = useMemo(
    () =>
      buildCountrySelectOptions(countries, form.country_id || null).sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      ),
    [countries, form.country_id],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const hay = [
        row.id,
        row.name,
        row.country_name,
        row.address,
        row.hotline,
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

  const openEdit = (row: FarmRow) => {
    setForm({
      id: Number(row.id),
      name: String(row.name ?? ""),
      country_id: String(row.country_id ?? ""),
      address: String(row.address ?? ""),
      hotline: String(row.hotline ?? ""),
    });
    setError(null);
    setOpen(true);
  };

  const handleSave = async () => {
    const name = form.name.trim();
    const countryId = Number(form.country_id);
    if (!name) {
      setError(t("errors.nameRequired"));
      return;
    }
    if (!Number.isFinite(countryId) || countryId <= 0) {
      setError(t("errors.countryRequired"));
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const saved = await saveFarm({
        id: form.id,
        name,
        country_id: countryId,
        address: form.address.trim() || null,
        hotline: form.hotline.trim() || null,
      });
      setRows((prev) => {
        const idx = prev.findIndex((r) => Number(r.id) === Number(saved.id));
        if (idx < 0) {
          return [...prev, saved].sort((a, b) => Number(a.id) - Number(b.id));
        }
        const next = [...prev];
        next[idx] = saved;
        return next.sort((a, b) => Number(a.id) - Number(b.id));
      });
      setOpen(false);
      setForm(emptyForm());
      void fetchAllHarvestingReferenceData();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.save"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: FarmRow) => {
    const id = Number(row.id);
    if (!Number.isFinite(id) || id <= 0) return;
    if (!window.confirm(t("deleteConfirm"))) return;
    try {
      setSaving(true);
      setError(null);
      await removeFarm(id);
      setRows((prev) => prev.filter((r) => Number(r.id) !== id));
      void fetchAllHarvestingReferenceData();
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
                      <th className="px-4 py-3 text-left font-medium">{t("table.farm")}</th>
                      <th className="px-4 py-3 text-left font-medium">{t("table.country")}</th>
                      <th className="px-4 py-3 text-right font-medium">{t("table.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => (
                      <tr key={row.id} className="border-b border-border last:border-b-0">
                        <td className="px-4 py-3 text-muted-foreground">{row.id}</td>
                        <td className="px-4 py-3 font-medium">{cellText(row.name)}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {cellText(row.country_name)}
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
                    {!loading && filtered.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
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
            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label={t("form.name")}>
                  <input
                    className={inputClass}
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label={t("form.country")}>
                  <select
                    className={inputClass}
                    value={form.country_id}
                    onChange={(e) => setForm((p) => ({ ...p, country_id: e.target.value }))}
                  >
                    <option value="">{t("form.countryPlaceholder")}</option>
                    {countryOptions.map((country) => (
                      <option key={country.id} value={country.id}>
                        {country.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label={t("form.address")}>
                <input
                  className={inputClass}
                  value={form.address}
                  onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
                />
              </Field>
              <Field label={t("form.hotline")}>
                <input
                  className={inputClass}
                  value={form.hotline}
                  onChange={(e) => setForm((p) => ({ ...p, hotline: e.target.value }))}
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
