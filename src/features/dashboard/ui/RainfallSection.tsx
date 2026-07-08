"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CloudRain,
  Droplets,
  CalendarDays,
  Download,
  HelpCircle,
  Loader2,
  Plus,
  Trash2,
  Pencil,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";
import { canAccessModule } from "@/shared/auth/permissions";
import { useAuthUserStore } from "@/shared/store/authUserStore";
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
import {
  RAINFALL_RECENT_PAGE_SIZE,
  sortRainfallRecentEntries,
} from "@/features/dashboard/lib/sortRainfallRecentEntries";
import { RainfallExportDialog } from "@/features/dashboard/ui/RainfallExportDialog";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";
import { cn } from "@/lib/utils";

/** Temporary: hide Open Meteo auto rainfall; manual entry only. */
const RAINFALL_MANUAL_ONLY = true;
/** Temporary: hide source tooltip (?) on recent entries. */
const RAINFALL_SOURCE_HINT_VISIBLE = false;

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function applyManualRainfallOnly(
  data: RainfallDashboardData,
  year: number,
  today: string,
): RainfallDashboardData {
  const recent = data.recent.filter((entry) => entry.source === "manual");
  const monthPrefix = today.slice(0, 7);

  let todayMm = 0;
  let monthMm = 0;
  let yearMm = 0;
  let rainDays = 0;
  const monthlyTotals = Array.from({ length: 12 }, () => 0);

  for (const entry of recent) {
    const value = entry.rainfall_mm;
    if (entry.date.startsWith(String(year))) {
      yearMm += value;
      if (value > 0) rainDays += 1;
      const monthIndex = Number(entry.date.slice(5, 7)) - 1;
      if (monthIndex >= 0 && monthIndex < 12) {
        monthlyTotals[monthIndex] += value;
      }
    }
    if (entry.date.startsWith(monthPrefix)) {
      monthMm += value;
    }
    if (entry.date === today) {
      todayMm += value;
    }
  }

  const round = (n: number) => Math.round(n * 100) / 100;

  return {
    ...data,
    summary: {
      today_mm: round(todayMm),
      month_mm: round(monthMm),
      year_mm: round(yearMm),
      rain_days: rainDays,
    },
    monthly: MONTH_LABELS.map((month, index) => ({
      month,
      mm: round(monthlyTotals[index] ?? 0),
    })),
    recent,
    recent_total: recent.length,
  };
}

type FarmFilter = {
  farmId: string;
  farmName: string;
};

type RainfallSectionProps = {
  farmFilters: FarmFilter[];
  selectedFarmIds: string[];
  scopeFarmIds: string[] | null;
  recentDateFrom?: string;
  recentDateTo?: string;
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

type HintTooltipPosition = {
  left: number;
  top: number;
  maxWidth: number;
};

function computeHintTooltipPosition(rect: DOMRect, maxWidth: number): HintTooltipPosition {
  const margin = 8;
  const width = Math.min(maxWidth, window.innerWidth - margin * 2);
  let left = rect.right - width;
  if (left + width > window.innerWidth - margin) {
    left = window.innerWidth - width - margin;
  }
  left = Math.max(margin, left);

  return {
    left,
    top: rect.top - 6,
    maxWidth: width,
  };
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
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [tooltip, setTooltip] = useState<HintTooltipPosition | null>(null);
  const isManual = entry.source === "manual";
  const tooltipText =
    isManual && entry.open_meteo_mm != null
      ? manualWithAutoLabel({ mm: String(entry.open_meteo_mm) })
      : isManual
        ? manualLabel
        : autoLabel;

  const showTooltip = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    setTooltip(computeHintTooltipPosition(el.getBoundingClientRect(), 224));
  }, []);

  const hideTooltip = useCallback(() => {
    setTooltip(null);
  }, []);

  useEffect(() => {
    if (!tooltip) return;
    const hide = () => setTooltip(null);
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, [tooltip]);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="inline-flex shrink-0 text-muted-foreground hover:text-foreground"
        aria-label={ariaLabel}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      {tooltip && typeof document !== "undefined"
        ? createPortal(
            <div
              role="tooltip"
              className="pointer-events-none fixed z-200 -translate-y-full rounded-md border border-border bg-popover px-2 py-1.5 text-[11px] font-normal normal-case leading-snug text-popover-foreground shadow-md"
              style={{
                left: tooltip.left,
                top: tooltip.top,
                maxWidth: tooltip.maxWidth,
              }}
            >
              {tooltipText}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export function RainfallSection({
  farmFilters,
  selectedFarmIds,
  scopeFarmIds,
  recentDateFrom,
  recentDateTo,
}: RainfallSectionProps) {
  const t = useTranslations("Dashboard.rainfall");
  const user = useAuthUserStore((s) => s.user);
  const canExportRainfall = canAccessModule(user, "dashboard", "export");
  const year = new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10);
  const monthLabel = new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const [configuredFarms, setConfiguredFarms] = useState<FarmFilter[]>([]);
  const [data, setData] = useState<RainfallDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const hasLoadedRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState(today);
  const [formFarmId, setFormFarmId] = useState("");
  const [mm, setMm] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editMm, setEditMm] = useState("");
  const [recentVisibleCount, setRecentVisibleCount] = useState(RAINFALL_RECENT_PAGE_SIZE);
  const [exportOpen, setExportOpen] = useState(false);
  const recentListRef = useRef<HTMLDivElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreLockRef = useRef(false);

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
    const isRefresh = hasLoadedRef.current;
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const payload = await fetchRainfallDashboard({
        year,
        farmIds: queryFarmIds,
        dateFrom: recentDateFrom,
        dateTo: recentDateTo,
      });
      const processed = RAINFALL_MANUAL_ONLY
        ? applyManualRainfallOnly(payload, year, today)
        : payload;
      setData(processed);
      hasLoadedRef.current = true;
      setFormFarmId((prev) => {
        if (prev) return prev;
        return String(processed.farms[0]?.farm_id ?? "");
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.load"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [queryFarmIds, recentDateFrom, recentDateTo, t, today, year]);

  useEffect(() => {
    void load();
  }, [load]);

  const sortedRecent = useMemo(
    () => sortRainfallRecentEntries(data?.recent ?? [], today),
    [data?.recent, today],
  );
  const recentTotal = sortedRecent.length;
  const visibleRecent = sortedRecent.slice(0, recentVisibleCount);
  const hasMoreRecent = recentVisibleCount < recentTotal;

  useEffect(() => {
    setRecentVisibleCount(RAINFALL_RECENT_PAGE_SIZE);
    loadMoreLockRef.current = false;
  }, [queryFarmIds, year, recentDateFrom, recentDateTo]);

  const loadMoreRecent = useCallback(() => {
    if (loadMoreLockRef.current) return;
    loadMoreLockRef.current = true;
    setRecentVisibleCount((count) => {
      const next = Math.min(count + RAINFALL_RECENT_PAGE_SIZE, recentTotal);
      if (next === count) {
        loadMoreLockRef.current = false;
        return count;
      }
      requestAnimationFrame(() => {
        loadMoreLockRef.current = false;
      });
      return next;
    });
  }, [recentTotal]);

  useEffect(() => {
    const root = recentListRef.current;
    const sentinel = loadMoreSentinelRef.current;
    if (!root || !sentinel || !hasMoreRecent) return;

    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        loadMoreRecent();
      },
      { root, rootMargin: "48px", threshold: 0 },
    );

    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [hasMoreRecent, loadMoreRecent, visibleRecent.length]);

  useEffect(() => {
    const el = recentListRef.current;
    if (!el || !hasMoreRecent) return;
    if (el.scrollHeight <= el.clientHeight + 1) {
      loadMoreRecent();
    }
  }, [hasMoreRecent, loadMoreRecent, visibleRecent.length]);

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-heading text-lg font-semibold text-foreground">
          <CloudRain className="h-5 w-5 text-info" />
          {t("title", { farms: titleSuffix })}
        </h3>
      </div>

      {loading && !data ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : configuredFarms.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noConfiguredFarms")}</p>
      ) : visibleFarms.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noReadings")}</p>
      ) : (
        <div className={cn("relative space-y-4", (refreshing || saving) && "pointer-events-none")}>
          {refreshing || saving ? (
            <div
              className="pointer-events-none absolute inset-0 z-10 flex items-start justify-center rounded-xl bg-background/35 pt-16"
              aria-hidden
            >
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : null}
          <div
            className={cn(
              "space-y-4 transition-opacity duration-150",
              refreshing && "opacity-60",
              saving && !refreshing && "opacity-90",
            )}
          >
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatBox label={t("today")} value={`${summary.today_mm} mm`} sub={formatDisplayDate(today)} icon={Droplets} />
            <StatBox label={t("thisMonth")} value={`${summary.month_mm} mm`} sub={monthLabel} icon={CalendarDays} />
            <StatBox label={t("thisYear")} value={`${summary.year_mm} mm`} sub={String(year)} icon={CloudRain} />
            <StatBox label={t("rainDays")} value={String(summary.rain_days)} sub={t("rainDaysSub", { year })} icon={Droplets} />
          </div>

          {(perms.can_create || perms.can_edit || canExportRainfall) && (
            <div className="glass-card flex flex-wrap items-end gap-3 rounded-xl p-4">
              {(perms.can_create || perms.can_edit) && (
                <>
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
                </>
              )}
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
              {canExportRainfall ? (
                <button
                  type="button"
                  onClick={() => setExportOpen(true)}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/80"
                >
                  <Download className="h-4 w-4" />
                  {t("export.button")}
                </button>
              ) : null}
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
              <div
                ref={recentListRef}
                className="max-h-80 space-y-1.5 overflow-y-auto pr-1"
              >
                {sortedRecent.length === 0 && (
                  <p className="py-4 text-center text-sm text-muted-foreground">{t("noReadings")}</p>
                )}
                {visibleRecent.map((entry) => (
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
                    {RAINFALL_SOURCE_HINT_VISIBLE && (
                      <RainfallSourceHint
                        entry={entry}
                        manualLabel={t("sourceTooltipManual")}
                        autoLabel={t("sourceTooltipAuto")}
                        manualWithAutoLabel={(v) => t("sourceTooltipManualWithAuto", v)}
                        ariaLabel={t("sourceTooltipAria")}
                      />
                    )}
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
                {hasMoreRecent ? <div ref={loadMoreSentinelRef} className="h-1" aria-hidden /> : null}
              </div>
            </div>
          </div>
          </div>
        </div>
      )}
      {canExportRainfall ? (
        <RainfallExportDialog
          open={exportOpen}
          onClose={() => setExportOpen(false)}
          farmOptions={formFarmOptions.map((f) => ({ id: f.farmId, label: f.farmName }))}
          initialFarmIds={
            formFarmId
              ? [formFarmId]
              : selectedFarmIds.length > 0
                ? selectedFarmIds
                : formFarmOptions[0]?.farmId
                  ? [formFarmOptions[0].farmId]
                  : []
          }
          initialYear={year}
          manualOnly={RAINFALL_MANUAL_ONLY}
        />
      ) : null}
    </div>
  );
}
