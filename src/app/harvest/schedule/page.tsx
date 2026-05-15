"use client";

import { useEffect, useMemo, useState } from "react";
import { Calendar, Clock, MapPin, Users } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import RequireAuth from "@/features/auth/RequireAuth";
import { stsProxyGetHarvestingIndex } from "@/shared/api/stsProxyClient";
import { harvestTypeDisplayLabel } from "@/shared/lib/harvestType";
import { pickGrassCatalogRows } from "@/shared/lib/harvestReferenceData";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

type RangePreset = "today" | "this-week" | "next-week" | "next-month";

type ScheduleStatus = "planned" | "scheduled" | "harvested" | "delivered";

type ScheduleEntry = {
  id: string;
  date: string;
  project: string;
  farm: string;
  zone: string;
  grassProductId: string;
  grassType: string;
  harvestType: string;
  crew: string;
  startTime: string;
  estimatedAreaM2: number;
  quantity: number;
  quantityUom: string;
  status: ScheduleStatus;
};

const PER_PAGE = 200;

const RANGE_PRESETS: RangePreset[] = ["today", "this-week", "next-week", "next-month"];

const statusStyles: Record<ScheduleStatus, string> = {
  planned: "bg-slate-100 text-slate-700",
  scheduled: "bg-blue-100 text-blue-700",
  harvested: "bg-amber-100 text-amber-700",
  delivered: "bg-green-100 text-green-700",
};

function isValidHarvestDateString(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s || s === "0000-00-00") return false;
  return true;
}

function formatDateDisplay(value: string, locale: string): string {
  const date = new Date(`${value}T00:00:00`);
  return date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function startOfWeek(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(base: Date, n: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getRange(preset: RangePreset): { start: Date; end: Date } {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  if (preset === "today") {
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return { start: now, end };
  }
  if (preset === "this-week") {
    const start = startOfWeek(now);
    const end = addDays(start, 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  if (preset === "next-week") {
    const start = addDays(startOfWeek(now), 7);
    const end = addDays(start, 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  const start = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59, 999);
  return { start, end };
}

function deriveScheduleStatus(raw: Record<string, unknown>): ScheduleStatus {
  if (isValidHarvestDateString(raw.delivery_harvest_date)) return "delivered";
  if (isValidHarvestDateString(raw.actual_harvest_date)) return "harvested";
  if (isValidHarvestDateString(raw.estimated_harvest_date)) return "scheduled";
  return "planned";
}

function pickScheduleDate(raw: Record<string, unknown>): string {
  if (isValidHarvestDateString(raw.actual_harvest_date)) {
    return String(raw.actual_harvest_date).trim().slice(0, 10);
  }
  if (isValidHarvestDateString(raw.estimated_harvest_date)) {
    return String(raw.estimated_harvest_date).trim().slice(0, 10);
  }
  if (isValidHarvestDateString(raw.delivery_harvest_date)) {
    return String(raw.delivery_harvest_date).trim().slice(0, 10);
  }
  return "";
}

function pickScheduleTime(raw: Record<string, unknown>): string {
  const candidates = [
    raw.actual_harvest_date,
    raw.estimated_harvest_date,
    raw.delivery_harvest_date,
  ];
  for (const candidate of candidates) {
    const text = String(candidate ?? "").trim();
    const match = text.match(/(\d{2}):(\d{2})/);
    if (match) return `${match[1]}:${match[2]}`;
  }
  return "";
}

function normalizeHarvestType(raw: Record<string, unknown>): string {
  return harvestTypeDisplayLabel(raw.harvest_type ?? raw.load_type ?? "").trim();
}

function normalizeCrew(raw: Record<string, unknown>): string {
  return String(raw.assigned_to ?? "").trim();
}

function isKgUom(uomRaw: string): boolean {
  const u = uomRaw.toLowerCase().replace(/\s/g, "");
  return u === "kg" || u === "kgs" || u === "kilogram" || u === "kilograms";
}

function normalizeScheduleEntry(raw: unknown): ScheduleEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = r.id;
  if (id === undefined || id === null) return null;

  const quantityRaw = Number(r.quantity);
  const quantity = Number.isFinite(quantityRaw) ? quantityRaw : 0;
  const estimatedAreaRaw = Number(r.harvested_area);
  const estimatedAreaM2 = Number.isFinite(estimatedAreaRaw) ? estimatedAreaRaw : 0;
  const quantityUom = String(r.uom ?? "").trim().toUpperCase() || "QTY";

  return {
    id: String(id),
    date: pickScheduleDate(r),
    project: String(r.project_name ?? "").trim(),
    farm: String(r.farm_name ?? "").trim(),
    zone: String(r.zone ?? "").trim(),
    grassProductId: String(r.product_id ?? "").trim(),
    grassType: String(r.grass_name ?? "").trim(),
    harvestType: normalizeHarvestType(r),
    crew: normalizeCrew(r),
    startTime: pickScheduleTime(r),
    estimatedAreaM2,
    quantity,
    quantityUom,
    status: deriveScheduleStatus(r),
  };
}

function harvestStatusKey(status: ScheduleStatus): "harvestStatus_planned" | "harvestStatus_scheduled" | "harvestStatus_harvested" | "harvestStatus_delivered" {
  switch (status) {
    case "planned":
      return "harvestStatus_planned";
    case "scheduled":
      return "harvestStatus_scheduled";
    case "harvested":
      return "harvestStatus_harvested";
    case "delivered":
      return "harvestStatus_delivered";
    default:
      return "harvestStatus_planned";
  }
}

export default function HarvestSchedulePage() {
  const locale = useLocale();
  const t = useTranslations("HarvestSchedule");
  const tHarvest = useTranslations("Harvest");
  const [range, setRange] = useState<RangePreset>("this-week");
  const [farmFilter, setFarmFilter] = useState("all");
  const [grassFilter, setGrassFilter] = useState("all");
  const [scheduleRows, setScheduleRows] = useState<ScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const grasses = useHarvestingDataStore((s) => s.grasses);
  const fetchAllHarvestingReferenceData = useHarvestingDataStore(
    (s) => s.fetchAllHarvestingReferenceData,
  );

  const loadErrorMessage = t("loadError");

  useEffect(() => {
    void fetchAllHarvestingReferenceData();
  }, [fetchAllHarvestingReferenceData]);

  const { start, end } = useMemo(() => getRange(range), [range]);

  useEffect(() => {
    let alive = true;

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const rows: ScheduleEntry[] = [];
        let page = 1;
        let totalPages = 1;

        do {
          const res = await stsProxyGetHarvestingIndex({
            page,
            per_page: PER_PAGE,
            actual_harvest_date_from: ymd(start),
            actual_harvest_date_to: ymd(end),
          });

          rows.push(
            ...res.rows
              .map(normalizeScheduleEntry)
              .filter((entry): entry is ScheduleEntry => entry !== null),
          );

          totalPages = Math.max(1, res.totalPages);
          page += 1;
        } while (page <= totalPages);

        if (!alive) return;
        setScheduleRows(
          rows.sort((a, b) => a.date.localeCompare(b.date) || a.project.localeCompare(b.project)),
        );
      } catch (loadError) {
        if (!alive) return;
        setError(loadError instanceof Error ? loadError.message : loadErrorMessage);
        setScheduleRows([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [start, end, loadErrorMessage]);

  const farms = useMemo(
    () => Array.from(new Set(scheduleRows.map((x) => x.farm).filter(Boolean))).sort(),
    [scheduleRows],
  );
  const grassLabelByProductId = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of grasses) {
      if (!g || typeof g !== "object") continue;
      const rec = g as Record<string, unknown>;
      const id = String(rec.id ?? "").trim();
      if (!id) continue;
      const label = String(rec.title ?? rec.name ?? "").trim();
      if (label) m.set(id, label);
    }
    return m;
  }, [grasses]);

  const grassFilterOptions = useMemo(() => {
    const picked = pickGrassCatalogRows({
      catalog: grasses as unknown[],
      mode: "all",
      refYmds: [],
      pinnedGrassIds: grassFilter !== "all" ? [grassFilter] : [],
    });
    return picked
      .map((g) => {
        if (!g || typeof g !== "object") return null;
        const rec = g as Record<string, unknown>;
        const id = String(rec.id ?? "").trim();
        const label = String(rec.title ?? rec.name ?? "").trim() || id;
        return id ? { id, label } : null;
      })
      .filter((x): x is { id: string; label: string } => x !== null)
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [grasses, grassFilter]);

  const filtered = useMemo(
    () =>
      scheduleRows
        .filter((entry) => {
          if (farmFilter !== "all" && entry.farm !== farmFilter) return false;
          if (grassFilter === "all") return true;
          if (entry.grassProductId && entry.grassProductId === grassFilter) return true;
          const want = grassLabelByProductId.get(grassFilter);
          if (want && entry.grassType.trim() && entry.grassType.trim() === want.trim()) return true;
          return false;
        })
        .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)),
    [scheduleRows, farmFilter, grassFilter, grassLabelByProductId],
  );

  const totalArea = filtered.reduce((sum, entry) => sum + entry.estimatedAreaM2, 0);
  const totalKg = filtered.reduce(
    (sum, entry) => sum + (isKgUom(entry.quantityUom) ? entry.quantity : 0),
    0,
  );

  const rangeLabel = (preset: RangePreset) => {
    switch (preset) {
      case "today":
        return t("rangeToday");
      case "this-week":
        return t("rangeThisWeek");
      case "next-week":
        return t("rangeNextWeek");
      case "next-month":
        return t("rangeNextMonth");
      default:
        return preset;
    }
  };

  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="min-h-full p-4 lg:p-8">
          <div className="mx-auto max-w-7xl space-y-6">
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
              <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
            </div>

            <div className="rounded-xl border border-border bg-card p-3">
              <div className="flex flex-wrap gap-2">
                {RANGE_PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setRange(p)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      range === p
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {rangeLabel(p)}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <select
                value={farmFilter}
                onChange={(e) => setFarmFilter(e.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              >
                <option value="all">{tHarvest("allFarms")}</option>
                {farms.map((farm) => (
                  <option key={farm} value={farm}>
                    {farm}
                  </option>
                ))}
              </select>
              <select
                value={grassFilter}
                onChange={(e) => setGrassFilter(e.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              >
                <option value="all">{t("allGrasses")}</option>
                {grassFilterOptions.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs text-muted-foreground">{t("totalEntries")}</p>
                <p className="text-2xl font-bold text-foreground">{filtered.length}</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs text-muted-foreground">{t("kpiDeliveredCount")}</p>
                <p className="text-2xl font-bold text-primary">
                  {filtered.filter((x) => x.status === "delivered").length}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs text-muted-foreground">{t("totalKg")}</p>
                <p className="text-2xl font-bold text-foreground">{totalKg.toLocaleString(locale)}</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs text-muted-foreground">{t("totalAreaM2")}</p>
                <p className="text-2xl font-bold text-foreground">{totalArea.toLocaleString(locale)}</p>
              </div>
            </div>

            <div className="space-y-3">
              {loading ? (
                <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
                  {t("loading")}
                </div>
              ) : error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center text-sm text-red-700">
                  {error}
                </div>
              ) : filtered.length === 0 ? (
                <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
                  {t("empty")}
                </div>
              ) : (
                filtered.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-sm"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-foreground">
                            {entry.project || t("harvestNumber", { id: entry.id })}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusStyles[entry.status]}`}
                          >
                            {tHarvest(harvestStatusKey(entry.status))}
                          </span>
                        </div>
                        <div className="text-sm text-foreground">
                          {entry.grassType || t("unknownGrass")} • {entry.quantity.toLocaleString(locale)}{" "}
                          {entry.quantityUom}{" "}
                          {entry.harvestType || t("defaultHarvestType")}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5" />
                            {entry.date ? formatDateDisplay(entry.date, locale) : ""}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {t("farmZone", { farm: entry.farm, zone: entry.zone })}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            {entry.startTime || t("allDay")}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Users className="h-3.5 w-3.5" />
                            {entry.crew || t("unassigned")}
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-foreground">
                          {entry.estimatedAreaM2.toLocaleString(locale)} m²
                        </p>
                        <p className="text-xs text-muted-foreground">{t("harvestArea")}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </DashboardLayout>
    </RequireAuth>
  );
}
