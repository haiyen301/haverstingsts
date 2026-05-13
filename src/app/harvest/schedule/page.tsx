"use client";

import { useEffect, useMemo, useState } from "react";
import { Calendar, Clock, MapPin, Users } from "lucide-react";

import RequireAuth from "@/features/auth/RequireAuth";
import { stsProxyGetHarvestingIndex } from "@/shared/api/stsProxyClient";
import { harvestTypeDisplayLabel } from "@/shared/lib/harvestType";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

type RangePreset = "today" | "this-week" | "next-week" | "next-month";

type ScheduleStatus = "planned" | "scheduled" | "harvested" | "delivered";

type ScheduleEntry = {
  id: string;
  date: string;
  project: string;
  farm: string;
  zone: string;
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

const rangeLabels: Record<RangePreset, string> = {
  today: "Today",
  "this-week": "This week",
  "next-week": "Next week",
  "next-month": "Next month",
};

const statusStyles: Record<ScheduleStatus, string> = {
  planned: "bg-slate-100 text-slate-700",
  scheduled: "bg-blue-100 text-blue-700",
  harvested: "bg-amber-100 text-amber-700",
  delivered: "bg-green-100 text-green-700",
};

const statusLabels: Record<ScheduleStatus, string> = {
  planned: "Planned",
  scheduled: "Scheduled",
  harvested: "Harvested",
  delivered: "Delivered",
};

function isValidHarvestDateString(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s || s === "0000-00-00") return false;
  return true;
}

function formatDateDisplay(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return date.toLocaleDateString("en-US", {
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
  return "All day";
}

function normalizeHarvestType(raw: Record<string, unknown>): string {
  return harvestTypeDisplayLabel(raw.harvest_type ?? raw.load_type ?? "") || "Harvest";
}

function normalizeCrew(raw: Record<string, unknown>): string {
  const value = String(raw.assigned_to ?? "").trim();
  if (!value) return "Unassigned";
  return value;
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
    project: String(r.project_name ?? "").trim() || `Harvest #${id}`,
    farm: String(r.farm_name ?? "").trim(),
    zone: String(r.zone ?? "").trim(),
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

export default function HarvestSchedulePage() {
  const [range, setRange] = useState<RangePreset>("this-week");
  const [farmFilter, setFarmFilter] = useState("all");
  const [grassFilter, setGrassFilter] = useState("all");
  const [scheduleRows, setScheduleRows] = useState<ScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        setError(loadError instanceof Error ? loadError.message : "Failed to load harvest schedule.");
        setScheduleRows([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [start, end]);

  const farms = useMemo(
    () => Array.from(new Set(scheduleRows.map((x) => x.farm).filter(Boolean))).sort(),
    [scheduleRows],
  );
  const grasses = useMemo(
    () => Array.from(new Set(scheduleRows.map((x) => x.grassType).filter(Boolean))).sort(),
    [scheduleRows],
  );

  const filtered = useMemo(
    () =>
      scheduleRows
        .filter((entry) => {
          if (farmFilter !== "all" && entry.farm !== farmFilter) return false;
          if (grassFilter !== "all" && entry.grassType !== grassFilter) return false;
          return true;
        })
        .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)),
    [scheduleRows, farmFilter, grassFilter],
  );

  const totalArea = filtered.reduce((sum, entry) => sum + entry.estimatedAreaM2, 0);
  const totalKg = filtered.reduce(
    (sum, entry) => sum + (isKgUom(entry.quantityUom) ? entry.quantity : 0),
    0,
  );

  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="min-h-full p-4 lg:p-8">
          <div className="mx-auto max-w-7xl space-y-6">
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-bold text-foreground">Harvest Schedule</h1>
              <p className="text-sm text-muted-foreground">
                Live harvesting data grouped by schedule range.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-3">
              <div className="flex flex-wrap gap-2">
                {(Object.keys(rangeLabels) as RangePreset[]).map((p) => (
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
                    {rangeLabels[p]}
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
                <option value="all">All farms</option>
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
                <option value="all">All grasses</option>
                {grasses.map((grass) => (
                  <option key={grass} value={grass}>
                    {grass}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs text-muted-foreground">Total Entries</p>
                <p className="text-2xl font-bold text-foreground">{filtered.length}</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs text-muted-foreground">Delivered</p>
                <p className="text-2xl font-bold text-primary">
                  {filtered.filter((x) => x.status === "delivered").length}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs text-muted-foreground">Total KG</p>
                <p className="text-2xl font-bold text-foreground">{totalKg.toLocaleString()}</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs text-muted-foreground">Total Area (m²)</p>
                <p className="text-2xl font-bold text-foreground">{totalArea.toLocaleString()}</p>
              </div>
            </div>

            <div className="space-y-3">
              {loading ? (
                <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
                  Loading harvest schedule...
                </div>
              ) : error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center text-sm text-red-700">
                  {error}
                </div>
              ) : filtered.length === 0 ? (
                <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
                  No harvest entries scheduled for this period.
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
                          <span className="font-semibold text-foreground">{entry.project}</span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusStyles[entry.status]}`}
                          >
                            {statusLabels[entry.status]}
                          </span>
                        </div>
                        <div className="text-sm text-foreground">
                          {entry.grassType || "Unknown grass"} • {entry.quantity.toLocaleString()}{" "}
                          {entry.quantityUom} {entry.harvestType}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5" />
                            {formatDateDisplay(entry.date)}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {entry.farm} - Zone {entry.zone}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            {entry.startTime}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Users className="h-3.5 w-3.5" />
                            {entry.crew}
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-foreground">
                          {entry.estimatedAreaM2.toLocaleString()} m²
                        </p>
                        <p className="text-xs text-muted-foreground">harvest area</p>
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
