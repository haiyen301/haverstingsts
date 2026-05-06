"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

import {
  fetchHarvestRowsForForecasting,
  rowsToMockHarvestRows,
} from "@/features/forecasting/mapHarvestApiToForecastRows";
import type { ForecastHarvestRow } from "@/features/forecasting/forecastingTypes";
import { zoneIdToLabel } from "@/shared/lib/harvestReferenceData";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";

type ForecastPoint = {
  date: string;
  available: number;
  regrowing: number;
  max: number;
};

type SeriesPoint = {
  date: string;
  [key: string]: string | number;
};

function normalizeYmd(value: string): string {
  return value.trim().slice(0, 10);
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function ymdFromDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function parseYmdLocal(ymd: string): Date | null {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDayMonth(ymd: string): string {
  const d = parseYmdLocal(ymd);
  if (!d) return ymd;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

function formatDateLong(ymd: string): string {
  const d = parseYmdLocal(ymd);
  if (!d) return ymd;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function regrowthDaysFromHarvestType(t: ForecastHarvestRow["harvestType"]): number {
  return t === "sprig" ? 45 : 120;
}

export function InventoryForecast() {
  const farmZones = useHarvestingDataStore((s) => s.farmZones);
  const [filterFarm, setFilterFarm] = useState("");
  const [filterGrass, setFilterGrass] = useState("");
  const [forecastMonths, setForecastMonths] = useState<number>(6);
  const [rows, setRows] = useState<ForecastHarvestRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zoneLabel = (zoneId: string) => zoneIdToLabel(zoneId, farmZones) || zoneId;

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setError(null);

      const today = startOfLocalDay(new Date());
      const from = ymdFromDate(addMonths(today, -12));
      const to = ymdFromDate(addMonths(today, 18));

      const res = await fetchHarvestRowsForForecasting({
        actual_harvest_date_from: from,
        actual_harvest_date_to: to,
        perPage: 200,
        maxPages: 50,
      });

      if (!alive) return;
      const mapped = rowsToMockHarvestRows(res.rows, today);
      setRows(mapped);
      setError(res.error ?? null);
      setLoading(false);
    }

    void load();
    return () => {
      alive = false;
    };
  }, []);

  const availableFarms = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.farm).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [rows],
  );

  const availableGrasses = useMemo(
    () =>
      Array.from(
        new Set(
          rows
            .filter((r) => (!filterFarm ? true : r.farm === filterFarm))
            .map((r) => r.grassType)
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [rows, filterFarm],
  );

  const filteredRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!filterFarm || r.farm === filterFarm) &&
          (!filterGrass || r.grassType === filterGrass),
      ),
    [rows, filterFarm, filterGrass],
  );

  const maxByGroup = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filteredRows) {
      const key = `${r.farm}__${r.grassType}`;
      map.set(key, (map.get(key) ?? 0) + r.quantity);
    }
    return map;
  }, [filteredRows]);

  const totalMax = useMemo(
    () => Array.from(maxByGroup.values()).reduce((s, n) => s + n, 0),
    [maxByGroup],
  );

  const forecastData = useMemo<ForecastPoint[]>(() => {
    const today = startOfLocalDay(new Date());
    const weeks: ForecastPoint[] = [];
    const totalWeeks = Math.max(1, Math.round(forecastMonths * 4.33));

    for (let w = 0; w < totalWeeks; w++) {
      const forecastDate = addDays(today, w * 7);
      const dateStr = ymdFromDate(forecastDate);

      let totalAvailable = totalMax;
      let totalRegrowing = 0;

      for (const h of filteredRows) {
        const harvestDate = parseYmdLocal(normalizeYmd(h.harvestDate));
        if (!harvestDate) continue;
        if (harvestDate > forecastDate) continue;

        const regrowDate = addDays(harvestDate, regrowthDaysFromHarvestType(h.harvestType));
        if (regrowDate <= forecastDate) continue;

        const regrowMs = regrowDate.getTime() - harvestDate.getTime();
        if (regrowMs <= 0) continue;
        const elapsedRatio = Math.max(
          0,
          Math.min(
            1,
            (forecastDate.getTime() - harvestDate.getTime()) / regrowMs,
          ),
        );
        const depleted = h.quantity * (1 - elapsedRatio);
        totalRegrowing += depleted;
        totalAvailable -= depleted;
      }

      weeks.push({
        date: dateStr,
        available: Math.max(0, Math.round(totalAvailable)),
        regrowing: Math.max(0, Math.round(totalRegrowing)),
        max: Math.max(0, Math.round(totalMax)),
      });
    }
    return weeks;
  }, [filteredRows, forecastMonths, totalMax]);

  const breakdownMode: "grass" | "farm" = filterGrass ? "farm" : "grass";

  const seriesKeys = useMemo(() => {
    if (breakdownMode === "farm") {
      return Array.from(
        new Set(
          filteredRows
            .filter((r) => (!filterGrass ? true : r.grassType === filterGrass))
            .map((r) => r.farm)
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b));
    }
    return Array.from(new Set(filteredRows.map((r) => r.grassType).filter(Boolean))).sort(
      (a, b) => a.localeCompare(b),
    );
  }, [breakdownMode, filteredRows, filterGrass]);

  const forecastBySeries = useMemo<SeriesPoint[]>(() => {
    const today = startOfLocalDay(new Date());
    const totalWeeks = Math.max(1, Math.round(forecastMonths * 4.33));
    const points: SeriesPoint[] = [];

    for (let w = 0; w < totalWeeks; w++) {
      const forecastDate = addDays(today, w * 7);
      const row: SeriesPoint = { date: ymdFromDate(forecastDate) };
      for (const key of seriesKeys) row[key] = 0;

      const maxBySeries = new Map<string, number>();
      for (const h of filteredRows) {
        const seriesKey = breakdownMode === "farm" ? h.farm : h.grassType;
        maxBySeries.set(seriesKey, (maxBySeries.get(seriesKey) ?? 0) + h.quantity);
      }

      for (const h of filteredRows) {
        const seriesKey = breakdownMode === "farm" ? h.farm : h.grassType;
        const harvestDate = parseYmdLocal(normalizeYmd(h.harvestDate));
        if (!harvestDate) continue;
        if (harvestDate > forecastDate) continue;
        const regrowDate = addDays(harvestDate, regrowthDaysFromHarvestType(h.harvestType));
        if (regrowDate <= forecastDate) continue;
        const regrowMs = regrowDate.getTime() - harvestDate.getTime();
        if (regrowMs <= 0) continue;
        const elapsedRatio = Math.max(
          0,
          Math.min(
            1,
            (forecastDate.getTime() - harvestDate.getTime()) / regrowMs,
          ),
        );
        const depleted = h.quantity * (1 - elapsedRatio);
        const cur = Number(row[seriesKey] ?? maxBySeries.get(seriesKey) ?? 0);
        row[seriesKey] = Math.max(0, Math.round(cur - depleted));
      }

      for (const [key, v] of maxBySeries) {
        if (row[key] === 0) row[key] = Math.max(0, Math.round(v));
      }

      points.push(row);
    }

    return points;
  }, [filteredRows, forecastMonths, seriesKeys, breakdownMode]);

  const upcomingHarvests = useMemo(() => {
    const today = startOfLocalDay(new Date());
    const end = addMonths(today, forecastMonths);
    return filteredRows
      .filter((h) => {
        const d = parseYmdLocal(normalizeYmd(h.harvestDate));
        if (!d) return false;
        return d >= today && d <= end;
      })
      .map((h) => ({
        id: h.id,
        date: normalizeYmd(h.harvestDate),
        farm: h.farm,
        grass: h.grassType,
        zone: h.zone ?? "",
        project: h.project ?? "",
        customer: h.customer ?? "",
        qty: h.quantity,
        type: h.harvestType,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredRows, forecastMonths]);

  const upcomingTotalKg = useMemo(
    () => upcomingHarvests.reduce((s, h) => s + h.qty, 0),
    [upcomingHarvests],
  );

  const regrowthEvents = useMemo(() => {
    const today = startOfLocalDay(new Date());
    return filteredRows
      .map((h) => {
        const d = parseYmdLocal(normalizeYmd(h.harvestDate));
        if (!d) return null;
        const regrowDate = addDays(d, regrowthDaysFromHarvestType(h.harvestType));
        if (regrowDate <= today) return null;
        return {
          date: ymdFromDate(regrowDate),
          farm: h.farm,
          grass: h.grassType,
          qty: h.quantity,
          type: h.harvestType,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 15);
  }, [filteredRows]);

  const seriesPalette = [
    "hsl(152, 55%, 36%)",
    "hsl(28, 80%, 55%)",
    "hsl(210, 75%, 50%)",
    "hsl(280, 55%, 55%)",
    "hsl(345, 70%, 55%)",
    "hsl(45, 85%, 50%)",
    "hsl(180, 60%, 40%)",
    "hsl(95, 50%, 45%)",
  ];

  const seriesColors = useMemo(() => {
    const map: Record<string, string> = {};
    seriesKeys.forEach((key, idx) => {
      map[key] = seriesPalette[idx % seriesPalette.length];
    });
    return map;
  }, [seriesKeys]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-2xl font-bold">Inventory Forecasting</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Projected inventory levels over the next {forecastMonths} months from harvesting plan.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <select
          value={filterFarm}
          onChange={(e) => setFilterFarm(e.target.value)}
          className="rounded-lg border  border-border px-3 py-1.5 text-xs"
        >
          <option value="">All Farms</option>
          {availableFarms.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <select
          value={filterGrass}
          onChange={(e) => setFilterGrass(e.target.value)}
          className="rounded-lg border  border-border px-3 py-1.5 text-xs"
        >
          <option value="">All Grass Types</option>
          {availableGrasses.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <select
          value={forecastMonths}
          onChange={(e) => setForecastMonths(Number(e.target.value))}
          className="rounded-lg border  border-border px-3 py-1.5 text-xs"
        >
          <option value={6}>Next 6 Months</option>
          <option value={12}>Next 12 Months</option>
          <option value={18}>Next 18 Months</option>
        </select>
      </div>

      {loading ? (
        <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          Loading forecasting data...
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="rounded-xl border  border-border bg-card p-5">
        <h3 className="mb-4 text-sm font-semibold">Projected Available Inventory</h3>
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={forecastData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(214,18%,89%)" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => formatDayMonth(String(v))} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(Number(v) / 1000).toFixed(0)}k`} />
            <Tooltip
              formatter={(v: number, name: string) => [
                `${v.toLocaleString()} kg`,
                name === "available" ? "Available" : name === "max" ? "Max Capacity" : name,
              ]}
              labelFormatter={(v) => formatDateLong(String(v))}
            />
            <Area
              type="monotone"
              dataKey="max"
              stroke="hsl(214,18%,89%)"
              fill="hsl(214,18%,89%)"
              fillOpacity={0.3}
              strokeDasharray="4 4"
            />
            <Area
              type="monotone"
              dataKey="available"
              stroke="hsl(152,55%,36%)"
              fill="hsl(152,55%,36%)"
              fillOpacity={0.2}
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-xl border  border-border bg-card p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            {breakdownMode === "farm"
              ? `Projected Available Inventory by Farm - ${filterGrass}`
              : "Projected Available Inventory by Grass Type"}
          </h3>
          <div className="flex flex-wrap items-center gap-3">
            {seriesKeys.map((k) => (
              <div key={k} className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: seriesColors[k] }} />
                <span className="text-[11px] text-muted-foreground">{k}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          {breakdownMode === "farm"
            ? `Stacked breakdown of ${filterGrass} availability across each farm.`
            : "Stacked and colored per grass type to show each variety contribution."}
        </p>
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={forecastBySeries}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(214,18%,89%)" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => formatDayMonth(String(v))} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(Number(v) / 1000).toFixed(0)}k`} />
            <Tooltip
              formatter={(v: number, name: string) => [`${v.toLocaleString()} kg`, name]}
              labelFormatter={(v) => formatDateLong(String(v))}
            />
            {seriesKeys.map((k) => (
              <Area
                key={k}
                type="monotone"
                dataKey={k}
                stackId="1"
                stroke={seriesColors[k]}
                fill={seriesColors[k]}
                fillOpacity={0.45}
                strokeWidth={1.5}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Upcoming Harvests Driving the Forecast</h3>
          <span className="text-xs font-medium text-muted-foreground">
            {upcomingHarvests.length} harvest{upcomingHarvests.length !== 1 ? "s" : ""} .{" "}
            {upcomingTotalKg.toLocaleString()} kg
          </span>
        </div>
        {upcomingHarvests.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No upcoming harvests in this horizon for the current filters.
          </p>
        ) : (
          <div className="max-h-[360px] space-y-1 overflow-y-auto pr-1">
            {upcomingHarvests.map((h) => (
              <div
                key={h.id}
                className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-[hsl(var(--muted)/0.3)]"
              >
                <div className="h-2 w-2 shrink-0 rounded-full bg-accent" />
                <div className="min-w-[90px] text-sm font-medium">{formatDayMonth(h.date)}</div>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate">
                    <span className="font-medium">{h.farm}</span>
                    <span className="text-muted-foreground"> . {h.grass} {zoneLabel(h.zone)}</span>
                  </p>
                  {(h.project || h.customer) && (
                    <p className="text-[11px] text-muted-foreground truncate">
                      {h.customer}{h.customer && h.project ? ' · ' : ''}{h.project}
                    </p>
                  )}
                </div>
                <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
                  Scheduled
                </span>
                <span className="w-20 text-right text-sm font-medium text-destructive">
                  -{h.qty.toLocaleString()} kg
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="mb-4 text-sm font-semibold">Upcoming Regrowth Events</h3>
        <p className="mb-4 text-xs text-muted-foreground">Inventory will be re-credited on these dates.</p>
        {regrowthEvents.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No upcoming regrowth events.</p>
        ) : (
          <div className="space-y-2">
            {regrowthEvents.map((ev, i) => (
              <div
                key={`${ev.date}-${ev.farm}-${ev.grass}-${i}`}
                className="flex items-center gap-4 rounded-lg px-3 py-2.5 hover:bg-[hsl(var(--muted)/0.3)]"
              >
                <div className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                <div className="min-w-[90px] text-sm font-medium">{formatDayMonth(ev.date)}</div>
                <div className="flex-1 text-sm">
                  <span className="font-medium">{ev.farm}</span>
                  <span className="text-muted-foreground"> . {ev.grass}</span>
                </div>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  {ev.type}
                </span>
                <span className="w-20 text-right text-sm font-medium">+{ev.qty.toLocaleString()} kg</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
