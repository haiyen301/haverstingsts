"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, Globe2, MapPin, Pencil, Plus, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";
import RequireAuth from "@/features/auth/RequireAuth";
import {
  fetchZones,
  removeZone,
  saveZone,
  type ZoneSetupRow,
} from "@/features/admin/api/adminApi";
import { onForecastFullRebuildMutation } from "@/features/forecasting/forecastDataSync";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { mapRowsToSelectOptions, parseFarmIdCsv } from "@/shared/lib/harvestReferenceData";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { MultiSelect } from "@/shared/ui/multi-select";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";

const inputClass =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";
const btnOutline =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const btnPrimary =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const btnGhost =
  "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const farmSelectTriggerClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm hover:bg-muted/50";

type FormState = {
  id?: number;
  farm_ids: string[];
  is_global: boolean;
  zone_name: string;
};

function emptyForm(): FormState {
  return {
    farm_ids: [],
    is_global: false,
    zone_name: "",
  };
}

function resolveFarmIds(row: ZoneSetupRow): string[] {
  return parseFarmIdCsv(row.farm_id);
}

function resolveFarmNames(row: ZoneSetupRow): string[] {
  const fromArray = Array.isArray(row.farm_names)
    ? row.farm_names.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];
  if (fromArray.length) {
    return fromArray;
  }

  const legacy = String(row.farm_name ?? "").trim();
  if (!legacy || legacy === "All farms") {
    return [];
  }

  if (legacy.includes(",")) {
    return legacy
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }

  return [legacy];
}

function sortRows(rows: ZoneSetupRow[]): ZoneSetupRow[] {
  return [...rows].sort((a, b) => {
    const farmCompare = String(a.farm_name ?? "").localeCompare(String(b.farm_name ?? ""));
    if (farmCompare !== 0) return farmCompare;
    return String(a.zone_name ?? "").localeCompare(String(b.zone_name ?? ""));
  });
}

function formatDateTime(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "-";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function AdminZonesPage() {
  const t = useTranslations("AdminZoneSetup");
  const [rows, setRows] = useState<ZoneSetupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());

  const farms = useHarvestingDataStore((s) => s.farms);
  const bootstrapDone = useHarvestingDataStore((s) => s.bootstrapDone);
  const fetchAllHarvestingReferenceData = useHarvestingDataStore(
    (s) => s.fetchAllHarvestingReferenceData,
  );

  useEffect(() => {
    if (bootstrapDone) return;
    void fetchAllHarvestingReferenceData();
  }, [bootstrapDone, fetchAllHarvestingReferenceData]);

  const farmOptions = useMemo(
    () =>
      mapRowsToSelectOptions(farms as unknown[], "name").map((farm) => ({
        value: farm.id,
        label: farm.label,
      })),
    [farms],
  );

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchZones();
        if (!mounted) return;
        setRows(sortRows(data));
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : "Failed to load zones.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const openCreate = () => {
    setForm(emptyForm());
    setError(null);
    setOpen(true);
  };

  const openEdit = (row: ZoneSetupRow) => {
    const numericId = Number(row.id);
    setForm({
      id: Number.isFinite(numericId) && numericId > 0 ? numericId : undefined,
      farm_ids: resolveFarmIds(row),
      is_global: Boolean(row.is_global),
      zone_name: String(row.zone_name ?? ""),
    });
    setError(null);
    setOpen(true);
  };

  const handleSave = async () => {
    const farmIds = form.farm_ids
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0);
    const zoneName = form.zone_name.trim();

    if ((!form.is_global && farmIds.length === 0) || !zoneName) {
      setError(t("errors.required"));
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const saved = await saveZone({
        id: form.id,
        farm_id: form.is_global ? undefined : form.farm_ids.join(","),
        is_global: form.is_global,
        zone_name: zoneName,
      });
      setRows((prev) => {
        const next = prev.filter((row) => Number(row.id) !== Number(saved.id));
        return sortRows([...next, saved]);
      });
      await fetchAllHarvestingReferenceData(true);
      setOpen(false);
      setForm(emptyForm());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save zone.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: ZoneSetupRow) => {
    const id = Number(row.id);
    if (!Number.isFinite(id) || id <= 0) return;
    if (!window.confirm(`${t("deleteConfirm")} ${row.zone_name}?`)) return;

    try {
      setSaving(true);
      setError(null);
      await removeZone(id);
      setRows((prev) => prev.filter((item) => Number(item.id) !== id));
      await fetchAllHarvestingReferenceData(true);
      toast.success(t("notices.deletedRebuildQueuedFull"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
        autoClose: 10000,
      });
      onForecastFullRebuildMutation();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete zone.");
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
            <button type="button" className={btnPrimary} onClick={openCreate}>
              <Plus className="h-4 w-4" />
              {t("addZone")}
            </button>
          </div>

          {loading ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : null}
          {error && !open ? <p className="text-sm text-destructive">{error}</p> : null}

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-4 py-3 text-left font-medium">{t("table.scope")}</th>
                      <th className="px-4 py-3 text-left font-medium">{t("table.farm")}</th>
                      <th className="px-4 py-3 text-left font-medium">{t("table.zoneName")}</th>
                      <th className="px-4 py-3 text-left font-medium">{t("table.createdBy")}</th>
                      <th className="px-4 py-3 text-left font-medium">{t("table.updatedAt")}</th>
                      <th className="px-4 py-3 text-right font-medium">{t("table.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={`${row.id}-${row.zone_name}`} className="border-b border-border last:border-b-0">
                        <td className="px-4 py-3 align-top">
                          <ScopeBadge row={row} t={t} />
                        </td>
                        <td className="px-4 py-3 align-top">
                          <FarmCoverageCell row={row} t={t} />
                        </td>
                        <td className="px-4 py-3 align-top font-medium">{row.zone_name}</td>
                        <td className="px-4 py-3 align-top">{row.created_by_name ?? "-"}</td>
                        <td className="px-4 py-3 align-top">{formatDateTime(row.updated_at)}</td>
                        <td className="px-4 py-3 align-top">
                          <div className="flex items-center justify-end gap-1">
                            <button type="button" className={btnGhost} onClick={() => openEdit(row)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className={cn(btnGhost, "text-destructive")}
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
                        <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
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
            title={form.id ? t("editZone") : t("addZone")}
            onClose={() => {
              if (saving) return;
              setOpen(false);
              setForm(emptyForm());
            }}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t("form.scopeRequired")}>
                <select
                  className={inputClass}
                  value={form.is_global ? "all" : "farm"}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      is_global: e.target.value === "all",
                      farm_ids: e.target.value === "all" ? [] : prev.farm_ids,
                    }))
                  }
                >
                  <option value="farm">{t("scope.selectedFarms")}</option>
                  <option value="all">{t("scope.allFarms")}</option>
                </select>
              </Field>

              <Field label={t("form.zoneNameRequired")}>
                <input
                  className={inputClass}
                  value={form.zone_name}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, zone_name: e.target.value }))
                  }
                  placeholder={t("form.zoneNamePlaceholder")}
                />
              </Field>

              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">
                  {form.is_global ? t("form.farmOptional") : t("form.farmsRequired")}
                </label>
                {form.is_global ? (
                  <div className="flex items-start gap-3 rounded-lg border border-sky-200/80 bg-sky-50/70 px-4 py-3 text-sm text-sky-900 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-100">
                    <Globe2 className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-medium">{t("form.allFarmsSelected")}</p>
                      <p className="mt-1 text-xs text-sky-800/80 dark:text-sky-200/80">
                        {t("form.allFarmsHint")}
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">{t("form.farmsHint")}</p>
                    <MultiSelect
                      options={farmOptions}
                      values={form.farm_ids}
                      onChange={(next) => setForm((prev) => ({ ...prev, farm_ids: next }))}
                      placeholder={t("form.selectFarms")}
                      showFullSelectedLabels
                      className={farmSelectTriggerClass}
                      rightIcon={<ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
                    />
                    {form.farm_ids.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {form.farm_ids.map((farmId) => {
                          const label =
                            farmOptions.find((farm) => farm.value === farmId)?.label ?? farmId;
                          return (
                            <span
                              key={farmId}
                              className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-100"
                            >
                              {label}
                            </span>
                          );
                        })}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

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

function ScopeBadge({
  row,
  t,
}: {
  row: ZoneSetupRow;
  t: ReturnType<typeof useTranslations<"AdminZoneSetup">>;
}) {
  if (row.is_global) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-500/15 dark:text-sky-200">
        <Globe2 className="h-3 w-3" />
        {t("scope.allFarms")}
      </span>
    );
  }

  const farmCount = resolveFarmIds(row).length || resolveFarmNames(row).length;
  const label =
    farmCount > 1
      ? t("scope.multipleFarms", { count: farmCount })
      : t("scope.singleFarm");

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200">
      <MapPin className="h-3 w-3" />
      {label}
    </span>
  );
}

function FarmCoverageCell({
  row,
  t,
}: {
  row: ZoneSetupRow;
  t: ReturnType<typeof useTranslations<"AdminZoneSetup">>;
}) {
  if (row.is_global) {
    return (
      <div className="space-y-1">
        <p className="font-medium text-foreground">{t("scope.allFarms")}</p>
        <p className="text-xs text-muted-foreground">{t("table.allFarmsHint")}</p>
      </div>
    );
  }

  const farmNames = resolveFarmNames(row);
  if (farmNames.length === 0) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <div className="flex max-w-md flex-wrap gap-1.5">
      {farmNames.map((name) => (
        <span
          key={`${row.id}-${name}`}
          className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-0.5 text-xs font-medium text-foreground shadow-sm"
        >
          {name}
        </span>
      ))}
    </div>
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
        <CardContent className="space-y-5 p-6">
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
