"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import RequireAuth from "@/features/auth/RequireAuth";
import {
  fetchProjectPaces,
  removeProjectPace,
  saveProjectPace,
  sortProjectPaceRows,
  type ProjectPaceRow,
} from "@/features/admin/api/adminApi";
import {
  estimatePaceDurationWeeks,
  estimateTotalHarvestBatches,
  projectPaceConfigFromRow,
  WEEKS_PER_MONTH,
} from "@/features/project/lib/generatePlannedHarvestsForNewProject";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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
  pace_key: string;
  title: string;
  duration_months: string;
  harvest_batches: string;
  harvest_every_weeks: string;
};

function emptyForm(): FormState {
  return {
    pace_key: "",
    title: "",
    duration_months: "6",
    harvest_batches: "1",
    harvest_every_weeks: "1",
  };
}

function normalizePaceKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function formatHarvestCadence(row: ProjectPaceRow): string {
  return `${row.harvest_batches} / ${row.harvest_every_weeks}`;
}

export default function AdminProjectPacesPage() {
  const t = useTranslations("AdminProjectPaces");
  const [rows, setRows] = useState<ProjectPaceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());

  const formPlanPreview = useMemo(() => {
    const durationMonths = Number.parseInt(form.duration_months, 10);
    const harvestBatches = Number.parseInt(form.harvest_batches, 10);
    const harvestEveryWeeks = Number.parseInt(form.harvest_every_weeks, 10);
    if (
      !Number.isFinite(durationMonths) ||
      durationMonths <= 0 ||
      !Number.isFinite(harvestBatches) ||
      harvestBatches <= 0 ||
      !Number.isFinite(harvestEveryWeeks) ||
      harvestEveryWeeks <= 0
    ) {
      return null;
    }
    const config = projectPaceConfigFromRow({
      id: 0,
      pace_key: "",
      title: "",
      duration_months: durationMonths,
      harvest_batches: harvestBatches,
      harvest_every_weeks: harvestEveryWeeks,
    });
    return {
      months: durationMonths,
      weeks: estimatePaceDurationWeeks(config),
      harvestBatches,
      harvestEveryWeeks,
      totalBatches: estimateTotalHarvestBatches(config),
    };
  }, [form.duration_months, form.harvest_batches, form.harvest_every_weeks]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchProjectPaces();
      setRows(sortProjectPaceRows(data));
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

  const openEdit = (row: ProjectPaceRow) => {
    setForm({
      id: Number(row.id),
      pace_key: String(row.pace_key ?? ""),
      title: String(row.title ?? ""),
      duration_months: String(row.duration_months ?? ""),
      harvest_batches: String(row.harvest_batches ?? ""),
      harvest_every_weeks: String(row.harvest_every_weeks ?? ""),
    });
    setError(null);
    setOpen(true);
  };

  const handleSave = async () => {
    const paceKey = normalizePaceKey(form.pace_key);
    const title = form.title.trim();
    const durationMonths = Number.parseInt(form.duration_months, 10);
    const harvestBatches = Number.parseInt(form.harvest_batches, 10);
    const harvestEveryWeeks = Number.parseInt(form.harvest_every_weeks, 10);

    if (!paceKey) {
      setError(t("errors.paceKeyRequired"));
      return;
    }
    if (!title) {
      setError(t("errors.titleRequired"));
      return;
    }
    if (!Number.isFinite(durationMonths) || durationMonths <= 0) {
      setError(t("errors.durationInvalid"));
      return;
    }
    if (!Number.isFinite(harvestBatches) || harvestBatches <= 0) {
      setError(t("errors.batchesInvalid"));
      return;
    }
    if (!Number.isFinite(harvestEveryWeeks) || harvestEveryWeeks <= 0) {
      setError(t("errors.weeksInvalid"));
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const existing = form.id
        ? rows.find((r) => Number(r.id) === Number(form.id))
        : undefined;
      const saved = await saveProjectPace({
        id: form.id,
        pace_key: paceKey,
        title,
        duration_months: durationMonths,
        harvest_batches: harvestBatches,
        harvest_every_weeks: harvestEveryWeeks,
        sort_order: Number(existing?.sort_order ?? 0),
      });
      setRows((prev) => {
        const next = form.id
          ? prev.map((r) => (Number(r.id) === Number(saved.id) ? saved : r))
          : [...prev, saved];
        return sortProjectPaceRows(next);
      });
      setOpen(false);
      setForm(emptyForm());
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.save"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: ProjectPaceRow) => {
    const id = Number(row.id);
    if (!Number.isFinite(id) || id <= 0) return;
    if (!window.confirm(t("deleteConfirm"))) return;
    try {
      setSaving(true);
      setError(null);
      await removeProjectPace(id);
      setRows((prev) => prev.filter((r) => Number(r.id) !== id));
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

          {loading ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-4 py-3 text-left font-medium">{t("table.key")}</th>
                      <th className="px-4 py-3 text-left font-medium">{t("table.title")}</th>
                      <th className="px-4 py-3 text-left font-medium">{t("table.months")}</th>
                      <th className="px-4 py-3 text-left font-medium">{t("table.harvestCadence")}</th>
                      <th className="px-4 py-3 text-right font-medium">{t("table.totalWeeks")}</th>
                      <th className="px-4 py-3 text-right font-medium">{t("table.totalBatches")}</th>
                      <th className="px-4 py-3 text-right font-medium">{t("table.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr
                        key={row.id}
                        className="border-b border-border last:border-b-0 transition-colors hover:bg-muted/30"
                      >
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                          {row.pace_key}
                        </td>
                        <td className="px-4 py-3 font-medium">{row.title}</td>
                        <td className="px-4 py-3">{row.duration_months}</td>
                        <td className="px-4 py-3">
                          {formatHarvestCadence(row)}{" "}
                          <span className="text-muted-foreground">{t("table.weeksUnit")}</span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {(() => {
                            const paceConfig = projectPaceConfigFromRow(row);
                            const weeks = estimatePaceDurationWeeks(paceConfig);
                            return (
                              <>
                                <span className="font-medium">
                                  {weeks}{" "}
                                  <span className="font-normal text-muted-foreground">
                                    {t("table.weeksUnit")}
                                  </span>
                                </span>
                                <span className="mt-0.5 block text-xs text-muted-foreground">
                                  {t("table.totalWeeksFormula", {
                                    months: row.duration_months,
                                    weeksPerMonth: WEEKS_PER_MONTH,
                                  })}
                                </span>
                              </>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {(() => {
                            const paceConfig = projectPaceConfigFromRow(row);
                            const totalBatches =
                              estimateTotalHarvestBatches(paceConfig);
                            return (
                              <>
                                <span className="font-medium">{totalBatches}</span>
                                <span className="mt-0.5 block text-xs text-muted-foreground">
                                  {t("table.totalBatchesFormula", {
                                    weeks: estimatePaceDurationWeeks(paceConfig),
                                    harvestBatches: row.harvest_batches,
                                    harvestEveryWeeks: row.harvest_every_weeks,
                                  })}
                                </span>
                              </>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              className={btnGhost}
                              disabled={saving}
                              onClick={() => openEdit(row)}
                            >
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
                        <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
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
            <Field label={t("form.key")}>
              <input
                className={inputClass}
                value={form.pace_key}
                onChange={(e) =>
                  setForm((p) => ({ ...p, pace_key: e.target.value }))
                }
                placeholder={t("form.keyPlaceholder")}
                disabled={Boolean(form.id)}
              />
              {form.id ? (
                <p className="text-xs text-muted-foreground">{t("form.keyLockedHint")}</p>
              ) : null}
            </Field>
            <Field label={t("form.title")}>
              <input
                className={inputClass}
                value={form.title}
                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              />
            </Field>
            <Field label={t("form.months")}>
              <input
                className={inputClass}
                type="number"
                min={1}
                value={form.duration_months}
                onChange={(e) =>
                  setForm((p) => ({ ...p, duration_months: e.target.value }))
                }
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("form.harvestBatches")}>
                <input
                  className={inputClass}
                  type="number"
                  min={1}
                  value={form.harvest_batches}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, harvest_batches: e.target.value }))
                  }
                />
              </Field>
              <Field label={t("form.harvestEveryWeeks")}>
                <input
                  className={inputClass}
                  type="number"
                  min={1}
                  value={form.harvest_every_weeks}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, harvest_every_weeks: e.target.value }))
                  }
                />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">{t("form.harvestHint")}</p>
            {formPlanPreview ? (
              <div className="space-y-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                <p>
                  {t("form.weeksPreview", {
                    months: formPlanPreview.months,
                    weeksPerMonth: WEEKS_PER_MONTH,
                    weeks: formPlanPreview.weeks,
                  })}
                </p>
                <p className="font-medium text-foreground">
                  {t("form.batchesPreview", {
                    weeks: formPlanPreview.weeks,
                    harvestBatches: formPlanPreview.harvestBatches,
                    harvestEveryWeeks: formPlanPreview.harvestEveryWeeks,
                    totalBatches: formPlanPreview.totalBatches,
                  })}
                </p>
              </div>
            ) : null}

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
  return (
    <div className="fixed inset-0 z-80 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-lg">
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
