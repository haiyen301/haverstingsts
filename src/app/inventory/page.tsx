"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardEdit, RotateCcw, X } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { toast } from "react-toastify";
import { useTranslations } from "next-intl";

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
  type RegrowthReferenceConfig,
} from "@/features/forecasting/forecastingRegrowth";
import {
  applyInventoryAvailableOverridesToZoneMap,
  type AppliedInventoryAvailableOverride,
} from "@/features/forecasting/inventoryAvailableOverrides";
import { applyLatestZoneMaxKgToForecastRows } from "@/features/forecasting/forecastingInventoryConversion";
import { computeAllocatedAvailableByZoneAtDate } from "@/features/forecasting/forecastAvailableAtDate";
import {
  computeZoneCapacityMap,
  findActiveZoneConfiguration,
  forecastZoneKeyFromParts,
  forecastZoneKeyFromRow,
  mergeZoneCapacityMapsAtDate,
  zoneConfigurationMaxKg,
} from "@/features/forecasting/inventoryRegrowthCalculator";
import {
  fetchHarvestRowsForForecasting,
  rowsToMockHarvestRows,
} from "@/features/forecasting/mapHarvestApiToForecastRows";
import type { ForecastHarvestRow } from "@/features/forecasting/forecastingTypes";
import { zoneIdToLabelResolved, pickGrassCatalogRows } from "@/shared/lib/harvestReferenceData";
import { DatePicker } from "@/shared/ui/date-picker";
import type { InventoryAvailableOverrideEntry } from "@/shared/store/inventoryAvailableOverrideStore";
import {
  inventoryBalanceOverrideStorageKey,
  useInventoryAvailableOverrideStore,
} from "@/shared/store/inventoryAvailableOverrideStore";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { useSyncedFarmMultiSelect } from "@/shared/hooks/useSyncedFarmMultiSelect";
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

type OverlimitEntry = {
  key: string;
  farmId: number;
  grassId: number;
  farmName: string;
  turfgrass: string;
  overlimitKg: number;
};

type InventoryBuildResult = {
  rows: InventoryRow[];
  overlimitEntries: OverlimitEntry[];
};

const FARM_COLORS: Record<string, string> = {
  "Hoi An": "hsl(85, 80%, 41%)",
  "Phan Thiet": "hsl(152, 55%, 36%)",
  "Ban Bueng": "hsl(35, 92%, 52%)",
  "Laem Chabang": "hsl(28, 35%, 56%)",
  "Semenyih": "hsl(210, 70%, 50%)",
};

const OVERLIMIT_SLICE_COLOR = "hsl(0, 72%, 48%)";

type GrassPieSlice = {
  name: string;
  value: number;
  kind: "available" | "overlimit";
};

function toNum(v: string | number | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function parseUpdateDateYmd(ymd: string): Date {
  const trimmed = ymd.trim().slice(0, 10);
  const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return startOfLocalDay(new Date());
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
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
): InventoryRow | null {
  const sizeM2 = toNum(row.size_m2);
  const inventoryKgPerM2 = toNum(row.inventory_kg_per_m2);
  const maxKg = zoneConfigurationMaxKg(row);
  const key = forecastZoneKeyFromParts(row.farm_id, String(row.zone ?? ""), row.grass_id);
  const calculatedAvailable = calculatedByZone.get(key) ?? 0;
  const adjustedAvailable = adjustedByZone.get(key) ?? calculatedAvailable;
  const calculatedKg = Math.round(Math.min(maxKg, Math.max(0, calculatedAvailable)));
  const currentKg = Math.round(Math.min(maxKg, Math.max(0, adjustedAvailable)));
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

/** One inventory row per zone identity using the setup active on `asOfYmd` (period wins over default). */
function buildInventoryRowsFromZoneConfigs(
  zoneConfigurations: ZoneConfigurationRow[],
  calculatedByZone: Map<string, number>,
  adjustedByZone: Map<string, number>,
  appliedByZone: Map<string, AppliedInventoryAvailableOverride>,
  asOfYmd: string,
): InventoryRow[] {
  const seenKeys = new Set<string>();
  const rows: InventoryRow[] = [];

  for (const row of zoneConfigurations) {
    const key = forecastZoneKeyFromParts(row.farm_id, String(row.zone ?? ""), row.grass_id);
    if (seenKeys.has(key)) continue;

    const active = findActiveZoneConfiguration(zoneConfigurations, {
      farmId: Number(row.farm_id),
      zone: String(row.zone ?? ""),
      productId: Number(row.grass_id),
      ymd: asOfYmd,
    });
    if (!active) continue;

    seenKeys.add(key);
    const inventoryRow = mapZoneToInventoryRow(
      active,
      calculatedByZone,
      adjustedByZone,
      appliedByZone,
    );
    if (inventoryRow) rows.push(inventoryRow);
  }

  return rows;
}

function buildOverlimitEntries(
  overlimitByFarmProduct: Map<string, number>,
  forecastRows: ForecastHarvestRow[],
  zoneConfigurations: ZoneConfigurationRow[],
): OverlimitEntry[] {
  const entries: OverlimitEntry[] = [];
  for (const [fpKey, kg] of overlimitByFarmProduct) {
    if (kg <= 0) continue;
    const [farmIdStr, productIdStr] = fpKey.split("|");
    const farmId = Number(farmIdStr);
    const productId = Number(productIdStr);
    if (!Number.isFinite(farmId) || !Number.isFinite(productId)) continue;

    let farmName = "";
    let turfgrass = "";
    for (const r of forecastRows) {
      if (r.farmId !== farmId || r.productId !== productId) continue;
      if (!farmName && r.farm) farmName = String(r.farm).trim();
      if (!turfgrass && r.grassType) turfgrass = String(r.grassType).trim();
      if (farmName && turfgrass) break;
    }
    if (!farmName || !turfgrass) {
      for (const z of zoneConfigurations) {
        if (Number(z.farm_id) !== farmId || Number(z.grass_id) !== productId) continue;
        if (!farmName && z.farm_name) farmName = String(z.farm_name).trim();
        if (!turfgrass && z.turfgrass) turfgrass = String(z.turfgrass).trim();
        break;
      }
    }

    entries.push({
      key: `overlimit:${fpKey}`,
      farmId,
      grassId: productId,
      farmName,
      turfgrass,
      overlimitKg: Math.round(kg),
    });
  }
  return entries.sort(
    (a, b) =>
      a.farmName.localeCompare(b.farmName) || a.turfgrass.localeCompare(b.turfgrass),
  );
}

function buildInventoryRowsAtDate(params: {
  asOf: Date;
  forecastRows: ForecastHarvestRow[];
  zoneConfigurations: ZoneConfigurationRow[];
  regrowthConfig: RegrowthReferenceConfig;
  overridesByZone: Record<string, InventoryAvailableOverrideEntry>;
}): InventoryBuildResult {
  const { asOf, forecastRows, zoneConfigurations, regrowthConfig, overridesByZone } = params;
  const asOfYmd = ymdFromDate(asOf);
  const forecastRowsWithLiveCaps = applyLatestZoneMaxKgToForecastRows(
    forecastRows,
    zoneConfigurations,
    asOfYmd,
  );
  const allocated = computeAllocatedAvailableByZoneAtDate(
    forecastRowsWithLiveCaps,
    regrowthConfig,
    asOf,
    zoneConfigurations,
  );
  const calculatedByZone = allocated.availableByZone;
  const maxByZone = mergeZoneCapacityMapsAtDate(
    forecastRowsWithLiveCaps,
    zoneConfigurations,
    asOf,
  );
  const { adjustedByZone, appliedByZone } = applyInventoryAvailableOverridesToZoneMap({
    availableByZone: calculatedByZone,
    maxByZone,
    overridesByZone,
    asOf,
    overrideRecoveryDays: regrowthConfig.overrideRecoveryDays,
  });

  const rows =
    zoneConfigurations.length > 0
      ? buildInventoryRowsFromZoneConfigs(
          zoneConfigurations,
          calculatedByZone,
          adjustedByZone,
          appliedByZone,
          asOfYmd,
        )
      : buildInventoryRowsFromHarvestOnly(
          forecastRowsWithLiveCaps,
          calculatedByZone,
          adjustedByZone,
          appliedByZone,
        );

  return {
    rows,
    overlimitEntries: buildOverlimitEntries(
      allocated.overlimitByFarmProduct,
      forecastRowsWithLiveCaps,
      zoneConfigurations,
    ),
  };
}

export default function InventoryPage() {
  const t = useTranslations("InventoryBalance");
  const tForecast = useTranslations("ForecastInventory");
  const [zoneConfigurations, setZoneConfigurations] = useState<ZoneConfigurationRow[]>([]);
  const [forecastRows, setForecastRows] = useState<ForecastHarvestRow[]>([]);
  const [regrowthConfig, setRegrowthConfig] = useState(
    DEFAULT_REGROWTH_REFERENCE_CONFIG,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterGrass, setFilterGrass] = useState("");
  const [drillFarm, setDrillFarm] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [selectedFarm, setSelectedFarm] = useState("");
  const [updateDate, setUpdateDate] = useState(() => ymdFromDate(startOfLocalDay(new Date())));
  const [balanceUpdates, setBalanceUpdates] = useState<Record<string, string>>({});

  const overridesByZone = useInventoryAvailableOverrideStore((s) => s.overridesByZone);
  const overridesLoading = useInventoryAvailableOverrideStore((s) => s.loading);
  const fetchOverrides = useInventoryAvailableOverrideStore((s) => s.fetchOverrides);
  const upsertOverrides = useInventoryAvailableOverrideStore((s) => s.upsertOverrides);
  const removeOverride = useInventoryAvailableOverrideStore((s) => s.removeOverride);
  const farmsRaw = useHarvestingDataStore((s) => s.farms);
  const farmZones = useHarvestingDataStore((s) => s.farmZones);
  const grasses = useHarvestingDataStore((s) => s.grasses);
  const fetchAllHarvestingReferenceData = useHarvestingDataStore(
    (s) => s.fetchAllHarvestingReferenceData,
  );
  const {
    farmOptions,
    selectedFarmIds,
    selectedFarmIdSet,
    setSelectedFarmIds,
    farmNameById,
  } = useSyncedFarmMultiSelect();

  useEffect(() => {
    void fetchAllHarvestingReferenceData();
  }, [fetchAllHarvestingReferenceData]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      void fetchZoneConfigurations().then(setZoneConfigurations).catch(() => {});
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const zoneLabel = (zoneId: string) =>
    zoneIdToLabelResolved(zoneId, farmZones, tForecast("events.noZoneName"));

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
            farms: farmsRaw,
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
        setError(e instanceof Error ? e.message : t("loadErrorGeneric"));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [farmsRaw]);

  useEffect(() => {
    void fetchOverrides();
  }, [fetchOverrides]);

  useEffect(() => {
    if (!updateOpen) return;
    void fetchOverrides();
  }, [updateOpen, fetchOverrides]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const { rows, overlimitEntries } = useMemo(() => {
    const today = startOfLocalDay(new Date());
    return buildInventoryRowsAtDate({
      asOf: today,
      forecastRows,
      zoneConfigurations,
      regrowthConfig,
      overridesByZone,
    });
  }, [forecastRows, overridesByZone, regrowthConfig, zoneConfigurations]);

  const { rows: updateRows } = useMemo(() => {
    const asOf = startOfLocalDay(parseUpdateDateYmd(updateDate));
    return buildInventoryRowsAtDate({
      asOf,
      forecastRows,
      zoneConfigurations,
      regrowthConfig,
      overridesByZone,
    });
  }, [forecastRows, overridesByZone, regrowthConfig, updateDate, zoneConfigurations]);

  const resolveFarmLabel = (row: InventoryRow): string => {
    const fromRow = String(row.farmName ?? "").trim();
    if (fromRow) return fromRow;
    if (row.farmId > 0) return farmNameById.get(String(row.farmId)) ?? "";
    return "";
  };

  const rowsWithFarmLabels = useMemo(
    () =>
      rows.map((row) => {
        const farmName = resolveFarmLabel(row);
        return farmName && farmName !== row.farmName ? { ...row, farmName } : row;
      }),
    [rows, farmNameById],
  );

  const availableFarms = useMemo(() => {
    const byId = new Map<string, string>();
    for (const row of rowsWithFarmLabels) {
      if (row.farmId <= 0) continue;
      const id = String(row.farmId);
      if (!byId.has(id)) {
        byId.set(id, resolveFarmLabel(row) || farmNameById.get(id) || id);
      }
    }
    for (const opt of farmOptions) {
      if (!byId.has(opt.id)) byId.set(opt.id, opt.label);
    }
    return Array.from(byId.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rowsWithFarmLabels, farmOptions, farmNameById]);
  /** Grass dropdown: sales window (today); current filter value pinned if outside window. */
  const availableGrasses = useMemo(() => {
    const picked = pickGrassCatalogRows({
      catalog: grasses as unknown[],
      mode: "sales_window",
      refYmds: [],
      pinnedGrassIds: filterGrass.trim() ? [filterGrass.trim()] : [],
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
  }, [grasses, filterGrass]);

  const inventory = useMemo(
    () =>
      rowsWithFarmLabels.filter(
        (r) =>
          (selectedFarmIds.length === 0 || selectedFarmIdSet.has(String(r.farmId))) &&
          (!filterGrass || String(r.grassId) === filterGrass),
      ),
    [rowsWithFarmLabels, selectedFarmIds, selectedFarmIdSet, filterGrass],
  );

  const inventoryOverlimit = useMemo(() => {
    const withFarmNames = overlimitEntries.map((entry) => {
      const farmName =
        String(entry.farmName ?? "").trim() ||
        (entry.farmId > 0 ? farmNameById.get(String(entry.farmId)) ?? "" : "");
      return farmName && farmName !== entry.farmName ? { ...entry, farmName } : entry;
    });
    return withFarmNames.filter(
      (r) =>
        (selectedFarmIds.length === 0 || selectedFarmIdSet.has(String(r.farmId))) &&
        (!filterGrass || String(r.grassId) === filterGrass),
    );
  }, [overlimitEntries, selectedFarmIds, selectedFarmIdSet, filterGrass, farmNameById]);

  const updateZones = useMemo(
    () =>
      selectedFarm
        ? updateRows
            .filter((r) => String(r.farmId) === selectedFarm)
            .sort((a, b) =>
              a.turfgrass === b.turfgrass
                ? zoneLabel(a.zone).localeCompare(zoneLabel(b.zone))
                : a.turfgrass.localeCompare(b.turfgrass),
            )
        : [],
    [updateRows, selectedFarm, farmZones],
  );

  const farmZoneKeySet = useMemo(() => {
    if (!selectedFarm) return new Set<string>();
    return new Set(
      rowsWithFarmLabels
        .filter((r) => String(r.farmId) === selectedFarm)
        .map((r) => r.forecastZoneKey),
    );
  }, [rowsWithFarmLabels, selectedFarm]);

  /** Balance dates that have at least one saved row for the selected farm (for calendar markers). */
  const markedBalanceDatesYmd = useMemo(() => {
    if (!selectedFarm || farmZoneKeySet.size === 0) return [];
    const days = new Set<string>();
    for (const entry of Object.values(overridesByZone)) {
      if (!entry.date || !farmZoneKeySet.has(entry.zoneKey)) continue;
      const ymd = entry.date.trim().slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) days.add(ymd);
    }
    return Array.from(days).sort();
  }, [overridesByZone, farmZoneKeySet, selectedFarm]);

  const activeOverrideCount = useMemo(
    () => rowsWithFarmLabels.filter((r) => r.isManualOverrideActive).length,
    [rowsWithFarmLabels],
  );

  useEffect(() => {
    if (!updateOpen) return;
    setSelectedFarm((prev) =>
      prev && availableFarms.some((f) => f.id === prev) ? prev : (availableFarms[0]?.id ?? ""),
    );
  }, [availableFarms, updateOpen]);

  useEffect(() => {
    if (!updateOpen) return;
    const next: Record<string, string> = {};
    for (const row of updateZones) {
      const sk = inventoryBalanceOverrideStorageKey(row.forecastZoneKey, updateDate);
      const existing = overridesByZone[sk];
      if (existing) next[row.key] = formatBalanceInput(existing.availableKg);
    }
    setBalanceUpdates(next);
  }, [overridesByZone, updateOpen, updateZones, updateDate]);

  async function handleSaveUpdates() {
    const updates: InventoryAvailableOverrideEntry[] = [];
    for (const row of updateZones) {
      const raw = String(balanceUpdates[row.key] ?? "").trim();
      if (!raw) continue;
      const availableKg = parseBalanceInput(raw);
      if (!Number.isFinite(availableKg) || availableKg < 0) continue;
      const cappedKg = row.maxKg > 0 ? Math.min(availableKg, row.maxKg) : availableKg;
      updates.push({
        id:
          overridesByZone[inventoryBalanceOverrideStorageKey(row.forecastZoneKey, updateDate)]?.id ?? 0,
        zoneKey: row.forecastZoneKey,
        zoneConfigurationId: row.zoneConfigurationId,
        farmId: row.farmId,
        grassId: row.grassId,
        farmName: row.farmName,
        turfgrass: row.turfgrass,
        zone: row.zone,
        availableKg: cappedKg,
        calculatedKg: row.calculatedKg,
        date: updateDate,
        updatedAt: new Date().toISOString(),
      });
    }

    if (updates.length === 0) {
      setNotice(t("noticeMinOneBalance"));
      return;
    }

    try {
      await upsertOverrides(updates);
      await fetchOverrides();
      setNotice(t("savedOverrides", {
        count: updates.length,
        farm: farmNameById.get(selectedFarm) ?? selectedFarm,
      }));
      setBalanceUpdates({});
      setUpdateOpen(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t("saveBalanceFailed"));
    }
  }

  const stackedByGrass = useMemo(() => {
    const allGrasses = Array.from(
      new Set([
        ...rowsWithFarmLabels.map((r) => r.turfgrass),
        ...inventoryOverlimit.map((o) => o.turfgrass),
      ]),
    ).sort((a, b) => a.localeCompare(b));
    return allGrasses
      .map((grass) => {
        const row: Record<string, string | number> = { grass };
        let total = 0;
        for (const farm of availableFarms) {
          const v = rowsWithFarmLabels
            .filter((z) => z.turfgrass === grass && String(z.farmId) === farm.id)
            .reduce((s, z) => s + z.currentKg, 0);
          row[farm.name] = v;
          total += v;
        }
        const overlimitTotal = inventoryOverlimit
          .filter((o) => o.turfgrass === grass)
          .reduce((s, o) => s + o.overlimitKg, 0);
        row.overlimitTotal = overlimitTotal;
        row.total = total;
        return row;
      })
      .filter((r) => (r.total as number) > 0 || (r.overlimitTotal as number) > 0);
  }, [rowsWithFarmLabels, availableFarms, inventoryOverlimit]);

  const companyTotalKg = useMemo(
    () => stackedByGrass.reduce((s, r) => s + (r.total as number), 0),
    [stackedByGrass],
  );

  const companyOverlimitKg = useMemo(
    () => inventoryOverlimit.reduce((s, o) => s + o.overlimitKg, 0),
    [inventoryOverlimit],
  );

  const resolveOverlimitFarmLabel = (entry: OverlimitEntry): string => {
    const fromEntry = String(entry.farmName ?? "").trim();
    if (fromEntry) return fromEntry;
    if (entry.farmId > 0) return farmNameById.get(String(entry.farmId)) ?? "";
    return "";
  };

  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="space-y-6 p-4 lg:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl lg:text-3xl font-semibold text-gray-900">{t("title")}</h1>
              <p className="mt-1 text-sm text-gray-600">
                {t("subtitle")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setUpdateOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium text-foreground shadow-sm transition hover:bg-muted/40"
            >
              <ClipboardEdit className="h-4 w-4" />
              {t("updateInventory")}
            </button>
          </div>

          <div className="flex gap-3 flex-wrap">
            <select
              value={selectedFarmIds[0] ?? ""}
              onChange={(e) =>
                setSelectedFarmIds(e.target.value ? [e.target.value] : [])
              }
              className="px-3 py-1.5 rounded-lg text-xs bg-muted border border-border text-foreground"
            >
              <option value="">{t("allFarms")}</option>
              {availableFarms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <select
              value={filterGrass}
              onChange={(e) => setFilterGrass(e.target.value)}
              className="px-3 py-1.5 rounded-lg text-xs bg-muted border border-border text-foreground"
            >
              <option value="">{t("allGrassTypes")}</option>
              {availableGrasses.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>

          {notice ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {notice}
            </div>
          ) : null}

          {loading ? <p className="text-sm text-gray-500">{t("loading")}</p> : null}
          
          {updateOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-xl border border-border bg-white shadow-2xl">
                <div className="flex items-center justify-between border-b border-border px-5 py-4">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">{t("dialogTitle")}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t("dialogSubtitle")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setUpdateOpen(false);
                      setBalanceUpdates({});
                    }}
                    className="rounded-md p-2 text-muted-foreground transition hover:bg-muted/40 hover:text-foreground"
                    aria-label={t("closeDialogAria")}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="space-y-4 overflow-y-auto p-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-2 text-sm">
                      <span className="font-medium text-foreground">{t("farm")}</span>
                      <select
                        value={selectedFarm}
                        onChange={(e) => setSelectedFarm(e.target.value)}
                        className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground"
                      >
                        <option value="">{t("selectFarm")}</option>
                        {availableFarms.map((farm) => (
                          <option key={farm.id} value={farm.id}>
                            {farm.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-2 text-sm">
                      <span className="font-medium text-foreground">{t("updateDate")}</span>
                      <DatePicker
                        value={updateDate}
                        onChange={setUpdateDate}
                        markedDatesYmd={markedBalanceDatesYmd}
                      />
                      {selectedFarm ? (
                        <p className="text-[11px] text-muted-foreground">
                          {t("calendarMarkedDatesHint")}
                        </p>
                      ) : null}
                    </label>
                  </div>

                  {selectedFarm && overridesLoading ? (
                    <p className="rounded-md border border-amber-100 bg-amber-50/80 px-3 py-2 text-xs text-amber-900">
                      {t("loadingSavedBalances")}
                    </p>
                  ) : null}

                  {selectedFarm ? (
                    updateZones.length > 0 ? (
                      <div className="max-h-[52vh] overflow-x-auto overflow-y-auto rounded-lg border border-border">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="">
                              <th className="sticky top-0 px-3 py-2 text-left font-medium bg-muted text-muted-foreground">{t("thGrassType")}</th>
                              <th className="sticky top-0 px-3 py-2 text-left font-medium bg-muted text-muted-foreground">{t("thZone")}</th>
                              <th className="sticky top-0 px-3 py-2 text-right font-medium bg-muted text-muted-foreground">{t("thZoneSize")}</th>
                              <th className="sticky top-0 px-3 py-2 text-right font-medium bg-muted text-muted-foreground">{t("thEstKgOutput")}</th>
                              <th className="sticky top-0 px-3 py-2 text-right font-medium bg-muted text-muted-foreground">{t("thTotalKg")}</th>
                              <th className="sticky top-0 px-3 py-2 text-right font-medium bg-muted text-muted-foreground">{t("thBalance")}</th>
                              <th className="sticky top-0 px-3 py-2 text-right font-medium bg-muted text-muted-foreground">{t("thNewBalance")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {updateZones.map((row) => {
                              const existing =
                                overridesByZone[
                                  inventoryBalanceOverrideStorageKey(row.forecastZoneKey, updateDate)
                                ];
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
                                        placeholder={isOverridden ? formatBalanceInput(existing.availableKg) : t("enterKgPlaceholder")}
                                        className="w-full rounded-lg border border-border bg-white px-3 py-2 text-right text-sm text-foreground"
                                      />
                                      {isOverridden ? (
                                        <>
                                          <p className="text-[11px] text-amber-700">
                                            {t("savedBalanceLine", {
                                              kg: existing.availableKg.toLocaleString(),
                                              date: formatShortDate(existing.date),
                                            })}
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
                                                    t("removedOverride", {
                                                      farm: row.farmName,
                                                      grass: row.turfgrass,
                                                      zone: zoneLabel(row.zone),
                                                    }),
                                                  );
                                                } catch (error) {
                                                  setNotice(
                                                    error instanceof Error
                                                      ? error.message
                                                      : t("removeOverrideFailed"),
                                                  );
                                                }
                                              })();
                                            }}
                                            className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition hover:text-foreground"
                                          >
                                            <RotateCcw className="h-3.5 w-3.5" />
                                            {t("reset")}
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
                        {t("noZonesForFarm")}
                      </p>
                    )
                  ) : (
                    <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                      {t("selectFarmToEdit")}
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
                    {t("cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveUpdates}
                    className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
                  >
                    {t("saveUpdates")}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {availableFarms
              .filter(
                (f) =>
                  selectedFarmIds.length === 0 || selectedFarmIdSet.has(f.id),
              )
              .map((farm) => {
                const zones = inventory.filter((z) => String(z.farmId) === farm.id);
                if (zones.length === 0) return null;
                const totalMax = zones.reduce((s, z) => s + z.maxKg, 0);
                const totalCurrent = zones.reduce((s, z) => s + z.currentKg, 0);
                const farmOverlimit = inventoryOverlimit
                  .filter((o) => String(o.farmId) === farm.id)
                  .reduce((s, o) => s + o.overlimitKg, 0);
                const pct = totalMax ? Math.round((totalCurrent / totalMax) * 100) : 0;
                return (
                  <button
                    key={farm.id}
                    type="button"
                    onClick={() => setDrillFarm(farm.name)}
                    className="rounded-xl border border-border bg-white p-4 text-left transition-all hover:shadow-md hover:-translate-y-0.5"
                  >
                    <p className="text-xs font-medium text-muted-foreground">{farm.name}</p>
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
                      {totalCurrent.toLocaleString()} / {totalMax.toLocaleString()} kg
                    </p>
                    {farmOverlimit > 0 ? (
                      <p className="text-[11px] font-medium text-red-700 mt-1">
                        +{farmOverlimit.toLocaleString()} kg {t("overlimitLabel")}
                      </p>
                    ) : null}
                  </button>
                );
              })}
          </div>

          <div className="rounded-xl border border-border bg-white p-4">
            <div className="flex items-baseline justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold">{t("byGrassTitle")}</h3>
                <p className="text-xs text-muted-foreground">
                  {t("byGrassSubtitle")}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold text-foreground">
                  {t("companyTotal", { kg: companyTotalKg.toLocaleString() })}
                </p>
                {companyOverlimitKg > 0 ? (
                  <p className="mt-1 text-xs font-semibold text-red-700">
                    {t("overlimitTotal", { kg: companyOverlimitKg.toLocaleString() })}
                  </p>
                ) : null}
              </div>
            </div>
            {stackedByGrass.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {t("emptyInventory")}
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {stackedByGrass.map((row) => {
                  const grass = row.grass as string;
                  const totalAvailable = row.total as number;
                  const totalOverlimit = (row.overlimitTotal as number) ?? 0;
                  const chartTotal = totalAvailable + totalOverlimit;

                  const farmSlices: GrassPieSlice[] = availableFarms
                    .map((farm) => ({
                      name: farm.name,
                      value: row[farm.name] as number,
                      kind: "available" as const,
                    }))
                    .filter((s) => s.value > 0);

                  const overlimitSlices: GrassPieSlice[] = inventoryOverlimit
                    .filter((o) => o.turfgrass === grass)
                    .map((o) => ({
                      name: t("pieOverlimitSlice", { farm: resolveOverlimitFarmLabel(o) }),
                      value: o.overlimitKg,
                      kind: "overlimit" as const,
                    }))
                    .filter((s) => s.value > 0);

                  const slices = [...farmSlices, ...overlimitSlices];

                  return (
                    <div key={grass} className="rounded-lg border border-border/50 bg-background/40 p-3">
                      <div className="flex items-baseline justify-between mb-1 gap-2">
                        <p className="text-sm font-semibold text-foreground truncate">{grass}</p>
                        <div className="text-right whitespace-nowrap">
                          <p className="text-[11px] text-muted-foreground">
                            {totalAvailable.toLocaleString()} kg
                          </p>
                          {totalOverlimit > 0 ? (
                            <p className="text-[11px] font-medium text-red-700">
                              +{totalOverlimit.toLocaleString()} {t("overlimitLabel")}
                            </p>
                          ) : null}
                        </div>
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
                                <Cell
                                  key={s.name}
                                  fill={
                                    s.kind === "overlimit"
                                      ? OVERLIMIT_SLICE_COLOR
                                      : FARM_COLORS[s.name] ?? "hsl(var(--primary))"
                                  }
                                />
                              ))}
                            </Pie>
                            <Tooltip
                              content={({ active, payload }) => {
                                if (!active || !payload?.length) return null;
                                const item = payload[0]?.payload as GrassPieSlice | undefined;
                                if (!item) return null;
                                const pct = chartTotal
                                  ? Math.round((item.value / chartTotal) * 100)
                                  : 0;
                                return (
                                  <div className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs shadow-md">
                                    <p className="font-medium text-foreground">{item.name}</p>
                                    <p
                                      className={
                                        item.kind === "overlimit"
                                          ? "text-red-700"
                                          : "text-muted-foreground"
                                      }
                                    >
                                      {item.kind === "overlimit"
                                        ? t("pieTooltipOverlimit", {
                                            kg: item.value.toLocaleString(),
                                            pct,
                                          })
                                        : t("pieTooltip", {
                                            kg: item.value.toLocaleString(),
                                            pct,
                                          })}
                                    </p>
                                  </div>
                                );
                              }}
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
                <h3 className="text-sm font-semibold">{t("drillTitle", { farm: drillFarm ?? "" })}</h3>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setDrillFarm(null)}
                >
                  {t("close")}
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="text-left py-2 px-3">{t("drillThGrass")}</th>
                      <th className="text-right py-2 px-3">{t("drillThBalance")}</th>
                      <th className="text-right py-2 px-3">{t("drillThMax")}</th>
                      <th className="text-left py-2 px-3">{t("drillThLevel")}</th>
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
                      .map(([grass, v]) => {
                        const drillFarmId = inventory.find((z) => z.farmName === drillFarm)?.farmId;
                        const overlimitKg = inventoryOverlimit
                          .filter(
                            (o) =>
                              o.turfgrass === grass &&
                              (drillFarmId != null
                                ? o.farmId === drillFarmId
                                : resolveOverlimitFarmLabel(o) === drillFarm),
                          )
                          .reduce((s, o) => s + o.overlimitKg, 0);
                        return {
                          grass,
                          currentKg: v.currentKg,
                          maxKg: v.maxKg,
                          overlimitKg,
                          pct: v.maxKg ? Math.round((v.currentKg / v.maxKg) * 100) : 0,
                        };
                      })
                      .sort((a, b) => a.grass.localeCompare(b.grass))
                      .map((r) => (
                        <tr key={r.grass} className="border-t border-border/50">
                          <td className="py-2 px-3 font-medium">{r.grass}</td>
                          <td className="py-2 px-3 text-right">
                            <div>{r.currentKg.toLocaleString()}</div>
                            {r.overlimitKg > 0 ? (
                              <div className="text-[11px] font-medium text-red-700">
                                +{r.overlimitKg.toLocaleString()} {t("overlimitLabel")}
                              </div>
                            ) : null}
                          </td>
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
                      <p className="mt-0.5 text-xs text-muted-foreground">{t("zonePrefix")} {zoneLabel(z.zone)}</p>
                    </div>
                    {z.isManualOverrideActive ? (
                      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                        {t("manualBadge")}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                    <div>
                      <p className="text-[11px] text-muted-foreground">{t("sizeM2")}</p>
                      <p className="font-medium text-foreground">{z.sizeM2.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">{t("maxKg")}</p>
                      <p className="font-medium text-foreground">{z.maxKg.toLocaleString()}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-[11px] text-muted-foreground">{t("balanceKg")}</p>
                      <p className="font-medium text-foreground">{z.currentKg.toLocaleString()}</p>
                      {z.isManualOverrideActive ? (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {t("systemUpdated", {
                            calc: z.calculatedKg.toLocaleString(),
                            date: formatShortDate(z.manualOverrideDate),
                          })}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-muted-foreground">{t("level")}</span>
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
              {inventoryOverlimit.map((o) => (
                <div
                  key={o.key}
                  className="rounded-lg border border-red-200 bg-red-50/60 p-3 shadow-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {resolveOverlimitFarmLabel(o)}
                    </p>
                    <p className="mt-0.5 text-sm text-foreground">{o.turfgrass}</p>
                    <p className="mt-0.5 text-xs font-medium text-red-700">{t("overlimitZoneLabel")}</p>
                  </div>
                  <div className="mt-3">
                    <p className="text-[11px] text-muted-foreground">{t("overlimitKg")}</p>
                    <p className="text-sm font-semibold text-red-700">
                      +{o.overlimitKg.toLocaleString()} kg
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">{t("thFarm")}</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">{t("thGrass")}</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">{t("thZone")}</th>
                    <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">{t("thSizeM2Short")}</th>
                    <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">{t("thMaxKg")}</th>
                    <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">{t("thBalanceKg")}</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground w-32">{t("thLevel")}</th>
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
                              {t("manualBadge")}
                            </span>
                          ) : null}
                        </div>
                        {z.isManualOverrideActive ? (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {t("systemUpdated", {
                            calc: z.calculatedKg.toLocaleString(),
                            date: formatShortDate(z.manualOverrideDate),
                          })}
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
                  {inventoryOverlimit.map((o) => (
                    <tr key={o.key} className="border-t border-red-100 bg-red-50/40 hover:bg-red-50/70">
                      <td className="py-3 px-4 font-medium">{resolveOverlimitFarmLabel(o)}</td>
                      <td className="py-3 px-4">{o.turfgrass}</td>
                      <td className="py-3 px-4 font-medium text-red-700">{t("overlimitZoneLabel")}</td>
                      <td className="py-3 px-4 text-right text-muted-foreground">—</td>
                      <td className="py-3 px-4 text-right text-muted-foreground">—</td>
                      <td className="py-3 px-4 text-right font-semibold text-red-700">
                        +{o.overlimitKg.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-muted-foreground">—</td>
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
