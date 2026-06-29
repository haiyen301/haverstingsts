"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CloudRain, Droplets, CalendarDays, HelpCircle, Plus, Trash2, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  fetchRainfallConfiguredFarms,
  fetchRainfallDashboard,
  removeRainfallManual,
  saveRainfallManual,
  type RainfallDashboardData,
  type RainfallRecentEntry,
} from "@/features/dashboard/api/rainfallApi";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";

type FarmFilter = {
  farmId: string;
  farmName: string;
};

type RainfallSectionProps = {
  farmFilters: FarmFilter[];
  selectedFarmIds: string[];
  scopeFarmIds: string[] | null;
};

function StatBox({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ElementType;
}) {
  return (
    <div className="glass-card rounded-xl p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-info/10">
          <Icon className="h-4 w-4 text-info" />
        </div>
      </div>
      <p className="font-heading text-2xl font-bold text-foreground">{value}</p>
      <span className="text-xs text-muted-foreground">{sub}</span>
    </div>
  );
}

function formatDisplayDate(date: string): string {
  if (!date) return "—";
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function RainfallSourceHint({
  entry,
  manualLabel,
  autoLabel,
  manualWithAutoLabel,
  ariaLabel,
}: {
  entry: RainfallRecentEntry;
  manualLabel: string;
  autoLabel: string;
  manualWithAutoLabel: (values: { mm: string }) => string;
  ariaLabel: string;
}) {
  const isManual = entry.source === "manual";
  const tooltipText =
    isManual && entry.open_meteo_mm != null
      ? manualWithAutoLabel({ mm: String(entry.open_meteo_mm) })
      : isManual
        ? manualLabel
        : autoLabel;

  return (
    <span className="group relative inline-flex shrink-0">
      <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" aria-label={ariaLabel} />
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full right-0 z-20 mb-1.5 hidden w-max max-w-[14rem] rounded-md border border-border bg-popover px-2 py-1.5 text-[11px] font-normal normal-case leading-snug text-popover-foreground shadow-md group-hover:block"
      >
        {tooltipText}
      </span>
    </span>
  );
}

export function RainfallSection({ farmFilters, selectedFarmIds, scopeFarmIds }: RainfallSectionProps) {
  const t = useTranslations("Dashboard.rainfall");
  const year = new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10);
  const monthLabel = new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const [configuredFarms, setConfiguredFarms] = useState<FarmFilter[]>([]);
  const [data, setData] = useState<RainfallDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState(today);
  const [formFarmId, setFormFarmId] = useState("");
  const [mm, setMm] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editMm, setEditMm] = useState("");

  const entryKey = (entry: RainfallRecentEntry) => `${entry.farm_id}|${entry.date}`;

  const rainfallFarmFilters = useMemo(() => {
    if (configuredFarms.length > 0) return configuredFarms;
    return farmFilters;
  }, [configuredFarms, farmFilters]);

  const visibleFarms = useMemo(() => {
    let list = rainfallFarmFilters;
    if (scopeFarmIds?.length) {
      const allowed = new Set(scopeFarmIds);
      list = list.filter((f) => allowed.has(f.farmId));
    }
    if (selectedFarmIds.length > 0) {
      const selected = new Set(selectedFarmIds);
      list = list.filter((f) => selected.has(f.farmId));
    }
    return list;
  }, [rainfallFarmFilters, scopeFarmIds, selectedFarmIds]);

  const queryFarmIds = useMemo(
    () => (selectedFarmIds.length > 0 ? selectedFarmIds : visibleFarms.map((f) => f.farmId)),
    [selectedFarmIds, visibleFarms],
  );

  const titleSuffix = useMemo(() => {
    if (selectedFarmIds.length > 0) {
      const names = selectedFarmIds
        .map((id) => visibleFarms.find((f) => f.farmId === id)?.farmName ?? id)
        .filter(Boolean);
      return names.join(", ");
    }
    if (scopeFarmIds?.length) {
      return visibleFarms.map((f) => f.farmName).join(", ");
    }
    return t("allFarms");
  }, [selectedFarmIds, scopeFarmIds, visibleFarms, t]);

  const formFarmOptions = useMemo(() => {
    if (selectedFarmIds.length === 1) {
      return visibleFarms.filter((f) => f.farmId === selectedFarmIds[0]);
    }
    return visibleFarms;
  }, [visibleFarms, selectedFarmIds]);

  useEffect(() => {
    void fetchRainfallConfiguredFarms()
      .then((rows) =>
        setConfiguredFarms(
          rows.map((row) => ({
            farmId: String(row.farm_id),
            farmName: row.farm_name,
          })),
        ),
      )
      .catch(() => setConfiguredFarms([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await fetchRainfallDashboard({
        year,
        farmIds: queryFarmIds,
      });
      setData(payload);
      if (!formFarmId && payload.farms.length > 0) {
        setFormFarmId(String(payload.farms[0]?.farm_id ?? ""));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.load"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    } finally {
      setLoading(false);
    }
  }, [formFarmId, queryFarmIds, t, year]);

  useEffect(() => {
    void load();
  }, [load]);

  const perms = data?.permissions ?? { can_create: false, can_edit: false, can_delete: false };

  const canEditEntry = (entry: RainfallRecentEntry) =>
    entry.source === "manual" ? perms.can_edit : perms.can_create;

  const handleSave = async () => {
    const value = Number(mm);
    const farmId = Number(formFarmId || queryFarmIds[0] || 0);
    if (!date || !Number.isFinite(value) || value < 0 || farmId <= 0) {
      toast.error(t("errors.invalid"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      return;
    }
    try {
      setSaving(true);
      await saveRainfallManual({
        farm_id: farmId,
        record_date: date,
        rainfall_mm: value,
      });
      toast.success(t("saved"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      setMm("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.save"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleInlineSave = async (entry: RainfallRecentEntry) => {
    const value = Number(editMm);
    if (!Number.isFinite(value) || value < 0) {
      toast.error(t("errors.invalid"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      return;
    }
    try {
      setSaving(true);
      await saveRainfallManual({
        id: entry.id ?? undefined,
        farm_id: entry.farm_id,
        record_date: entry.date,
        rainfall_mm: value,
      });
      setEditingKey(null);
      setEditMm("");
      toast.success(t("saved"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.save"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (entry: RainfallRecentEntry) => {
    if (!entry.id) return;
    if (!window.confirm(t("deleteConfirm"))) return;
    try {
      setSaving(true);
      await removeRainfallManual(entry.id);
      toast.success(t("deleted"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.delete"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    } finally {
      setSaving(false);
    }
  };

  const summary = data?.summary ?? { today_mm: 0, month_mm: 0, year_mm: 0, rain_days: 0 };
  const monthlyData = data?.monthly ?? [];
  const recent = data?.recent ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-heading text-lg font-semibold text-foreground">
          <CloudRain className="h-5 w-5 text-info" />
          {t("title", { farms: titleSuffix })}
        </h3>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : configuredFarms.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noConfiguredFarms")}</p>
      ) : visibleFarms.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noReadings")}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatBox label={t("today")} value={`${summary.today_mm} mm`} sub={formatDisplayDate(today)} icon={Droplets} />
            <StatBox label={t("thisMonth")} value={`${summary.month_mm} mm`} sub={monthLabel} icon={CalendarDays} />
            <StatBox label={t("thisYear")} value={`${summary.year_mm} mm`} sub={String(year)} icon={CloudRain} />
            <StatBox label={t("rainDays")} value={String(summary.rain_days)} sub={t("rainDaysSub", { year })} icon={Droplets} />
          </div>

          {(perms.can_create || perms.can_edit) && (
            <div className="glass-card flex flex-wrap items-end gap-3 rounded-xl p-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">{t("date")}</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="flex h-9 w-[160px] rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
              {formFarmOptions.length > 1 && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">{t("farm")}</label>
                  <select
                    value={formFarmId}
                    onChange={(e) => setFormFarmId(e.target.value)}
                    className="flex h-9 min-w-[160px] rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {formFarmOptions.map((f) => (
                      <option key={f.farmId} value={f.farmId}>
                        {f.farmName}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">{t("rainfallMm")}</label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={mm}
                  onChange={(e) => setMm(e.target.value)}
                  placeholder="0"
                  className="flex h-9 w-[120px] rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
              {perms.can_create && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleSave()}
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
                >
                  <Plus className="h-4 w-4" />
                  {t("logRainfall")}
                </button>
              )}
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="glass-card rounded-xl p-5 lg:col-span-2">
              <h4 className="mb-4 font-heading text-sm font-semibold text-foreground">
                {t("monthlyChart", { year })}
              </h4>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v: number) => [`${v} mm`, t("rainfallMm")]} />
                  <Bar dataKey="mm" fill="hsl(210,80%,52%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="glass-card rounded-xl p-5">
              <h4 className="mb-3 font-heading text-sm font-semibold text-foreground">{t("recent")}</h4>
              <div className="space-y-1.5">
                {recent.length === 0 && (
                  <p className="py-4 text-center text-sm text-muted-foreground">{t("noReadings")}</p>
                )}
                {recent.map((entry) => (
                  <div
                    key={`${entry.farm_id}-${entry.date}-${entry.source}`}
                    className="flex items-center gap-2 rounded-lg bg-muted/30 p-2 text-sm"
                  >
                    <span className="w-20 shrink-0 text-xs text-muted-foreground">{formatDisplayDate(entry.date)}</span>
                    {selectedFarmIds.length !== 1 && (
                      <span className="flex-1 truncate text-xs">{entry.farm_name}</span>
                    )}
                    {editingKey === entryKey(entry) ? (
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={editMm}
                        onChange={(e) => setEditMm(e.target.value)}
                        className="h-7 w-16 rounded border border-input px-1 text-xs"
                      />
                    ) : (
                      <span className="ml-auto font-semibold">{entry.rainfall_mm} mm</span>
                    )}
                    <RainfallSourceHint
                      entry={entry}
                      manualLabel={t("sourceTooltipManual")}
                      autoLabel={t("sourceTooltipAuto")}
                      manualWithAutoLabel={(v) => t("sourceTooltipManualWithAuto", v)}
                      ariaLabel={t("sourceTooltipAria")}
                    />
                    {canEditEntry(entry) && (
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          const key = entryKey(entry);
                          if (editingKey === key) {
                            void handleInlineSave(entry);
                          } else {
                            setEditingKey(key);
                            setEditMm(String(entry.rainfall_mm));
                          }
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {perms.can_delete && entry.id ? (
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => void handleDelete(entry)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
