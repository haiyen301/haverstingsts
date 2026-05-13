"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardEdit, RotateCcw, X } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { toast } from "react-toastify";

import RequireAuth from "@/features/auth/RequireAuth";
import {
  fetchRegrowthRules,
  fetchZoneConfigurations,
  type RegrowthRuleRow,
  type ZoneConfigurationRow,
} from "@/features/admin/api/adminApi";
import {
  DEFAULT_REGROWTH_REFERENCE_CONFIG,
  resolveRegrowthReferenceConfigFromRules,
} from "@/features/forecasting/forecastingRegrowth";
import {
  applyInventoryAvailableOverridesToZoneMap,
  type AppliedInventoryAvailableOverride,
} from "@/features/forecasting/inventoryAvailableOverrides";
import {
  computeCappedAvailableByZoneAtDate,
  computeZoneCapacityMap,
  forecastZoneKeyFromParts,
  forecastZoneKeyFromRow,
} from "@/features/forecasting/inventoryRegrowthCalculator";
import {
  fetchHarvestRowsForForecasting,
  rowsToMockHarvestRows,
} from "@/features/forecasting/mapHarvestApiToForecastRows";
import type { ForecastHarvestRow } from "@/features/forecasting/forecastingTypes";
import { zoneIdToLabel } from "@/shared/lib/harvestReferenceData";
import { DatePicker } from "@/shared/ui/date-picker";
import type { InventoryAvailableOverrideEntry } from "@/shared/store/inventoryAvailableOverrideStore";
import { useInventoryAvailableOverrideStore } from "@/shared/store/inventoryAvailableOverrideStore";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

type InventoryRow = {
  key: string;
  zoneConfigurationId: number | null;
  forecastZoneKey: string;
  farmId: number;
  grassId: number;
  farmName: string;
  turfgrass: string;
  zone: string;
  sizeM2: number;
  inventoryKgPerM2: number;
  maxKg: number;
  calculatedKg: number;
  currentKg: number;
  pct: number;
  manualOverrideKg: number | null;
  manualOverrideDate: string | null;
  isManualOverrideActive: boolean;
};

const FARM_COLORS: Record<string, string> = {
  "Hoi An": "hsl(85, 80%, 41%)",
  "Phan Thiet": "hsl(152, 55%, 36%)",
  "Ban Bueng": "hsl(35, 92%, 52%)",
  "Laem Chabang": "hsl(28, 35%, 56%)",
  "Semenyih": "hsl(210, 70%, 50%)",
};

function toNum(v: string | number | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
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

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function formatShortDate(ymd: string | null | undefined): string {
  if (!ymd) return "";
  const m = String(ymd).trim().slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(ymd);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function formatBalanceInput(value: string | number | null | undefined): string {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  if (!digits) return "";
  return Number(digits).toLocaleString();
}

function parseBalanceInput(value: string | number | null | undefined): number {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  if (!digits) return Number.NaN;
  return Number(digits);
}

function buildZoneConfigurationCapacityMap(rows: ZoneConfigurationRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const sizeM2 = toNum(row.size_m2);
    const inventoryKgPerM2 = toNum(row.inventory_kg_per_m2);
    const maxKgRaw = toNum(row.max_inventory_kg);
    const maxKg = maxKgRaw > 0 ? maxKgRaw : sizeM2 * inventoryKgPerM2;
    const key = forecastZoneKeyFromParts(row.farm_id, String(row.zone ?? ""), row.grass_id);
    out.set(key, Math.max(out.get(key) ?? 0, maxKg));
  }
  return out;
}

/** When zone configuration is empty, list one row per harvest-derived zone key (same basis as Inventory Forecast). */
function buildInventoryRowsFromHarvestOnly(
  forecastRows: ForecastHarvestRow[],
  calculatedByZone: Map<string, number>,
  adjustedByZone: Map<string, number>,
  appliedByZone: Map<string, AppliedInventoryAvailableOverride>,
): InventoryRow[] {
  const maxMap = computeZoneCapacityMap(forecastRows);
  const meta = new Map<
    string,
    { farmId: number; grassId: number; farmName: string; turfgrass: string; zone: string }
  >();
  for (const r of forecastRows) {
    const k = forecastZoneKeyFromRow(r);
    if (!meta.has(k)) {
      meta.set(k, {
        farmId: Number(r.farmId) || 0,
        grassId: Number(r.productId) || 0,
        farmName: String(r.farm ?? "").trim(),
        turfgrass: String(r.grassType ?? "").trim(),
        zone: String(r.zone ?? "").trim(),
      });
    }
  }
  const keys = Array.from(
    new Set([...maxMap.keys(), ...calculatedByZone.keys(), ...adjustedByZone.keys(), ...meta.keys()]),
  );
  return keys.map((key, i) => {
    const m = meta.get(key) ?? { farmId: 0, grassId: 0, farmName: "", turfgrass: "", zone: "" };
    const maxKg = maxMap.get(key) ?? 0;
    const calculatedKgRaw = Math.round(calculatedByZone.get(key) ?? 0);
    const currentKgRaw = Math.round(adjustedByZone.get(key) ?? calculatedKgRaw);
    const calculatedKg = maxKg > 0 ? Math.min(maxKg, Math.max(0, calculatedKgRaw)) : Math.max(0, calculatedKgRaw);
    const currentKg = Math.max(0, currentKgRaw);
    const pct = maxKg > 0 ? Math.min(100, Math.round((currentKg / maxKg) * 100)) : 0;
    const applied = appliedByZone.get(key) ?? null;
    return {
      key: `harvest:${key}:${i}`,
      zoneConfigurationId: null,
      forecastZoneKey: key,
      farmId: m.farmId,
      grassId: m.grassId,
      farmName: m.farmName,
      turfgrass: m.turfgrass,
      zone: m.zone,
      sizeM2: 0,
      inventoryKgPerM2: 0,
      maxKg,
      calculatedKg,
      currentKg,
      pct,
      manualOverrideKg: applied?.override.availableKg ?? null,
      manualOverrideDate: applied?.override.date ?? null,
      isManualOverrideActive: !!applied,
    };
  });
}

function mapZoneToInventoryRow(
  row: ZoneConfigurationRow,
  calculatedByZone: Map<string, number>,
  adjustedByZone: Map<string, number>,
  appliedByZone: Map<string, AppliedInventoryAvailableOverride>,
): InventoryRow {
  const sizeM2 = toNum(row.size_m2);
  const inventoryKgPerM2 = toNum(row.inventory_kg_per_m2);
  const maxKgRaw = toNum(row.max_inventory_kg);
  const maxKg = maxKgRaw > 0 ? maxKgRaw : sizeM2 * inventoryKgPerM2;
  const key = forecastZoneKeyFromParts(row.farm_id, String(row.zone ?? ""), row.grass_id);
  const calculatedAvailable = calculatedByZone.get(key) ?? 0;
  const adjustedAvailable = adjustedByZone.get(key) ?? calculatedAvailable;
  const calculatedKg = Math.round(Math.min(maxKg, Math.max(0, calculatedAvailable)));
  const currentKg = Math.round(Math.max(0, adjustedAvailable));
  const pct = maxKg > 0 ? Math.min(100, Math.round((currentKg / maxKg) * 100)) : 0;
  const applied = appliedByZone.get(key) ?? null;
  return {
    key: String(row.id),
    zoneConfigurationId: Number(row.id) || null,
    forecastZoneKey: key,
    farmId: Number(row.farm_id) || 0,
    grassId: Number(row.grass_id) || 0,
    farmName: String(row.farm_name ?? "").trim(),
    turfgrass: String(row.turfgrass ?? "").trim(),
    zone: String(row.zone ?? "").trim(),
    sizeM2,
    inventoryKgPerM2,
    maxKg,
    calculatedKg,
    currentKg,
    pct,
    manualOverrideKg: applied?.override.availableKg ?? null,
    manualOverrideDate: applied?.override.date ?? null,
    isManualOverrideActive: !!applied,
  };
}

export default function InventoryPage() {
  const [zoneConfigurations, setZoneConfigurations] = useState<ZoneConfigurationRow[]>([]);
  const [forecastRows, setForecastRows] = useState<ForecastHarvestRow[]>([]);
  const [regrowthConfig, setRegrowthConfig] = useState(
    DEFAULT_REGROWTH_REFERENCE_CONFIG,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterFarm, setFilterFarm] = useState("");
  const [filterGrass, setFilterGrass] = useState("");
  const [drillFarm, setDrillFarm] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [selectedFarm, setSelectedFarm] = useState("");
  const [updateDate, setUpdateDate] = useState(() => ymdFromDate(startOfLocalDay(new Date())));
  const [balanceUpdates, setBalanceUpdates] = useState<Record<string, string>>({});

  const overridesByZone = useInventoryAvailableOverrideStore((s) => s.overridesByZone);
  const fetchOverrides = useInventoryAvailableOverrideStore((s) => s.fetchOverrides);
  const upsertOverrides = useInventoryAvailableOverrideStore((s) => s.upsertOverrides);
  const removeOverride = useInventoryAvailableOverrideStore((s) => s.removeOverride);
  const farmZones = useHarvestingDataStore((s) => s.farmZones);

  const zoneLabel = (zoneId: string) => zoneIdToLabel(zoneId, farmZones) || zoneId;

  useEffect(() => {
    if (!error) return;
    toast.error(error, { toastId: `inventory-error:${error}` });
  }, [error]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        const today = startOfLocalDay(new Date());
        const from = ymdFromDate(addMonths(today, -12));
        const to = ymdFromDate(addMonths(today, 18));

        const [zones, harvestRes, rules] = await Promise.all([
          fetchZoneConfigurations(),
          fetchHarvestRowsForForecasting({
            actual_harvest_date_from: from,
            actual_harvest_date_to: to,
            perPage: 200,
            maxPages: 50,
          }),
          fetchRegrowthRules().catch(() => [] as RegrowthRuleRow[]),
        ]);
        if (!alive) return;

        if (harvestRes.error) setError(harvestRes.error);

        setZoneConfigurations(zones);
        setForecastRows(rowsToMockHarvestRows(harvestRes.rows, today, zones));
        setRegrowthConfig(resolveRegrowthReferenceConfigFromRules(rules));
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load inventory data.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    void fetchOverrides();
  }, [fetchOverrides]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const rows = useMemo(() => {
    const today = startOfLocalDay(new Date());
    const calculatedByZone = computeCappedAvailableByZoneAtDate(
      forecastRows,
      regrowthConfig,
      today,
    );
    const maxByZone =
      zoneConfigurations.length > 0
        ? buildZoneConfigurationCapacityMap(zoneConfigurations)
        : computeZoneCapacityMap(forecastRows);
    const { adjustedByZone, appliedByZone } = applyInventoryAvailableOverridesToZoneMap({
      availableByZone: calculatedByZone,
      maxByZone,
      overridesByZone,
      asOf: today,
      overrideRecoveryDays: regrowthConfig.overrideRecoveryDays,
    });

    if (zoneConfigurations.length > 0) {
      return zoneConfigurations.map((row) =>
        mapZoneToInventoryRow(row, calculatedByZone, adjustedByZone, appliedByZone),
      );
    }
    return buildInventoryRowsFromHarvestOnly(
      forecastRows,
      calculatedByZone,
      adjustedByZone,
      appliedByZone,
    );
  }, [forecastRows, overridesByZone, regrowthConfig, zoneConfigurations]);

  const availableFarms = useMemo(
    () => Array.from(new Set(rows.map((r) => r.farmName).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const availableGrasses = useMemo(
    () =>
      Array.from(
        new Set(
          rows
            .filter((r) => (!filterFarm ? true : r.farmName === filterFarm))
            .map((r) => r.turfgrass)
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [rows, filterFarm],
  );

  const inventory = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!filterFarm || r.farmName === filterFarm) &&
          (!filterGrass || r.turfgrass === filterGrass),
      ),
    [rows, filterFarm, filterGrass],
  );

  const updateZones = useMemo(
    () =>
      selectedFarm
        ? rows
            .filter((r) => r.farmName === selectedFarm)
            .sort((a, b) =>
              a.turfgrass === b.turfgrass
                ? zoneLabel(a.zone).localeCompare(zoneLabel(b.zone))
                : a.turfgrass.localeCompare(b.turfgrass),
            )
        : [],
    [rows, selectedFarm, farmZones],
  );

  const activeOverrideCount = useMemo(
    () => rows.filter((r) => r.isManualOverrideActive).length,
    [rows],
  );

  useEffect(() => {
    if (!updateOpen) return;
    setSelectedFarm((prev) => (prev && availableFarms.includes(prev) ? prev : (availableFarms[0] ?? "")));
  }, [availableFarms, updateOpen]);

  useEffect(() => {
    if (!updateOpen) return;
    const next: Record<string, string> = {};
    for (const row of updateZones) {
      const existing = overridesByZone[row.forecastZoneKey];
      if (existing) next[row.key] = formatBalanceInput(existing.availableKg);
    }
    setBalanceUpdates(next);
  }, [overridesByZone, updateOpen, updateZones]);

  async function handleSaveUpdates() {
    const updates: InventoryAvailableOverrideEntry[] = [];
    for (const row of updateZones) {
      const raw = String(balanceUpdates[row.key] ?? "").trim();
      if (!raw) continue;
      const availableKg = parseBalanceInput(raw);
      if (!Number.isFinite(availableKg) || availableKg < 0) continue;
      updates.push({
        id: overridesByZone[row.forecastZoneKey]?.id ?? 0,
        zoneKey: row.forecastZoneKey,
        zoneConfigurationId: row.zoneConfigurationId,
        farmId: row.farmId,
        grassId: row.grassId,
        farmName: row.farmName,
        turfgrass: row.turfgrass,
        zone: row.zone,
        availableKg,
        calculatedKg: row.calculatedKg,
        date: updateDate,
        updatedAt: new Date().toISOString(),
      });
    }

    if (updates.length === 0) {
      setNotice("Please enter at least one updated balance.");
      return;
    }

    try {
      await upsertOverrides(updates);
      setNotice(`Saved ${updates.length} manual balance override(s) for ${selectedFarm}.`);
      setBalanceUpdates({});
      setUpdateOpen(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Failed to save balance updates.");
    }
  }

  const stackedByGrass = useMemo(() => {
    const allGrasses = Array.from(new Set(rows.map((r) => r.turfgrass))).sort((a, b) => a.localeCompare(b));
    return allGrasses
      .map((grass) => {
        const row: Record<string, string | number> = { grass };
        let total = 0;
        for (const farm of availableFarms) {
          const v = rows
            .filter((z) => z.turfgrass === grass && z.farmName === farm)
            .reduce((s, z) => s + z.currentKg, 0);
          row[farm] = v;
          total += v;
        }
        row.total = total;
        return row;
      })
      .filter((r) => (r.total as number) > 0);
  }, [rows, availableFarms]);

  const companyTotalKg = useMemo(
    () => stackedByGrass.reduce((s, r) => s + (r.total as number), 0),
    [stackedByGrass],
  );

  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="space-y-6 p-4 lg:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl lg:text-3xl font-semibold text-gray-900">Inventory Balance</h1>
              <p className="mt-1 text-sm text-gray-600">
                Balance across all farm zones
              </p>
            </div>
            <button
              type="button"
              onClick={() => setUpdateOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium text-foreground shadow-sm transition hover:bg-muted/40"
            >
              <ClipboardEdit className="h-4 w-4" />
              Update Inventory
            </button>
          </div>

          <div className="flex gap-3 flex-wrap">
            <select
              value={filterFarm}
              onChange={(e) => setFilterFarm(e.target.value)}
              className="px-3 py-1.5 rounded-lg text-xs bg-muted border border-border text-foreground"
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
              className="px-3 py-1.5 rounded-lg text-xs bg-muted border border-border text-foreground"
            >
              <option value="">All Grass Types</option>
              {availableGrasses.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>

          {notice ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {notice}
            </div>
          ) : null}

          {loading ? <p className="text-sm text-gray-500">Loading inventory...</p> : null}
          
          {updateOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-xl border border-border bg-white shadow-2xl">
                <div className="flex items-center justify-between border-b border-border px-5 py-4">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">Monthly Inventory Balance Update</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Manual balance overrides the system value for the selected zone, then fades back
                      using the override recovery rule.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setUpdateOpen(false);
                      setBalanceUpdates({});
                    }}
                    className="rounded-md p-2 text-muted-foreground transition hover:bg-muted/40 hover:text-foreground"
                    aria-label="Close update inventory dialog"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="space-y-4 overflow-y-auto p-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-2 text-sm">
                      <span className="font-medium text-foreground">Farm</span>
                      <select
                        value={selectedFarm}
                        onChange={(e) => setSelectedFarm(e.target.value)}
                        className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground"
                      >
                        <option value="">Select farm</option>
                        {availableFarms.map((farm) => (
                          <option key={farm} value={farm}>
                            {farm}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-2 text-sm">
                      <span className="font-medium text-foreground">Update Date</span>
                      <DatePicker
                        value={updateDate}
                        onChange={setUpdateDate}
                      />
                    </label>
                  </div>

                  {selectedFarm ? (
                    updateZones.length > 0 ? (
                      <div className="max-h-[52vh] overflow-x-auto overflow-y-auto rounded-lg border border-border">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="">
                              <th className="sticky top-0 px-3 py-2 text-left font-medium bg-muted text-muted-foreground">Grass Type</th>
                              <th className="sticky top-0 px-3 py-2 text-left font-medium bg-muted text-muted-foreground">Zone</th>
                              <th className="sticky top-0 px-3 py-2 text-right font-medium bg-muted text-muted-foreground">Zone Size (m²)</th>
                              <th className="sticky top-0 px-3 py-2 text-right font-medium bg-muted text-muted-foreground">Est. Kg Output</th>
                              <th className="sticky top-0 px-3 py-2 text-right font-medium bg-muted text-muted-foreground">Total Kg</th>
                              <th className="sticky top-0 px-3 py-2 text-right font-medium bg-muted text-muted-foreground">Balance</th>
                              <th className="sticky top-0 px-3 py-2 text-right font-medium bg-muted text-muted-foreground">New Balance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {updateZones.map((row) => {
                              const existing = overridesByZone[row.forecastZoneKey];
                              const isOverridden = !!existing;
                              return (
                                <tr key={row.key} className="border-t border-border/60 align-top">
                                  <td className="px-3 py-3 font-medium text-foreground">{row.turfgrass}</td>
                                  <td className="px-3 py-3 text-foreground">{zoneLabel(row.zone)}</td>
                                  <td className="px-3 py-3 text-right">{row.sizeM2.toLocaleString()}</td>
                                  <td className="px-3 py-3 text-right">{row.maxKg.toLocaleString()}</td>
                                  <td className="px-3 py-3 text-right">{row.maxKg.toLocaleString()}</td>
                                  <td className="px-3 py-3 text-right font-medium text-foreground">
                                    {row.currentKg.toLocaleString()}
                                  </td>
                                  <td className="px-3 py-3">
                                    <div className="space-y-1">
                                      <input
                                        type="text"
                                        inputMode="numeric"
                                        value={balanceUpdates[row.key] ?? ""}
                                        onChange={(e) =>
                                          setBalanceUpdates((prev) => ({
                                            ...prev,
                                            [row.key]: formatBalanceInput(e.target.value),
                                          }))
                                        }
                                        placeholder={isOverridden ? formatBalanceInput(existing.availableKg) : "Enter kg"}
                                        className="w-full rounded-lg border border-border bg-white px-3 py-2 text-right text-sm text-foreground"
                                      />
                                      {isOverridden ? (
                                        <>
                                          <p className="text-[11px] text-amber-700">
                                            Saved balance: {existing.availableKg.toLocaleString()} kg from{" "}
                                            {formatShortDate(existing.date)}
                                          </p>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              void (async () => {
                                                try {
                                                  await removeOverride(existing);
                                                  setBalanceUpdates((prev) => {
                                                    const next = { ...prev };
                                                    delete next[row.key];
                                                    return next;
                                                  });
                                                  setNotice(
                                                    `Removed manual balance override for ${row.farmName} ${row.turfgrass} ${zoneLabel(row.zone)}.`,
                                                  );
                                                } catch (error) {
                                                  setNotice(
                                                    error instanceof Error
                                                      ? error.message
                                                      : "Failed to remove balance override.",
                                                  );
                                                }
                                              })();
                                            }}
                                            className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition hover:text-foreground"
                                          >
                                            <RotateCcw className="h-3.5 w-3.5" />
                                            Reset
                                          </button>
                                        </>
                                      ) : null}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                        No zones found for this farm.
                      </p>
                    )
                  ) : (
                    <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                      Select a farm to edit balance by zone.
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-4">
                  <button
                    type="button"
                    onClick={() => {
                      setUpdateOpen(false);
                      setBalanceUpdates({});
                    }}
                    className="rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted/40"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveUpdates}
                    className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
                  >
                    Save Updates
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {availableFarms
              .filter((f) => !filterFarm || f === filterFarm)
              .map((farm) => {
                const zones = inventory.filter((z) => z.farmName === farm);
                if (zones.length === 0) return null;
                const totalMax = zones.reduce((s, z) => s + z.maxKg, 0);
                const totalCurrent = zones.reduce((s, z) => s + z.currentKg, 0);
                const pct = totalMax ? Math.round((totalCurrent / totalMax) * 100) : 0;
                return (
                  <button
                    key={farm}
                    type="button"
                    onClick={() => setDrillFarm(farm)}
                    className="rounded-xl border border-border bg-white p-4 text-left transition-all hover:shadow-md hover:-translate-y-0.5"
                  >
                    <p className="text-xs font-medium text-muted-foreground">{farm}</p>
                    <p className="text-xl font-bold mt-1">{pct}%</p>
                    <div className="w-full h-2 bg-muted rounded-full mt-2">
                      <div
                        className="h-2 rounded-full transition-all"
                        style={{
                          width: `${pct}%`,
                          backgroundColor:
                            pct > 70 ? "hsl(152,55%,36%)" : pct > 40 ? "hsl(35,92%,52%)" : "hsl(0,72%,51%)",
                        }}
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1.5">
                      {(totalCurrent / 1000).toFixed(0)}k / {(totalMax / 1000).toFixed(0)}k kg
                    </p>
                  </button>
                );
              })}
          </div>

          <div className="rounded-xl border border-border bg-white p-4">
            <div className="flex items-baseline justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold">Inventory by Grass Type</h3>
                <p className="text-xs text-muted-foreground">
                  Farm contribution per grass - balance (kg)
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Company total:{" "}
                <span className="font-semibold text-foreground">
                  {(companyTotalKg / 1000).toFixed(1)}k kg
                </span>
              </p>
            </div>
            {stackedByGrass.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No inventory recorded yet.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {stackedByGrass.map((row) => {
                  const grass = row.grass as string;
                  const total = row.total as number;
                  const slices = availableFarms
                    .map((farm) => ({ name: farm, value: row[farm] as number }))
                    .filter((s) => s.value > 0);
                  return (
                    <div key={grass} className="rounded-lg border border-border/50 bg-background/40 p-3">
                      <div className="flex items-baseline justify-between mb-1">
                        <p className="text-sm font-semibold text-foreground truncate">{grass}</p>
                        <p className="text-[11px] text-muted-foreground whitespace-nowrap">
                          {(total / 1000).toFixed(1)}k kg
                        </p>
                      </div>
                      <div className="h-[180px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={slices}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              innerRadius={32}
                              outerRadius={62}
                              paddingAngle={2}
                            >
                              {slices.map((s) => (
                                <Cell key={s.name} fill={FARM_COLORS[s.name] ?? "hsl(var(--primary))"} />
                              ))}
                            </Pie>
                            <Tooltip
                              formatter={(value: number, name: string) => [
                                `${value.toLocaleString()} kg (${total ? Math.round((value / total) * 100) : 0}%)`,
                                name,
                              ]}
                            />
                            <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {drillFarm ? (
            <div className="rounded-xl border border-border bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{drillFarm} - Stock by Grass Type</h3>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setDrillFarm(null)}
                >
                  Close
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="text-left py-2 px-3">Grass Type</th>
                      <th className="text-right py-2 px-3">Balance (kg)</th>
                      <th className="text-right py-2 px-3">Max (kg)</th>
                      <th className="text-left py-2 px-3">Level</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from(
                      inventory
                        .filter((z) => z.farmName === drillFarm)
                        .reduce((m, z) => {
                          const cur = m.get(z.turfgrass) ?? { currentKg: 0, maxKg: 0 };
                          cur.currentKg += z.currentKg;
                          cur.maxKg += z.maxKg;
                          m.set(z.turfgrass, cur);
                          return m;
                        }, new Map<string, { currentKg: number; maxKg: number }>()),
                    )
                      .map(([grass, v]) => ({
                        grass,
                        currentKg: v.currentKg,
                        maxKg: v.maxKg,
                        pct: v.maxKg ? Math.round((v.currentKg / v.maxKg) * 100) : 0,
                      }))
                      .sort((a, b) => a.grass.localeCompare(b.grass))
                      .map((r) => (
                        <tr key={r.grass} className="border-t border-border/50">
                          <td className="py-2 px-3 font-medium">{r.grass}</td>
                          <td className="py-2 px-3 text-right">{r.currentKg.toLocaleString()}</td>
                          <td className="py-2 px-3 text-right">{r.maxKg.toLocaleString()}</td>
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-muted rounded-full">
                                <div
                                  className="h-2 rounded-full"
                                  style={{
                                    width: `${r.pct}%`,
                                    backgroundColor:
                                      r.pct > 70
                                        ? "hsl(152,55%,36%)"
                                        : r.pct > 40
                                          ? "hsl(35,92%,52%)"
                                          : "hsl(0,72%,51%)",
                                  }}
                                />
                              </div>
                              <span className="text-xs text-muted-foreground w-8 text-right">{r.pct}%</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="rounded-xl border border-border bg-white overflow-hidden">
            <div className="space-y-3 p-3 md:hidden">
              {inventory.map((z) => (
                <div key={z.key} className="rounded-lg border border-border/70 bg-background p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{z.farmName}</p>
                      <p className="mt-0.5 text-sm text-foreground">{z.turfgrass}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">Zone: {zoneLabel(z.zone)}</p>
                    </div>
                    {z.isManualOverrideActive ? (
                      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                        Manual
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                    <div>
                      <p className="text-[11px] text-muted-foreground">Size (m2)</p>
                      <p className="font-medium text-foreground">{z.sizeM2.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">Max (kg)</p>
                      <p className="font-medium text-foreground">{z.maxKg.toLocaleString()}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-[11px] text-muted-foreground">Balance (kg)</p>
                      <p className="font-medium text-foreground">{z.currentKg.toLocaleString()}</p>
                      {z.isManualOverrideActive ? (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          System {z.calculatedKg.toLocaleString()} kg · Updated {formatShortDate(z.manualOverrideDate)}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-muted-foreground">Level</span>
                      <span className="w-8 text-right text-xs text-muted-foreground">{z.pct}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted">
                      <div
                        className="h-2 rounded-full"
                        style={{
                          width: `${z.pct}%`,
                          backgroundColor:
                            z.pct > 70 ? "hsl(152,55%,36%)" : z.pct > 40 ? "hsl(35,92%,52%)" : "hsl(0,72%,51%)",
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Farm</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Grass</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Zone</th>
                    <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">Size (m2)</th>
                    <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">Max (kg)</th>
                    <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">Balance (kg)</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground w-32">Level</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.map((z) => (
                    <tr key={z.key} className="border-t border-border/50 hover:bg-muted/20">
                      <td className="py-3 px-4 font-medium">{z.farmName}</td>
                      <td className="py-3 px-4">{z.turfgrass}</td>
                      <td className="py-3 px-4">{zoneLabel(z.zone)}</td>
                      <td className="py-3 px-4 text-right">{z.sizeM2.toLocaleString()}</td>
                      <td className="py-3 px-4 text-right">{z.maxKg.toLocaleString()}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <span className="font-medium">{z.currentKg.toLocaleString()}</span>
                          {z.isManualOverrideActive ? (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                              Manual
                            </span>
                          ) : null}
                        </div>
                        {z.isManualOverrideActive ? (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            System {z.calculatedKg.toLocaleString()} kg · Updated {formatShortDate(z.manualOverrideDate)}
                          </p>
                        ) : null}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-muted rounded-full">
                            <div
                              className="h-2 rounded-full"
                              style={{
                                width: `${z.pct}%`,
                                backgroundColor:
                                  z.pct > 70 ? "hsl(152,55%,36%)" : z.pct > 40 ? "hsl(35,92%,52%)" : "hsl(0,72%,51%)",
                              }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground w-8 text-right">{z.pct}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </DashboardLayout>
    </RequireAuth>
  );
}
