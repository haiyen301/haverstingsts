"use client";

import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Database,
  RefreshCw,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";

import {
  addDays,
  addMonths,
  diffDaysInclusive,
  formatKg,
  parseYmdLocal,
  startOfLocalDay,
  toDisplayDate,
  ymdFromDate,
  type DbCalendarDay,
} from "@/app/test/forecasting/available-source-formatters";
import { AvailableSourceCalendar } from "@/app/test/forecasting/available-source-calendar";
import RequireAuth from "@/features/auth/RequireAuth";
import { fetchRegrowthRules } from "@/features/admin/api/adminApi";
import {
  DEFAULT_REGROWTH_REFERENCE_CONFIG,
  resolveRegrowthReferenceConfigFromRules,
  type RegrowthReferenceConfig,
} from "@/features/forecasting/forecastingRegrowth";
import type {
  DevForecastCalendarHarvestPlan,
  SourceAuditRow,
} from "@/features/forecasting/availableSourceDbMappers";
import type { RollingDailyAvailableDay } from "@/features/forecasting/forecastDbTypes";
import { useAvailableSourceDbAudit } from "@/features/forecasting/useAvailableSourceDbAudit";
import {
  collectHiddenGrassIdsForCatalogOnDateRange,
  pickGrassCatalogRows,
} from "@/shared/lib/harvestReferenceData";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { MultiSelect } from "@/shared/ui/multi-select";
import {
  parseCsvList,
  toCsvList,
  useSyncedFarmMultiSelect,
} from "@/shared/hooks/useSyncedFarmMultiSelect";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

function clampYmd(value: string, min: string, max: string): string {
  if (!value) return max;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function defaultRangeWithinBounds(minDate: string, maxDate: string): { from: string; to: string; anchor: string } {
  const today = ymdFromDate(startOfLocalDay(new Date()));
  const anchor = clampYmd(today, minDate, maxDate);
  const from = clampYmd(today, minDate, maxDate);
  const toCandidate = ymdFromDate(addMonths(parseYmdLocal(from) ?? startOfLocalDay(new Date()), 3));
  const to = clampYmd(toCandidate, minDate, maxDate);
  return { from, to: from > to ? from : to, anchor };
}

function SummaryTile({
  label,
  value,
  sub,
  tone = "slate",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "slate" | "green" | "amber" | "red";
}) {
  const toneClass = {
    slate: "border-slate-200 bg-white text-slate-900",
    green: "border-emerald-200 bg-emerald-50 text-emerald-950",
    amber: "border-amber-200 bg-amber-50 text-amber-950",
    red: "border-red-200 bg-red-50 text-red-950",
  }[tone];
  return (
    <div className={`rounded-lg border p-4 ${toneClass}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      {sub ? <p className="mt-1 text-xs text-slate-600">{sub}</p> : null}
    </div>
  );
}

function formatRegrowthConfigSummaryLines(cfg: RegrowthReferenceConfig): string[] {
  return [
    `Sod: ${cfg.sodDays} days`,
    `Sod to sprig: ${cfg.sodForSprigDays} days`,
    ...cfg.sprigBands.map((band) => `Sprig ${band.label}: ${band.regrowthDays} days`),
  ];
}

function buildCalendarDays(params: {
  dateFrom: Date;
  dateTo: Date;
  anchorYmd: string;
  rollingByDate: Map<string, RollingDailyAvailableDay>;
  regrowthStatsByDate: Map<
    string,
    { source_count: number; gross_kg: number; credited_kg: number; overlimit_kg: number }
  >;
  harvestPlansByDate: Map<string, DevForecastCalendarHarvestPlan[]>;
  regrowthSourcesByDate: Map<string, SourceAuditRow[]>;
}): DbCalendarDay[] {
  const todayYmd = ymdFromDate(startOfLocalDay(new Date()));
  const end = params.dateTo < params.dateFrom ? params.dateFrom : params.dateTo;
  const totalDays = diffDaysInclusive(params.dateFrom, end);
  const days: DbCalendarDay[] = [];

  for (let i = 0; i < totalDays; i++) {
    const date = addDays(params.dateFrom, i);
    const dateStr = ymdFromDate(date);
    const rolling = params.rollingByDate.get(dateStr);
    const rgStats = params.regrowthStatsByDate.get(dateStr);

    days.push({
      date: dateStr,
      isToday: dateStr === todayYmd,
      isAnchor: dateStr === params.anchorYmd,
      // Snapshot-only metrics — never blend regrowth_stats or client simulate.
      previousAvailable: Math.max(0, Math.round(rolling?.previousAvailableKg ?? 0)),
      harvestKg: Math.max(0, Math.round(rolling?.harvestKg ?? 0)),
      regrowthKg: Math.max(0, Math.round(rolling?.regrowthKg ?? 0)),
      available: Math.max(0, Math.round(rolling?.availableKg ?? 0)),
      rawAvailable: Math.max(0, Math.round(rolling?.rawAvailableKg ?? 0)),
      capacityCap: Math.max(0, Math.round(rolling?.capacityCapKg ?? 0)),
      overlimit: Math.max(0, Math.round(rolling?.overlimitKg ?? 0)),
      // regrowth_stats API (DB drill-down, not client formula).
      regrowthGrossKg: Math.max(0, Math.round(rgStats?.gross_kg ?? 0)),
      regrowthOverlimitKg: Math.max(0, Math.round(rgStats?.overlimit_kg ?? 0)),
      regrowthSourceCount: rgStats?.source_count ?? 0,
      hasSnapshot: rolling != null,
      harvestPlans: params.harvestPlansByDate.get(dateStr) ?? [],
      regrowthSources: params.regrowthSourcesByDate.get(dateStr) ?? [],
    });
  }

  return days;
}

export function DevForecastingAvailableSourceClient() {
  const router = useRouter();
  const grasses = useHarvestingDataStore((s) => s.grasses);
  const fetchAllHarvestingReferenceData = useHarvestingDataStore(
    (s) => s.fetchAllHarvestingReferenceData,
  );
  const harvestListGrassFilter = useHarvestingDataStore((s) => s.harvestListGrassFilter);
  const setHarvestListGrassFilter = useHarvestingDataStore((s) => s.setHarvestListGrassFilter);
  const { selectedFarmIds, setSelectedFarmIds, farmOptions } = useSyncedFarmMultiSelect();

  const [dateFrom, setDateFrom] = useState(() => ymdFromDate(startOfLocalDay(new Date())));
  const [dateTo, setDateTo] = useState(() => ymdFromDate(addMonths(startOfLocalDay(new Date()), 3)));
  const [anchorDate, setAnchorDate] = useState(() => ymdFromDate(startOfLocalDay(new Date())));
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [regrowthConfig, setRegrowthConfig] = useState<RegrowthReferenceConfig>(
    DEFAULT_REGROWTH_REFERENCE_CONFIG,
  );

  const deferredFrom = useDeferredValue(dateFrom);
  const deferredTo = useDeferredValue(dateTo);
  const datesPending = deferredFrom !== dateFrom || deferredTo !== dateTo;

  const selectedGrassIds = useMemo(
    () => parseCsvList(harvestListGrassFilter),
    [harvestListGrassFilter],
  );
  const setSelectedGrassIds = useCallback(
    (ids: string[]) => setHarvestListGrassFilter(toCsvList(ids)),
    [setHarvestListGrassFilter],
  );

  const dateFromObj = useMemo(
    () => parseYmdLocal(deferredFrom) ?? startOfLocalDay(new Date()),
    [deferredFrom],
  );
  const dateToObj = useMemo(
    () => parseYmdLocal(deferredTo) ?? addMonths(dateFromObj, 3),
    [dateFromObj, deferredTo],
  );

  const hiddenGrassIdSet = useMemo(
    () =>
      collectHiddenGrassIdsForCatalogOnDateRange(
        grasses as unknown[],
        deferredFrom,
        deferredTo,
      ),
    [grasses, deferredFrom, deferredTo],
  );

  useEffect(() => {
    void fetchAllHarvestingReferenceData();
  }, [fetchAllHarvestingReferenceData]);

  useEffect(() => {
    void fetchRegrowthRules()
      .then((rules) => setRegrowthConfig(resolveRegrowthReferenceConfigFromRules(rules)))
      .catch(() => undefined);
  }, [refreshKey]);

  useEffect(() => {
    if (hiddenGrassIdSet.size === 0) return;
    const current = parseCsvList(harvestListGrassFilter);
    const pruned = current.filter((id) => !hiddenGrassIdSet.has(id));
    if (pruned.length !== current.length) setHarvestListGrassFilter(toCsvList(pruned));
  }, [hiddenGrassIdSet, harvestListGrassFilter, setHarvestListGrassFilter]);

  const db = useAvailableSourceDbAudit({
    dateFrom: deferredFrom,
    dateTo: deferredTo,
    anchorDate,
    farmIds: selectedFarmIds,
    grassIds: selectedGrassIds,
    calendarOpen,
    refreshKey,
  });

  const dbMinDate = db.selectableBounds?.minDate;
  const dbMaxDate = db.selectableBounds?.maxDate;

  useEffect(() => {
    if (!dbMinDate || !dbMaxDate) return;

    const clampedFrom = clampYmd(dateFrom, dbMinDate, dbMaxDate);
    const clampedTo = clampYmd(dateTo, dbMinDate, dbMaxDate);
    const clampedAnchor = clampYmd(anchorDate, dbMinDate, dbMaxDate);

    if (clampedFrom !== dateFrom) setDateFrom(clampedFrom);
    if (clampedTo !== dateTo) setDateTo(clampedTo);
    if (clampedAnchor !== anchorDate) setAnchorDate(clampedAnchor);

    if (clampedFrom > clampedTo) setDateTo(clampedFrom);
    if (clampedAnchor < clampedFrom) setAnchorDate(clampedFrom);
    if (clampedAnchor > clampedTo) setAnchorDate(clampedTo);
  }, [dbMinDate, dbMaxDate, dateFrom, dateTo, anchorDate]);

  useEffect(() => {
    if (!dbMinDate || !dbMaxDate || db.isLoading) return;
    if (db.hasDbData) return;

    const { from, to, anchor } = defaultRangeWithinBounds(dbMinDate, dbMaxDate);
    if (dateFrom > dbMaxDate || dateTo > dbMaxDate || dateFrom < dbMinDate) {
      setDateFrom(from);
      setDateTo(to);
      setAnchorDate(anchor);
    }
  }, [dbMinDate, dbMaxDate, db.isLoading, db.hasDbData, dateFrom, dateTo]);

  const rollingByDate = useMemo(
    () => new Map(db.rollingDailyAvailable.map((day) => [day.date, day] as const)),
    [db.rollingDailyAvailable],
  );

  const anchorSnapshot = rollingByDate.get(anchorDate);

  const calendarDays = useMemo(
    () =>
      buildCalendarDays({
        dateFrom: dateFromObj,
        dateTo: dateToObj,
        anchorYmd: anchorDate,
        rollingByDate,
        regrowthStatsByDate: db.regrowthStatsByDate,
        harvestPlansByDate: db.harvestPlansByDate,
        regrowthSourcesByDate: db.regrowthSourcesByDate,
      }),
    [
      dateFromObj,
      dateToObj,
      anchorDate,
      rollingByDate,
      db.regrowthStatsByDate,
      db.harvestPlansByDate,
      db.regrowthSourcesByDate,
    ],
  );

  const grassFilterOptions = useMemo(() => {
    const picked = pickGrassCatalogRows({
      catalog: grasses as unknown[],
      mode: "sales_window",
      refYmds: [],
      pinnedGrassIds: selectedGrassIds,
    });
    return picked
      .map((grass) => {
        if (!grass || typeof grass !== "object") return null;
        const row = grass as Record<string, unknown>;
        const value = String(row.id ?? "").trim();
        const label = String(row.title ?? row.name ?? value).trim();
        return value ? { value, label } : null;
      })
      .filter((row): row is { value: string; label: string } => row !== null)
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [grasses, selectedGrassIds]);

  const regrowthGrossAtAnchor = db.regrowthStatsByDate.get(anchorDate)?.gross_kg ?? 0;

  return (
    <RequireAuth>
      <DashboardLayout>
        <main className="min-h-screen bg-slate-50">
          <div className="mx-auto w-full max-w-7xl space-y-6 p-4 lg:p-8">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Development · DB only
                </p>
                <h1 className="mt-1 text-2xl font-semibold text-slate-950">
                  Forecast available source audit
                </h1>
                <p className="mt-1 max-w-3xl text-sm text-slate-600">
                  Chỉ đọc <strong>inventory_daily_snapshots</strong> + API{" "}
                  <code className="text-xs">day_detail</code> /{" "}
                  <code className="text-xs">regrowth_stats</code> — parity{" "}
                  <code className="text-xs">/forecast_audit</code>. Metric chart ={" "}
                  <code className="text-xs">0|__aggregate__|0</code> ·{" "}
                  <code className="text-xs">available_kg</code>.
                </p>
                {db.isLoading ? (
                  <p className="mt-1 text-xs text-slate-500">Đang tải snapshot từ DB…</p>
                ) : db.hasDbData ? (
                  <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                    <Database className="h-3.5 w-3.5" />
                    {db.rollingDailyAvailable.length.toLocaleString()} ngày · DB tổng{" "}
                    {db.snapshotCount.toLocaleString()} rows
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-amber-800">
                    {db.selectableBounds ? (
                      <>
                        Không có snapshot aggregate trong khoảng đã chọn. Phạm vi DB:{" "}
                        {toDisplayDate(db.selectableBounds.minDate)} →{" "}
                        {toDisplayDate(db.selectableBounds.maxDate)}
                        {db.selectableBounds.aggregateBounds
                          ? ` (${db.selectableBounds.aggregateBounds.count.toLocaleString()} rows · 0|__aggregate__|0)`
                          : null}
                        .
                      </>
                    ) : (
                      <>
                        Không đọc được snapshot trong khoảng ngày đã chọn. Kiểm tra From/To và
                        aggregate zone <code className="text-[11px]">0|__aggregate__|0</code>.
                      </>
                    )}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => router.push("/forecasting")}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Forecasting
                </button>
                <button
                  type="button"
                  onClick={() => setRefreshKey((k) => k + 1)}
                  disabled={db.isLoading}
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  <RefreshCw className={`h-4 w-4 ${db.isLoading ? "animate-spin" : ""}`} />
                  Reload DB
                </button>
              </div>
            </div>

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              {dbMinDate && dbMaxDate ? (
                <p className="mb-3 text-xs text-slate-600">
                  Phạm vi snapshot DB:{" "}
                  <strong className="font-medium text-slate-800">
                    {toDisplayDate(dbMinDate)} → {toDisplayDate(dbMaxDate)}
                  </strong>
                  {db.selectableBounds?.aggregateBounds ? (
                    <span className="text-slate-500">
                      {" "}
                      · aggregate {db.selectableBounds.aggregateBounds.count.toLocaleString()} rows
                    </span>
                  ) : null}
                </p>
              ) : null}
              <div className="grid gap-3 lg:grid-cols-[160px_160px_160px_1fr_1fr]">
                <label className="space-y-1">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                    <CalendarDays className="h-3.5 w-3.5" />
                    From
                  </span>
                  <input
                    type="date"
                    value={dateFrom}
                    min={dbMinDate}
                    max={dbMaxDate ?? (dateTo || undefined)}
                    onChange={(e) => {
                      const next = clampYmd(
                        e.target.value,
                        dbMinDate ?? e.target.value,
                        dbMaxDate ?? e.target.value,
                      );
                      setDateFrom(next);
                      if (next && dateTo && next > dateTo) setDateTo(next);
                      if (next && anchorDate && anchorDate < next) setAnchorDate(next);
                    }}
                    className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                  />
                </label>
                <label className="space-y-1">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                    <CalendarDays className="h-3.5 w-3.5" />
                    To
                  </span>
                  <input
                    type="date"
                    value={dateTo}
                    min={dbMinDate ?? (dateFrom || undefined)}
                    max={dbMaxDate}
                    onChange={(e) => {
                      const next = clampYmd(
                        e.target.value,
                        dbMinDate ?? e.target.value,
                        dbMaxDate ?? e.target.value,
                      );
                      setDateTo(next);
                      if (next && dateFrom && next < dateFrom) setDateFrom(next);
                      if (next && anchorDate && anchorDate > next) setAnchorDate(next);
                    }}
                    className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                  />
                </label>
                <label className="space-y-1">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                    <CalendarDays className="h-3.5 w-3.5" />
                    Anchor ★
                  </span>
                  <input
                    type="date"
                    value={anchorDate}
                    min={dbMinDate ?? dateFrom}
                    max={dbMaxDate ?? dateTo}
                    onChange={(e) => {
                      const next = clampYmd(
                        e.target.value,
                        dbMinDate ?? dateFrom,
                        dbMaxDate ?? dateTo,
                      );
                      setAnchorDate(next);
                    }}
                    className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                    title="Ngày highlight — giống /forecast_audit"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-medium text-slate-600">Farm filter</span>
                  <MultiSelect
                    options={farmOptions.map((o) => ({ value: o.id, label: o.label }))}
                    values={selectedFarmIds}
                    onChange={setSelectedFarmIds}
                    placeholder="All farms"
                    showAllOption
                    selectionSummary="compact"
                    className="rounded-lg"
                    formatSelectedCount={(n) => `${n} farms`}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-medium text-slate-600">Grass filter</span>
                  <MultiSelect
                    options={grassFilterOptions}
                    values={selectedGrassIds}
                    onChange={setSelectedGrassIds}
                    placeholder="All grasses"
                    showAllOption
                    selectionSummary="compact"
                    className="rounded-lg"
                    formatSelectedCount={(n) => `${n} grasses`}
                  />
                </label>
              </div>
            </section>

            {db.error ? (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{db.error}</span>
              </div>
            ) : null}

            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <SummaryTile
                label="Chart available ★"
                value={formatKg(anchorSnapshot?.availableKg ?? 0)}
                sub={`aggregate available_kg · ${toDisplayDate(anchorDate)}`}
                tone="green"
              />
              <SummaryTile
                label="Previous"
                value={formatKg(anchorSnapshot?.previousAvailableKg ?? 0)}
                sub="previous_available_kg"
              />
              <SummaryTile
                label="Regrowth (credited)"
                value={formatKg(anchorSnapshot?.regrowthKg ?? 0)}
                sub={`gross ${formatKg(regrowthGrossAtAnchor)} · anchor`}
              />
              <SummaryTile
                label="Harvest"
                value={formatKg(anchorSnapshot?.harvestKg ?? 0)}
                sub="harvest_kg snapshot"
                tone={anchorSnapshot && anchorSnapshot.harvestKg > 0 ? "amber" : "slate"}
              />
              <SummaryTile
                label="Capacity cap"
                value={formatKg(anchorSnapshot?.capacityCapKg ?? 0)}
                sub="capacity_cap_kg aggregate"
                tone="amber"
              />
            </section>

            <section className="rounded-lg border border-slate-200 bg-white">
              <div className="flex flex-col gap-1 border-b border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h2 className="text-lg font-semibold text-slate-950">
                    Daily calendar — DB aggregate
                  </h2>
                  <button
                    type="button"
                    onClick={() => setCalendarOpen((o) => !o)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {calendarOpen ? (
                      <>
                        Hide <ChevronUp className="h-4 w-4" />
                      </>
                    ) : (
                      <>
                        Show <ChevronDown className="h-4 w-4" />
                      </>
                    )}
                  </button>
                </div>
                <p className="text-sm text-slate-600">
                  {toDisplayDate(deferredFrom)} → {toDisplayDate(deferredTo)}. Mỗi cột hiển thị trực
                  tiếp harvest plans và regrowth sources (đợt gặt nguồn) khi mở calendar.
                </p>
                {calendarOpen && (datesPending || db.isLoading) ? (
                  <p className="text-xs text-amber-700">Đang tải snapshot…</p>
                ) : null}
                {calendarOpen && db.detailsLoading ? (
                  <p className="text-xs text-slate-500">Đang tải chi tiết harvest / regrowth…</p>
                ) : null}
                <div className="mt-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-950">
                  <p className="font-semibold text-violet-900">Regrowth rules (reference)</p>
                  <ul className="mt-1 list-inside list-disc">
                    {formatRegrowthConfigSummaryLines(regrowthConfig).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              </div>
              {calendarOpen ? (
                <AvailableSourceCalendar
                  days={calendarDays}
                  anchorDate={anchorDate}
                  detailsLoading={db.detailsLoading}
                />
              ) : null}
            </section>
          </div>
        </main>
      </DashboardLayout>
    </RequireAuth>
  );
}
