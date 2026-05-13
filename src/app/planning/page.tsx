"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import RequireAuth from "@/features/auth/RequireAuth";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { fetchMondayProjectRowsFromServer, type MondayProjectServerRow } from "@/entities/projects";
import { parseQuantityRequiredRows, parseSubitems } from "@/shared/lib/parseJsonMaybe";
import { useAppTranslations } from "@/shared/i18n/useAppTranslations";
import { cn } from "@/lib/utils";
import { bgSurfaceFilter } from "@/shared/lib/surfaceFilter";

type ScheduleType = "Harvest" | "Delivery";

type ScheduleEntry = {
  id: string;
  date: string;
  project: string;
  grass: string;
  qty: number;
  unit: string;
  farm: string;
  type: ScheduleType;
};

function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function mondayFirstOffset(firstDay: Date): number {
  // JS: Sun=0..Sat=6; wanted: Mon=0..Sun=6
  return (firstDay.getDay() + 6) % 7;
}

function normalizeMonthGrid(currentMonth: Date): Date[] {
  const first = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - mondayFirstOffset(first));

  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function toDateOnly(value: unknown): string | null {
  const s = String(value ?? "").trim();
  if (!s || s === "0000-00-00" || s === "null") return null;
  return s.includes(" ") ? s.split(" ")[0] : s;
}

function parseQuantity(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function normalizeUnit(v: unknown): string {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "kg";
  if (s === "m2" || s === "m²" || s === "sqm") return "m2";
  if (s === "kg" || s === "kgs") return "kg";
  return String(v ?? "").trim();
}

export default function PlanningPage() {
  const tBase = useAppTranslations();
  const t = (key: string) => tBase(`Planning.${key}`);
  const tCommon = (key: string) => tBase(`Common.${key}`);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [rows, setRows] = useState<MondayProjectServerRow[]>([]);
  const [loading, setLoading] = useState(true);

  const farmsRef = useHarvestingDataStore((s) => s.farms);
  const projectsRef = useHarvestingDataStore((s) => s.projects);
  const productsRef = useHarvestingDataStore((s) => s.products);
  const fetchAllHarvestingReferenceData = useHarvestingDataStore((s) => s.fetchAllHarvestingReferenceData);

  useEffect(() => {
    void fetchAllHarvestingReferenceData();
  }, [fetchAllHarvestingReferenceData]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        setLoading(true);
        const res = await fetchMondayProjectRowsFromServer({ page: 1, perPage: 300 });
        if (!mounted) return;
        setRows(res.rows);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const monthDays = normalizeMonthGrid(currentMonth);
  const monthSelectValue = String(month + 1);
  const yearSelectValue = String(year);

  const previousMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));
  const changeMonth = (value: string) => {
    const m = Math.max(1, Math.min(12, Number(value))) - 1;
    setCurrentMonth(new Date(year, m, 1));
  };
  const changeYear = (value: string) => {
    const y = Number(value);
    if (!Number.isFinite(y)) return;
    setCurrentMonth(new Date(y, month, 1));
  };
  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    return Array.from({ length: 11 }, (_, i) => current - 5 + i);
  }, []);

  const farmNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of farmsRef) {
      if (!f || typeof f !== "object") continue;
      const rec = f as Record<string, unknown>;
      const id = String(rec.id ?? "").trim();
      const name = String(rec.name ?? rec.title ?? "").trim();
      if (id && name) map.set(id, name);
    }
    return map;
  }, [farmsRef]);

  const productNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of productsRef) {
      if (!p || typeof p !== "object") continue;
      const rec = p as Record<string, unknown>;
      const id = String(rec.id ?? "").trim();
      const name = String(rec.name ?? rec.title ?? "").trim();
      if (id && name) map.set(id, name);
    }
    return map;
  }, [productsRef]);

  const projectTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projectsRef) {
      if (!p || typeof p !== "object") continue;
      const rec = p as Record<string, unknown>;
      const id = String(rec.id ?? "").trim();
      const title = String(rec.title ?? rec.name ?? "").trim();
      if (id && title) map.set(id, title);
    }
    return map;
  }, [projectsRef]);

  const scheduleEntries = useMemo(() => {
    const list: ScheduleEntry[] = [];
    for (const row of rows) {
      const rowId = String(row.row_id ?? row.id ?? "").trim() || String(Math.random());
      const projectId = String(row.project_id ?? "").trim();
      const projectTitle =
        String(row.title ?? row.name ?? "").trim() ||
        projectTitleById.get(projectId) ||
        t("unknownProject");

      const requirementsRaw = row.quantity_required_sprig_sod;
      const requirements = parseQuantityRequiredRows(requirementsRaw);
      const requirementByProduct = new Map<string, { uom: string }>();
      for (const req of requirements) {
        const pid = String(req.product_id ?? "").trim();
        if (!pid) continue;
        requirementByProduct.set(pid, { uom: normalizeUnit(req.uom) });
      }

      const subitems = parseSubitems(row.subitems);
      for (let i = 0; i < subitems.length; i++) {
        const item = subitems[i];
        const productId = String(item.product_id ?? "").trim();
        const farmId = String(item.farm_id ?? "").trim();
        const grass = productNameById.get(productId) || productId || t("notAvailable");
        const farm = farmNameById.get(farmId) || farmId || t("notAvailable");
        const qty = parseQuantity(item.quantity_harvested ?? item.quantity ?? item.qty);
        const unit = normalizeUnit(item.uom ?? requirementByProduct.get(productId)?.uom ?? "kg");

        const actualDate = toDateOnly(item.actual_harvest_date);
        if (actualDate) {
          list.push({
            id: `${rowId}-h-${i}`,
            date: actualDate,
            project: projectTitle,
            grass,
            qty,
            unit,
            farm,
            type: "Harvest",
          });
        }

        const deliveryDate = toDateOnly(item.delivery_date ?? item.delivery_datetime ?? item.actual_delivery_date);
        if (deliveryDate) {
          list.push({
            id: `${rowId}-d-${i}`,
            date: deliveryDate,
            project: projectTitle,
            grass,
            qty,
            unit,
            farm,
            type: "Delivery",
          });
        }
      }
    }
    list.sort((a, b) => a.date.localeCompare(b.date));
    return list;
  }, [rows, projectTitleById, productNameById, farmNameById]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, ScheduleEntry[]>();
    for (const event of scheduleEntries) {
      const row = map.get(event.date) ?? [];
      row.push(event);
      map.set(event.date, row);
    }
    return map;
  }, [scheduleEntries]);

  const upcomingSchedule = useMemo(() => {
    if (!scheduleEntries.length) return [];
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);
    const startKey = toDateKey(monthStart);
    const endKey = toDateKey(monthEnd);

    const inMonth = scheduleEntries.filter((x) => x.date >= startKey && x.date <= endKey);
    return inMonth.slice(0, 8);
  }, [scheduleEntries, year, month]);

  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="p-4 lg:p-8">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-2xl lg:text-3xl font-semibold text-gray-900">{t("title")}</h1>
          </div>

          <div className="mb-6 overflow-hidden rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-200 p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <select
                  value={monthSelectValue}
                  onChange={(e) => changeMonth(e.target.value)}
                  className={cn(
                    "rounded-md border border-input px-2 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                    bgSurfaceFilter(true),
                  )}
                  aria-label={t("filterByMonthAria")}
                >
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {new Date(2000, i, 1).toLocaleDateString("en-US", { month: "long" })}
                    </option>
                  ))}
                </select>
                <select
                  value={yearSelectValue}
                  onChange={(e) => changeYear(e.target.value)}
                  className={cn(
                    "rounded-md border border-input px-2 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                    bgSurfaceFilter(true),
                  )}
                  aria-label={t("filterByYearAria")}
                >
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
              <h2 className="text-lg font-semibold text-gray-900">
                {currentMonth.toLocaleDateString("en-US", {
                  month: "long",
                  year: "numeric",
                })}
              </h2>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={previousMonth}
                  className="rounded-lg p-2 transition-colors hover:bg-gray-100"
                  type="button"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  onClick={nextMonth}
                  className="rounded-lg p-2 transition-colors hover:bg-gray-100"
                  type="button"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="p-4">
              {loading ? (
                <p className="text-sm text-gray-500">{t("loadingSchedule")}</p>
              ) : (
                <>
                  <div className="mb-2 grid grid-cols-7 gap-2">
                    {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((day) => (
                      <div
                        key={day}
                        className="py-2 text-center text-sm font-medium text-gray-600"
                      >
                        {day}
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-2">
                    {monthDays.map((date) => {
                      const key = toDateKey(date);
                      const events = eventsByDate.get(key) ?? [];
                      const isCurrentMonth = date.getMonth() === currentMonth.getMonth();
                      const isToday = key === toDateKey(new Date());
                      const isSelected = key === toDateKey(selectedDate);

                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => {
                            if (!isCurrentMonth) return;
                            setSelectedDate(date);
                          }}
                          className={`aspect-square rounded-lg border p-2 text-left transition-colors ${
                            isCurrentMonth
                              ? "border-gray-200 hover:border-[#1F7A4C]"
                              : "border-gray-100 bg-gray-50 text-gray-300"
                          } ${isToday ? "border-[#1F7A4C] bg-green-50" : ""} ${
                            isSelected && !isToday ? "border-[#1F7A4C]" : ""
                          }`}
                        >
                          <div className={`mb-1 text-sm font-medium ${isToday ? "text-foreground" : "text-gray-900"}`}>
                            {date.getDate()}
                          </div>
                          <div className="space-y-1">
                            {events.slice(0, 2).map((event) => (
                              <div
                                key={event.id}
                                className={`truncate rounded px-1 py-0.5 text-xs ${
                                  event.type === "Harvest"
                                    ? "bg-blue-100 text-blue-800"
                                    : "bg-green-100 text-green-800"
                                }`}
                                title={event.project}
                              >
                                {event.project}
                              </div>
                            ))}
                            {events.length > 2 ? (
                              <div className="text-xs text-gray-500">+{events.length - 2} {t("more")}</div>
                            ) : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">{t("upcomingSchedule")}</h2>
            </div>
            <div className="divide-y divide-gray-200">
              {upcomingSchedule.length === 0 ? (
                <p className="p-4 text-sm text-gray-500">{t("emptyUpcoming")}</p>
              ) : (
                upcomingSchedule.map((event) => (
                  <div key={event.id} className="p-4 transition-colors hover:bg-gray-50">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex-1">
                        <div className="mb-1 flex items-center gap-2">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                              event.type === "Harvest"
                                ? "bg-blue-100 text-blue-800"
                                : "bg-green-100 text-green-800"
                            }`}
                          >
                            {event.type}
                          </span>
                          <span className="font-medium text-gray-900">{event.project}</span>
                        </div>
                        <div className="space-y-0.5 text-sm text-gray-700">
                          <div><span className="font-medium text-foreground">{t("grassesLabel")}:</span> {event.grass}</div>
                          <div><span className="font-medium text-foreground">{tCommon("farm")}:</span> {event.farm}</div>
                          <div><span className="font-medium text-foreground">{tCommon("quantity")}:</span> {event.qty.toLocaleString()} {event.unit}</div>
                        </div>
                      </div>
                      <div className="text-sm text-gray-600">
                        {new Date(`${event.date}T00:00:00`).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
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

