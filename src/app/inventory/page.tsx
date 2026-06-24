"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlignLeft, ArrowDown, ClipboardEdit, HelpCircle, RotateCcw, X } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { toast } from "react-toastify";
import { useTranslations } from "next-intl";

import RequireAuth from "@/features/auth/RequireAuth";
import { filterActiveZoneConfigurations } from "@/features/forecasting/forecastActiveRecords";
import {
  buildInventoryRowsFromDbSnapshots,
  buildZoneDailySnapshotsFromDb,
  filterSnapshotRowsForZoneKey,
  lookupZoneSnapshotInDayMap,
  resolveDbZoneKeyFromSnapshotRows,
} from "@/features/forecasting/inventoryDbSnapshots";
import { InventoryZoneBalanceBreakdownPanel } from "@/features/forecasting/InventoryZoneBalanceBreakdownPanel";
import type { EnrichedZoneBalanceTimelineEntry } from "@/features/forecasting/InventoryZoneBalanceBreakdownPanel";
import { buildZoneBalanceTimelineFromDbSnapshotRows, reverseZoneBalanceTimelineForDisplay } from "@/features/forecasting/zoneBalanceBreakdown";
import { enrichZoneBalanceTimelineForBreakdown } from "@/features/forecasting/zoneBalanceEventsFromDayDetail";
import { resolveDbBreakdownHistoryStartYmd } from "@/features/forecasting/resolveDbBreakdownHistoryStart";
import { getForecastToday } from "@/features/forecasting/forecastDateUtils";
import {
  inventoryBalanceRebuildFromDate,
  onInventoryBalanceForecastMutation,
} from "@/features/forecasting/forecastDataSync";
import type { ZoneInventoryDaySnapshot } from "@/features/forecasting/forecastDbTypes";
import { useInventoryZoneDbSnapshots } from "@/features/forecasting/useInventoryZoneDbSnapshots";
import { fetchForecastMeta, type DbSnapshotRow, type ForecastMetaResponse } from "@/features/forecasting/forecastSnapshotApi";
import { useForecastDataStore } from "@/shared/store/forecastDataStore";
import { setForecastZoneCatalog } from "@/features/forecasting/zoneKeyNormalization";
import type { ZoneConfigurationRow } from "@/features/admin/api/adminApi";
import { DEFAULT_FALLBACK_INVENTORY_KG_PER_M2 } from "@/features/forecasting/forecastingInventoryConversion";
import {
  canonicalForecastZoneKey,
  forecastZoneKeysEqual,
} from "@/features/forecasting/inventoryRegrowthCalculator";
import {
  collectHiddenGrassIdsForCatalogOnDate,
  filterActiveGrassRows,
  zoneIdToLabelResolved,
} from "@/shared/lib/harvestReferenceData";
import { useGrassFilterByFarm } from "@/shared/hooks/useGrassFilterByFarm";
import { DatePicker } from "@/shared/ui/date-picker";
import type { InventoryAvailableOverrideEntry } from "@/shared/store/inventoryAvailableOverrideStore";
import {
  inventoryBalanceOverrideStorageKey,
  useInventoryAvailableOverrideStore,
} from "@/shared/store/inventoryAvailableOverrideStore";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { useHarvestingReferenceHydrated } from "@/shared/hooks/useHarvestingReferenceHydrated";
import {
  parseCsvList,
  toCsvList,
  useSyncedFarmMultiSelect,
} from "@/shared/hooks/useSyncedFarmMultiSelect";
import { bgSurfaceFilter } from "@/shared/lib/surfaceFilter";
import { MultiSelect } from "@/shared/ui/multi-select";
import { cn } from "@/lib/utils";
import { dispatchRouteAlert } from "@/features/alerts/dispatchRouteAlert";
import { ForecastPageHeaderActions } from "@/features/forecasting/ForecastPageHeaderActions";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";

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
  /** System-calculated kg when the manual balance was saved (subtitle on manual day). */
  systemKgAtManualOverride: number | null;
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

/** Site brand green (#298E60). */
const BRAND_CHART_GREEN = "#298E60";

/** Brand green first, then soft tints + other muted farm hues (stable A→Z order). */
const FARM_CHART_PALETTE = [
  BRAND_CHART_GREEN,
  "color-mix(in srgb, #298E60 70%, white)",
  "color-mix(in srgb, #298E60 50%, white)",
  "hsl(210, 38%, 62%)",
  "hsl(28, 42%, 65%)",
  "hsl(275, 34%, 64%)",
  "hsl(340, 38%, 64%)",
  "hsl(195, 34%, 60%)",
  "hsl(250, 32%, 66%)",
  "hsl(12, 40%, 63%)",
];

const OVERLIMIT_SLICE_COLOR = "hsl(4, 48%, 62%)";

function farmChartColor(
  farmColorByName: Record<string, string>,
  farmName: string,
  singleFarmSlice: boolean,
): string {
  if (singleFarmSlice) return BRAND_CHART_GREEN;
  return farmColorByName[farmName] ?? BRAND_CHART_GREEN;
}

type GrassPieSlice = {
  name: string;
  value: number;
  kind: "available" | "overlimit";
};

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

function inventoryBalanceKgToM2(kg: number, kgPerM2: number): number {
  if (kg <= 0) return 0;
  const rate = kgPerM2 > 0 ? kgPerM2 : DEFAULT_FALLBACK_INVENTORY_KG_PER_M2;
  return Math.max(0, Math.round(kg / rate));
}

/** Scale grass/farm slice totals to match DB aggregate (parity forecasting chart). */
function reconcileGrassStackedTotals(
  rows: Array<Record<string, string | number>>,
  farmNames: string[],
  targetTotal: number,
): void {
  if (rows.length === 0) return;
  const roundedTarget = Math.max(0, Math.round(targetTotal));
  let sum = 0;
  for (const row of rows) {
    sum += Number(row.total ?? 0);
  }
  if (sum <= 0) {
    if (rows[0]) rows[0].total = roundedTarget;
    return;
  }
  if (sum === roundedTarget) return;

  let newSum = 0;
  let largestIdx = 0;
  let largestVal = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const oldTotal = Number(row.total ?? 0);
    const scaledTotal = Math.max(0, Math.round((oldTotal * roundedTarget) / sum));
    row.total = scaledTotal;
    newSum += scaledTotal;
    if (scaledTotal > largestVal) {
      largestVal = scaledTotal;
      largestIdx = i;
    }
    for (const farmName of farmNames) {
      const oldFarm = Number(row[farmName] ?? 0);
      row[farmName] = Math.max(0, Math.round((oldFarm * scaledTotal) / (oldTotal || 1)));
    }
  }
  const drift = roundedTarget - newSum;
  if (drift !== 0 && rows[largestIdx]) {
    rows[largestIdx]!.total = Math.max(0, Number(rows[largestIdx]!.total ?? 0) + drift);
  }
}

function buildOverlimitEntries(
  overlimitByFarmProduct: Map<string, number>,
  zoneConfigurations: ZoneConfigurationRow[],
  inventoryRows: InventoryRow[],
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
    for (const r of inventoryRows) {
      if (r.farmId !== farmId || r.grassId !== productId) continue;
      if (!farmName && r.farmName) farmName = String(r.farmName).trim();
      if (!turfgrass && r.turfgrass) turfgrass = String(r.turfgrass).trim();
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

/** Build inventory table rows from zone-level DB snapshots only. */
function buildInventoryRowsAtDate(params: {
  asOf: Date;
  zoneConfigurations: ZoneConfigurationRow[];
  overridesByZone: Record<string, InventoryAvailableOverrideEntry>;
  dbSnapshotRows: DbSnapshotRow[];
}): InventoryBuildResult {
  const { asOf, zoneConfigurations, overridesByZone, dbSnapshotRows } = params;
  const asOfYmd = ymdFromDate(asOf);

  const dbResult = buildInventoryRowsFromDbSnapshots({
    snapshotRows: dbSnapshotRows,
    asOfYmd,
    zoneConfigurations,
    forecastRows: [],
    overridesByZone,
  });

  if (!dbResult) {
    return { rows: [], overlimitEntries: [] };
  }

  return {
    rows: dbResult.rows,
    overlimitEntries: buildOverlimitEntries(
      dbResult.overlimitByFarmProduct,
      zoneConfigurations,
      dbResult.rows,
    ),
  };
}

export default function InventoryPage() {
  const t = useTranslations("InventoryBalance");
  const tForecast = useTranslations("ForecastInventory");
  const referenceHydrated = useHarvestingReferenceHydrated();
  const zoneConfigurationsRaw = useHarvestingDataStore((s) => s.zoneConfigurations);
  const zoneConfigurations = useMemo(
    () => filterActiveZoneConfigurations(zoneConfigurationsRaw),
    [zoneConfigurationsRaw],
  );
  const overridesByZone = useInventoryAvailableOverrideStore((s) => s.overridesByZone);
  const overridesLoading = useInventoryAvailableOverrideStore((s) => s.loading);
  const referenceError = useHarvestingDataStore((s) => s.error);
  const referenceBootstrapDone = useHarvestingDataStore((s) => s.bootstrapDone);
  const [drillFarm, setDrillFarm] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [selectedFarm, setSelectedFarm] = useState("");
  const [updateDate, setUpdateDate] = useState(() => ymdFromDate(startOfLocalDay(new Date())));
  const [balanceUpdates, setBalanceUpdates] = useState<Record<string, string>>({});

  const upsertOverrides = useInventoryAvailableOverrideStore((s) => s.upsertOverrides);
  const removeOverride = useInventoryAvailableOverrideStore((s) => s.removeOverride);
  const farmZones = useHarvestingDataStore((s) => s.farmZones);
  const grasses = useHarvestingDataStore((s) => s.grasses);
  const harvestListGrassFilter = useHarvestingDataStore((s) => s.harvestListGrassFilter);
  const setHarvestListGrassFilter = useHarvestingDataStore((s) => s.setHarvestListGrassFilter);
  const {
    farmOptions,
    selectedFarmIds,
    selectedFarmIdSet,
    setSelectedFarmIds,
    farmNameById,
  } = useSyncedFarmMultiSelect();

  const selectedGrassIds = useMemo(
    () => parseCsvList(harvestListGrassFilter),
    [harvestListGrassFilter],
  );
  const selectedGrassIdSet = useMemo(
    () => new Set(selectedGrassIds),
    [selectedGrassIds],
  );
  const setSelectedGrassIds = (ids: string[]) => setHarvestListGrassFilter(toCsvList(ids));

  const inventoryTodayYmd = useMemo(() => ymdFromDate(getForecastToday()), []);
  const dbSeriesRefreshKey = useForecastDataStore((s) => s.dbSeriesRefreshKey);

  const inventoryDbDateFrom = useMemo(() => {
    const updateYmd = updateDate.trim().slice(0, 10);
    return updateYmd < inventoryTodayYmd ? updateYmd : inventoryTodayYmd;
  }, [inventoryTodayYmd, updateDate]);

  const inventoryDbDateTo = useMemo(() => {
    const updateYmd = updateDate.trim().slice(0, 10);
    return updateYmd > inventoryTodayYmd ? updateYmd : inventoryTodayYmd;
  }, [inventoryTodayYmd, updateDate]);

  const inventoryDb = useInventoryZoneDbSnapshots({
    dateFrom: inventoryTodayYmd,
    dateTo: inventoryTodayYmd,
    enabled: referenceHydrated,
    refreshKey: dbSeriesRefreshKey,
  });

  const updateInventoryDb = useInventoryZoneDbSnapshots({
    dateFrom: inventoryDbDateFrom,
    dateTo: inventoryDbDateTo,
    enabled: referenceHydrated && updateOpen,
    refreshKey: dbSeriesRefreshKey,
  });

  const activeGrasses = useMemo(() => filterActiveGrassRows(grasses), [grasses]);

  const hiddenGrassIdSet = useMemo(
    () => collectHiddenGrassIdsForCatalogOnDate(grasses as unknown[], inventoryTodayYmd),
    [grasses, inventoryTodayYmd],
  );

  useEffect(() => {
    if (hiddenGrassIdSet.size === 0) return;
    const current = parseCsvList(harvestListGrassFilter);
    const pruned = current.filter((id) => !hiddenGrassIdSet.has(id));
    if (pruned.length !== current.length) {
      setHarvestListGrassFilter(toCsvList(pruned));
    }
  }, [hiddenGrassIdSet, harvestListGrassFilter, setHarvestListGrassFilter]);

  const farmFilterOptions = useMemo(
    () => farmOptions.map((o) => ({ value: o.id, label: o.label })),
    [farmOptions],
  );

  const filterTriggerIcon = (
    <>
      <AlignLeft className="h-3.5 w-3.5 shrink-0" />
      <ArrowDown className="h-3.5 w-3.5 shrink-0" />
    </>
  );
  const multiSelectBaseClass =
    "min-w-[140px] max-w-[180px] rounded-md border border-input text-sm hover:bg-btnhover/40";

  const zoneLabel = (zoneId: string) =>
    zoneIdToLabelResolved(zoneId, farmZones, tForecast("events.noZoneName"));

  useEffect(() => {
    setForecastZoneCatalog(farmZones);
  }, [farmZones]);

  useEffect(() => {
    if (!referenceHydrated) return;
    void useInventoryAvailableOverrideStore.getState().fetchOverrides();
    const store = useHarvestingDataStore.getState();
    if (!store.bootstrapDone || store.zoneConfigurations.length === 0) {
      void store.fetchAllHarvestingReferenceData();
    }
  }, [referenceHydrated]);

  useEffect(() => {
    if (!referenceError) return;
    toast.error(referenceError, { toastId: `inventory-reference-error:${referenceError}` });
  }, [referenceError]);

  useEffect(() => {
    if (!inventoryDb.error) return;
    toast.error(inventoryDb.error, { toastId: `inventory-db-error:${inventoryDb.error}` });
  }, [inventoryDb.error]);

  useEffect(() => {
    if (!updateOpen) return;
    void useInventoryAvailableOverrideStore.getState().fetchOverrides();
  }, [updateOpen]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const dbReady = inventoryDb.hasData && !inventoryDb.isLoading;
  const zoneRowsReady = inventoryDb.snapshotRows.length > 0 && !inventoryDb.isLoading;
  const aggregateAvailableToday = inventoryDb.aggregateAvailableByDate.get(inventoryTodayYmd) ?? null;
  const inventoryFiltersAll =
    selectedFarmIds.length === 0 && selectedGrassIds.length === 0;
  const pageLoading =
    !referenceHydrated ||
    (!referenceBootstrapDone && zoneConfigurations.length === 0) ||
    (inventoryDb.isLoading && !inventoryDb.hasData);

  const { rows, overlimitEntries } = useMemo(() => {
    if (!zoneRowsReady) return { rows: [], overlimitEntries: [] };
    const today = getForecastToday();
    return buildInventoryRowsAtDate({
      asOf: today,
      zoneConfigurations,
      overridesByZone,
      dbSnapshotRows: inventoryDb.snapshotRows,
    });
  }, [zoneRowsReady, overridesByZone, zoneConfigurations, inventoryDb.snapshotRows]);

  const { rows: updateRows } = useMemo(() => {
    const source = updateOpen ? updateInventoryDb : inventoryDb;
    if (!source.hasData || source.isLoading) return { rows: [] };
    const asOf = startOfLocalDay(parseUpdateDateYmd(updateDate));
    return buildInventoryRowsAtDate({
      asOf,
      zoneConfigurations,
      overridesByZone,
      dbSnapshotRows: source.snapshotRows,
    });
  }, [
    updateOpen,
    updateInventoryDb.snapshotRows,
    updateInventoryDb.hasData,
    updateInventoryDb.isLoading,
    inventoryDb.snapshotRows,
    inventoryDb.hasData,
    inventoryDb.isLoading,
    overridesByZone,
    updateDate,
    zoneConfigurations,
  ]);

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

  const visibleRowsWithFarmLabels = useMemo(
    () => rowsWithFarmLabels.filter((r) => !hiddenGrassIdSet.has(String(r.grassId))),
    [rowsWithFarmLabels, hiddenGrassIdSet],
  );

  const availableFarms = useMemo(() => {
    const byId = new Map<string, string>();
    for (const row of visibleRowsWithFarmLabels) {
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
  }, [visibleRowsWithFarmLabels, farmOptions, farmNameById]);

  const farmColorByName = useMemo(() => {
    const names = Array.from(new Set(availableFarms.map((f) => f.name).filter(Boolean))).sort(
      (a, b) => a.localeCompare(b),
    );
    const map: Record<string, string> = {};
    names.forEach((name, i) => {
      map[name] = FARM_CHART_PALETTE[i % FARM_CHART_PALETTE.length];
    });
    return map;
  }, [availableFarms]);
  const { grassFilterOptions: rawGrassFilterOptions } = useGrassFilterByFarm({
    grasses: activeGrasses as unknown[],
    zoneConfigs: zoneConfigurations,
    selectedFarmIds,
    selectedGrassIds,
    onSelectedGrassIdsChange: setSelectedGrassIds,
    catalogMode: "sales_window",
    refYmds: [inventoryTodayYmd],
  });

  const grassFilterOptions = useMemo(
    () => rawGrassFilterOptions.filter((o) => !hiddenGrassIdSet.has(o.value)),
    [rawGrassFilterOptions, hiddenGrassIdSet],
  );

  const grassIdToTurfgrass = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of visibleRowsWithFarmLabels) {
      const id = String(r.grassId ?? "").trim();
      const turf = String(r.turfgrass ?? "").trim();
      if (id && turf) map.set(id, turf);
    }
    for (const row of zoneConfigurations) {
      const id = String(row.grass_id ?? "").trim();
      const turf = String(row.turfgrass ?? "").trim();
      if (id && turf) map.set(id, turf);
    }
    for (const opt of grassFilterOptions) {
      if (!map.has(opt.value)) map.set(opt.value, opt.label);
    }
    return map;
  }, [visibleRowsWithFarmLabels, zoneConfigurations, grassFilterOptions]);

  /** Farms included in grass-type charts (respects farm filter). */
  const chartFarms = useMemo(
    () =>
      selectedFarmIds.length === 0
        ? availableFarms
        : availableFarms.filter((f) => selectedFarmIdSet.has(f.id)),
    [availableFarms, selectedFarmIds, selectedFarmIdSet],
  );

  const inventory = useMemo(
    () =>
      visibleRowsWithFarmLabels.filter(
        (r) =>
          (selectedFarmIds.length === 0 || selectedFarmIdSet.has(String(r.farmId))) &&
          (selectedGrassIds.length === 0 || selectedGrassIdSet.has(String(r.grassId))),
      ),
    [
      visibleRowsWithFarmLabels,
      selectedFarmIds,
      selectedFarmIdSet,
      selectedGrassIds,
      selectedGrassIdSet,
    ],
  );

  const [balanceBreakdownZoneKey, setBalanceBreakdownZoneKey] = useState<string | null>(null);
  const [forecastMeta, setForecastMeta] = useState<ForecastMetaResponse | null>(null);

  useEffect(() => {
    if (!referenceHydrated) return;
    let cancelled = false;
    void fetchForecastMeta(inventoryTodayYmd).then((meta) => {
      if (!cancelled) setForecastMeta(meta);
    });
    return () => {
      cancelled = true;
    };
  }, [referenceHydrated, inventoryTodayYmd]);

  const breakdownHistoryStartYmd = useMemo(
    () => resolveDbBreakdownHistoryStartYmd(forecastMeta),
    [forecastMeta],
  );

  const breakdownTargetRow = useMemo(() => {
    if (!balanceBreakdownZoneKey) return undefined;
    return rows.find((r) => forecastZoneKeysEqual(r.forecastZoneKey, balanceBreakdownZoneKey));
  }, [rows, balanceBreakdownZoneKey]);

  const breakdownDbZoneKey = useMemo(() => {
    if (!balanceBreakdownZoneKey) return null;
    return (
      resolveDbZoneKeyFromSnapshotRows(inventoryDb.snapshotRows, balanceBreakdownZoneKey) ??
      balanceBreakdownZoneKey
    );
  }, [balanceBreakdownZoneKey, inventoryDb.snapshotRows]);

  const breakdownDb = useInventoryZoneDbSnapshots({
    dateFrom: breakdownHistoryStartYmd,
    dateTo: inventoryTodayYmd,
    allPeriods: true,
    zoneKey: breakdownDbZoneKey ?? balanceBreakdownZoneKey,
    farmId: breakdownTargetRow?.farmId,
    grassId: breakdownTargetRow?.grassId,
    enabled: referenceHydrated && !!balanceBreakdownZoneKey && !!breakdownTargetRow,
    refreshKey: dbSeriesRefreshKey,
  });
  const [balanceBreakdownUnit, setBalanceBreakdownUnit] = useState<"kg" | "m2">("kg");
  const [balanceBreakdownData, setBalanceBreakdownData] = useState<{
    row: InventoryRow;
    todaySnapshot: ZoneInventoryDaySnapshot | undefined;
    timelineEntries: EnrichedZoneBalanceTimelineEntry[];
  } | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const balanceBreakdownRef = useRef<HTMLDivElement | null>(null);

  const scrollToBalanceBreakdown = () => {
    window.setTimeout(() => {
      balanceBreakdownRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  };

  const zoneSnapshotsToday = useMemo(() => {
    if (!zoneRowsReady) return new Map<string, ZoneInventoryDaySnapshot>();
    const byDate = buildZoneDailySnapshotsFromDb(
      inventoryDb.snapshotRows,
      overridesByZone,
      inventoryTodayYmd,
      inventoryTodayYmd,
    );
    return byDate.get(inventoryTodayYmd) ?? new Map();
  }, [zoneRowsReady, inventoryDb.snapshotRows, overridesByZone, inventoryTodayYmd]);

  useEffect(() => {
    if (!balanceBreakdownZoneKey) {
      setBalanceBreakdownData(null);
      setBreakdownLoading(false);
      return;
    }

    setBreakdownLoading(true);
    setBalanceBreakdownData(null);

    let cancelled = false;
    let finishTimer: number | undefined;
    const startedAt = performance.now();
    const zoneKey = balanceBreakdownZoneKey;

    let paintTimer: number | undefined;
    const runCompute = async () => {
      if (cancelled) return;
      if (breakdownDb.isLoading) return;

      const row =
        breakdownTargetRow ??
        inventory.find((r) => forecastZoneKeysEqual(r.forecastZoneKey, zoneKey));
      if (!row) {
        setBreakdownLoading(false);
        return;
      }

      const historyStartYmd = breakdownHistoryStartYmd;
      const rawHistoryRows =
        breakdownDb.snapshotRows.length > 0
          ? breakdownDb.snapshotRows
          : inventoryDb.snapshotRows;
      const historyRows = filterSnapshotRowsForZoneKey(
        rawHistoryRows,
        breakdownDbZoneKey ?? zoneKey,
      );

      const timeline = buildZoneBalanceTimelineFromDbSnapshotRows(
        historyRows,
        zoneKey,
        row.maxKg,
        historyStartYmd,
        overridesByZone,
      );
      const hasToday = timeline.some((entry) => entry.dateYmd === inventoryTodayYmd);
      const todaySnapshot = lookupZoneSnapshotInDayMap(zoneSnapshotsToday, zoneKey);
      const baseTimeline = [...timeline];
      if (!hasToday && todaySnapshot) {
        baseTimeline.push({
          dateYmd: inventoryTodayYmd,
          previousKg: todaySnapshot.previousKg,
          regrowthKg: todaySnapshot.regrowthKg,
          harvestKg: todaySnapshot.harvestKg,
          endKg: todaySnapshot.exactManualSetToday
            ? (todaySnapshot.manualOverrideKg ?? todaySnapshot.calculatedKg)
            : todaySnapshot.calculatedKg,
          manualKg: todaySnapshot.exactManualSetToday ? todaySnapshot.manualOverrideKg : null,
          isOpeningDay: false,
          isManualSetToday: todaySnapshot.exactManualSetToday,
          rollingBeforeManualKg: todaySnapshot.rollingBeforeManualSetKg,
        });
      } else if (!hasToday && !todaySnapshot && row.currentKg > 0) {
        baseTimeline.push({
          dateYmd: inventoryTodayYmd,
          previousKg: row.currentKg,
          regrowthKg: 0,
          harvestKg: 0,
          endKg: row.currentKg,
          manualKg: row.isManualOverrideActive ? row.manualOverrideKg : null,
          isOpeningDay: false,
          isManualSetToday: row.isManualOverrideActive,
          rollingBeforeManualKg: row.isManualOverrideActive
            ? row.systemKgAtManualOverride ?? row.calculatedKg
            : null,
        });
      }

      if (baseTimeline.length === 0 && !todaySnapshot) {
        setBreakdownLoading(false);
        return;
      }

      const enrichedTimeline = await enrichZoneBalanceTimelineForBreakdown(
        baseTimeline,
        zoneKey,
        inventoryTodayYmd,
        {
          farmName: row.farmName,
          turfgrass: row.turfgrass,
          zone: row.zone,
        },
      );

      const elapsed = performance.now() - startedAt;
      const remainMs = Math.max(0, 600 - elapsed);
      finishTimer = window.setTimeout(() => {
        if (cancelled) return;
        setBalanceBreakdownData({
          row,
          todaySnapshot,
          timelineEntries: reverseZoneBalanceTimelineForDisplay(
            enrichedTimeline,
          ) as EnrichedZoneBalanceTimelineEntry[],
        });
        setBreakdownLoading(false);
      }, remainMs);
    };

    // Let the browser paint the spinner and start CSS animation before heavy work.
    paintTimer = window.setTimeout(() => {
      void runCompute();
    }, 80);

    return () => {
      cancelled = true;
      if (paintTimer != null) window.clearTimeout(paintTimer);
      if (finishTimer != null) window.clearTimeout(finishTimer);
    };
  }, [
    balanceBreakdownZoneKey,
    breakdownTargetRow,
    inventory,
    zoneConfigurations,
    overridesByZone,
    inventoryTodayYmd,
    zoneSnapshotsToday,
    breakdownHistoryStartYmd,
    breakdownDb.isLoading,
    breakdownDb.snapshotRows,
    inventoryDb.snapshotRows,
    breakdownDbZoneKey,
  ]);

  useEffect(() => {
    if (!balanceBreakdownZoneKey || !balanceBreakdownData) return;
    scrollToBalanceBreakdown();
  }, [balanceBreakdownZoneKey, balanceBreakdownData]);

  const inventoryTableTotals = useMemo(() => {
    let sizeM2 = 0;
    let maxKg = 0;
    let balanceKg = 0;
    let balanceM2 = 0;
    for (const row of inventory) {
      sizeM2 += row.sizeM2;
      maxKg += row.maxKg;
      balanceKg += row.currentKg;
      balanceM2 += inventoryBalanceKgToM2(row.currentKg, row.inventoryKgPerM2);
    }
    if (inventoryFiltersAll && aggregateAvailableToday != null) {
      balanceKg = aggregateAvailableToday;
    }
    const pct = maxKg > 0 ? Math.round((balanceKg / maxKg) * 100) : 0;
    return { sizeM2, maxKg, balanceKg, balanceM2, pct };
  }, [inventory, inventoryFiltersAll, aggregateAvailableToday]);

  const inventoryOverlimit = useMemo(() => {
    const withFarmNames = overlimitEntries.map((entry) => {
      const farmName =
        String(entry.farmName ?? "").trim() ||
        (entry.farmId > 0 ? farmNameById.get(String(entry.farmId)) ?? "" : "");
      return farmName && farmName !== entry.farmName ? { ...entry, farmName } : entry;
    });
    return withFarmNames.filter(
      (r) =>
        !hiddenGrassIdSet.has(String(r.grassId)) &&
        (selectedFarmIds.length === 0 || selectedFarmIdSet.has(String(r.farmId))) &&
        (selectedGrassIds.length === 0 || selectedGrassIdSet.has(String(r.grassId))),
    );
  }, [
    overlimitEntries,
    hiddenGrassIdSet,
    selectedFarmIds,
    selectedFarmIdSet,
    selectedGrassIds,
    selectedGrassIdSet,
    farmNameById,
  ]);

  /** Grass ids shown in "Inventory by Grass Type" (farm → all zone grasses; else data + filter). */
  const chartGrassIds = useMemo(() => {
    if (selectedGrassIds.length > 0) return selectedGrassIds;
    if (selectedFarmIds.length > 0) {
      return grassFilterOptions.map((o) => o.value);
    }
    const ids = new Set<string>();
    for (const r of inventory) {
      const id = String(r.grassId ?? "").trim();
      if (id) ids.add(id);
    }
    for (const o of inventoryOverlimit) {
      const id = String(o.grassId ?? "").trim();
      if (id) ids.add(id);
    }
    return Array.from(ids).sort((a, b) => {
      const la = grassIdToTurfgrass.get(a) ?? a;
      const lb = grassIdToTurfgrass.get(b) ?? b;
      return la.localeCompare(lb);
    });
  }, [
    selectedGrassIds,
    selectedFarmIds,
    grassFilterOptions,
    inventory,
    inventoryOverlimit,
    grassIdToTurfgrass,
  ]);

  const updateZones = useMemo(
    () =>
      selectedFarm
        ? updateRows
            .filter(
              (r) =>
                !hiddenGrassIdSet.has(String(r.grassId)) && String(r.farmId) === selectedFarm,
            )
            .sort((a, b) =>
              a.turfgrass === b.turfgrass
                ? zoneLabel(a.zone).localeCompare(zoneLabel(b.zone))
                : a.turfgrass.localeCompare(b.turfgrass),
            )
        : [],
    [updateRows, selectedFarm, farmZones, hiddenGrassIdSet],
  );

  const farmZoneKeySet = useMemo(() => {
    if (!selectedFarm) return new Set<string>();
    return new Set(
      visibleRowsWithFarmLabels
        .filter((r) => String(r.farmId) === selectedFarm)
        .map((r) => r.forecastZoneKey),
    );
  }, [visibleRowsWithFarmLabels, selectedFarm]);

  /** Balance dates that have at least one saved row for the selected farm (for calendar markers). */
  const markedBalanceDatesYmd = useMemo(() => {
    if (!selectedFarm || farmZoneKeySet.size === 0) return [];
    const days = new Set<string>();
    for (const entry of Object.values(overridesByZone)) {
      if (!entry.date) continue;
      const entryKey = canonicalForecastZoneKey(entry.zoneKey);
      if (![...farmZoneKeySet].some((k) => forecastZoneKeysEqual(k, entryKey))) continue;
      const ymd = entry.date.trim().slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) days.add(ymd);
    }
    return Array.from(days).sort();
  }, [overridesByZone, farmZoneKeySet, selectedFarm]);

  const isUpdateDateInFuture = useMemo(() => {
    const todayYmd = ymdFromDate(getForecastToday());
    return updateDate.trim().slice(0, 10) > todayYmd;
  }, [updateDate]);

  const activeOverrideCount = useMemo(
    () => visibleRowsWithFarmLabels.filter((r) => r.isManualOverrideActive).length,
    [visibleRowsWithFarmLabels],
  );

  const toggleBalanceBreakdown = (zoneKey: string, unit: "kg" | "m2") => {
    if (balanceBreakdownZoneKey === zoneKey) {
      setBalanceBreakdownUnit(unit);
      scrollToBalanceBreakdown();
      return;
    }
    setBalanceBreakdownUnit(unit);
    setBalanceBreakdownZoneKey(zoneKey);
    setBreakdownLoading(true);
    setBalanceBreakdownData(null);
    scrollToBalanceBreakdown();
  };

  const renderBalanceBreakdownButton = (
    row: InventoryRow,
    displayValue: number,
    unit: "kg" | "m2",
  ) => {
    const isActive =
      balanceBreakdownZoneKey === row.forecastZoneKey && balanceBreakdownUnit === unit;
    return (
      <button
        type="button"
        aria-label={t("balanceBreakdownAria")}
        aria-expanded={isActive}
        onClick={() => toggleBalanceBreakdown(row.forecastZoneKey, unit)}
        className={cn(
          "font-medium tabular-nums underline decoration-dotted underline-offset-2 transition",
          isActive
            ? "text-primary decoration-primary"
            : "text-foreground decoration-muted-foreground/70 hover:text-primary hover:decoration-primary",
        )}
      >
        {displayValue.toLocaleString()}
      </button>
    );
  };

  const renderOverlimitKg = (entry: OverlimitEntry) => (
    <span className="font-semibold tabular-nums text-red-700">
      +{entry.overlimitKg.toLocaleString()} kg
    </span>
  );

  useEffect(() => {
    if (!updateOpen) return;
    setSelectedFarm((prev) =>
      prev && availableFarms.some((f) => f.id === prev) ? prev : (availableFarms[0]?.id ?? ""),
    );
  }, [availableFarms, updateOpen]);

  const balanceFormSeedKey = useMemo(() => {
    if (!updateOpen) return "";
    const parts: string[] = [updateDate.trim().slice(0, 10), selectedFarm];
    for (const row of updateZones) {
      const sk = inventoryBalanceOverrideStorageKey(row.forecastZoneKey, updateDate);
      const existing = overridesByZone[sk];
      parts.push(`${row.key}:${existing?.id ?? 0}:${existing?.availableKg ?? ""}`);
    }
    return parts.join("\0");
  }, [updateOpen, updateDate, selectedFarm, updateZones, overridesByZone]);

  useEffect(() => {
    if (!updateOpen) return;
    const next: Record<string, string> = {};
    for (const row of updateZones) {
      const sk = inventoryBalanceOverrideStorageKey(row.forecastZoneKey, updateDate);
      const existing = overridesByZone[sk];
      if (existing) next[row.key] = formatBalanceInput(existing.availableKg);
    }
    setBalanceUpdates((prev) => {
      const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
      for (const key of keys) {
        if ((prev[key] ?? "") !== (next[key] ?? "")) return next;
      }
      return prev;
    });
  }, [balanceFormSeedKey, updateOpen]);

  async function handleSaveUpdates() {
    const updates: InventoryAvailableOverrideEntry[] = [];
    for (const row of updateZones) {
      const raw = String(balanceUpdates[row.key] ?? "").trim();
      if (!raw) continue;
      const availableKg = parseBalanceInput(raw);
      if (!Number.isFinite(availableKg) || availableKg < 0) continue;
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
        availableKg,
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
      const rebuildFromDate = inventoryBalanceRebuildFromDate(null, updateDate);
      toast.success(t("notices.savedRebuildQueuedForward", { fromDate: rebuildFromDate }), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
        autoClose: 10000,
      });
      onInventoryBalanceForecastMutation();
      const farmLabel = farmNameById.get(selectedFarm) ?? selectedFarm;
      setNotice(t("savedOverrides", {
        count: updates.length,
        farm: farmLabel,
      }));
      void dispatchRouteAlert({
        routeKey: "inventory_update",
        title: t("alertInventoryUpdatedTitle", { farm: farmLabel }),
        message: t("alertInventoryUpdatedMessage", {
          count: updates.length,
          date: formatShortDate(updateDate),
        }),
        href: "/inventory",
        sourceEntityId: selectedFarm,
      });
      setBalanceUpdates({});
      setUpdateOpen(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t("saveBalanceFailed"));
    }
  }

  const stackedByGrass = useMemo(() => {
    const showAllFarmGrasses = selectedFarmIds.length > 0 && selectedGrassIds.length === 0;
    const farmNames = chartFarms.map((f) => f.name);
    const built = chartGrassIds
      .map((grassId) => {
        const grass =
          grassIdToTurfgrass.get(grassId) ??
          grassFilterOptions.find((o) => o.value === grassId)?.label ??
          grassId;
        const row: Record<string, string | number> = { grass, grassId };
        let total = 0;
        for (const farm of chartFarms) {
          const v = inventory
            .filter((z) => String(z.grassId) === grassId && String(z.farmId) === farm.id)
            .reduce((s, z) => s + z.currentKg, 0);
          row[farm.name] = v;
          total += v;
        }
        const overlimitTotal = inventoryOverlimit
          .filter((o) => String(o.grassId) === grassId)
          .reduce((s, o) => s + o.overlimitKg, 0);
        row.overlimitTotal = overlimitTotal;
        row.total = total;
        return row;
      })
      .filter(
        (r) =>
          showAllFarmGrasses ||
          (r.total as number) > 0 ||
          (r.overlimitTotal as number) > 0,
      );

    if (
      inventoryFiltersAll &&
      aggregateAvailableToday != null &&
      aggregateAvailableToday >= 0 &&
      built.length > 0
    ) {
      reconcileGrassStackedTotals(built, farmNames, aggregateAvailableToday);
    }

    return built;
  }, [
    chartGrassIds,
    chartFarms,
    grassIdToTurfgrass,
    grassFilterOptions,
    inventory,
    inventoryOverlimit,
    selectedFarmIds,
    selectedGrassIds,
    inventoryFiltersAll,
    aggregateAvailableToday,
  ]);

  const companyTotalKg = useMemo(() => {
    if (inventoryFiltersAll && aggregateAvailableToday != null) {
      return aggregateAvailableToday;
    }
    return stackedByGrass.reduce((s, r) => s + (r.total as number), 0);
  }, [inventoryFiltersAll, aggregateAvailableToday, stackedByGrass]);

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
              <div className="flex items-center gap-3">
                <h1 className="text-2xl lg:text-3xl font-semibold text-gray-900">{t("title")}</h1>
                <ForecastPageHeaderActions className="shrink-0" />
              </div>
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

          <div className="flex flex-wrap items-center gap-3">
            <MultiSelect
              options={farmFilterOptions}
              values={selectedFarmIds}
              onChange={setSelectedFarmIds}
              placeholder={t("allFarms")}
              showAllOption
              className={cn(multiSelectBaseClass, bgSurfaceFilter(selectedFarmIds.length > 0))}
              rightIcon={filterTriggerIcon}
            />
            <MultiSelect
              options={grassFilterOptions}
              values={selectedGrassIds}
              onChange={setSelectedGrassIds}
              placeholder={t("allGrassTypes")}
              showAllOption
              className={cn(multiSelectBaseClass, bgSurfaceFilter(selectedGrassIds.length > 0))}
              rightIcon={filterTriggerIcon}
            />
          </div>

          {notice ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {notice}
            </div>
          ) : null}

          {pageLoading ? (
            <p className="text-sm text-gray-500">{t("loading")}</p>
          ) : null}
          {!pageLoading && dbReady && !zoneRowsReady && !inventoryDb.error ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {t("loading")}
            </p>
          ) : null}
          {!pageLoading && dbReady && zoneRowsReady && rows.length === 0 && !inventoryDb.error ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {t("emptyInventory")}
            </p>
          ) : null}
          {inventoryDb.isLoading && inventoryDb.hasData ? (
            <p className="text-xs text-gray-500">{t("loading")}</p>
          ) : null}
          {inventoryDb.isStale ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Snapshot đang rebuild — bảng sẽ tự cập nhật khi worker xong (thường 2–20 phút tùy loại
              job).
            </p>
          ) : null}
          {updateOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="flex max-h-[min(90vh,52rem)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-white shadow-2xl">
                <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
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

                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
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
                      {isUpdateDateInFuture ? (
                        <p className="text-[11px] font-medium text-amber-800">
                          {t("futureUpdateDateHint")}
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
                      <div className="overflow-x-auto rounded-lg border border-border">
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
                                                  const rebuildFromDate = inventoryBalanceRebuildFromDate(
                                                    existing.date,
                                                    null,
                                                  );
                                                  toast.success(
                                                    t("notices.removedRebuildQueuedForward", {
                                                      fromDate: rebuildFromDate,
                                                    }),
                                                    {
                                                      containerId: TOAST_CONTAINER_TOP_RIGHT,
                                                      autoClose: 10000,
                                                    },
                                                  );
                                                  onInventoryBalanceForecastMutation();
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

                <div className="flex shrink-0 items-center justify-end gap-3 border-t border-border px-5 py-4">
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

                  const farmSlices: GrassPieSlice[] = chartFarms
                    .map((farm) => ({
                      name: farm.name,
                      value: row[farm.name] as number,
                      kind: "available" as const,
                    }))
                    .filter((s) => s.value > 0);

                  const grassId = String(row.grassId ?? "");
                  const overlimitSlices: GrassPieSlice[] = inventoryOverlimit
                    .filter((o) => String(o.grassId) === grassId)
                    .map((o) => ({
                      name: t("pieOverlimitSlice", { farm: resolveOverlimitFarmLabel(o) }),
                      value: o.overlimitKg,
                      kind: "overlimit" as const,
                    }))
                    .filter((s) => s.value > 0);

                  const slices = [...farmSlices, ...overlimitSlices];
                  const singleFarmSlice = farmSlices.length === 1;

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
                                      : farmChartColor(farmColorByName, s.name, singleFarmSlice)
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
                    <div>
                      <p className="text-[11px] text-muted-foreground">{t("balanceM2")}</p>
                      <div className="mt-0.5">
                        {renderBalanceBreakdownButton(
                          z,
                          inventoryBalanceKgToM2(z.currentKg, z.inventoryKgPerM2),
                          "m2",
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">{t("balanceKg")}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2">
                        {renderBalanceBreakdownButton(z, z.currentKg, "kg")}
                        {z.isManualOverrideActive ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                            {t("manualBadge")}
                          </span>
                        ) : null}
                      </div>
                      {z.isManualOverrideActive ? (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {t("systemUpdated", {
                            calc: (z.systemKgAtManualOverride ?? z.calculatedKg).toLocaleString(),
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
                      {renderOverlimitKg(o)}
                    </p>
                  </div>
                </div>
              ))}
              {inventory.length > 0 ? (
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-xs font-semibold text-foreground">{t("tableFooterTotal")}</p>
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                    <div>
                      <p className="text-[11px] text-muted-foreground">{t("sizeM2")}</p>
                      <p className="font-semibold tabular-nums">{inventoryTableTotals.sizeM2.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">{t("maxKg")}</p>
                      <p className="font-semibold tabular-nums">{inventoryTableTotals.maxKg.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">{t("balanceM2")}</p>
                      <p className="font-semibold tabular-nums">{inventoryTableTotals.balanceM2.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">{t("balanceKg")}</p>
                      <p className="font-semibold tabular-nums">{inventoryTableTotals.balanceKg.toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-muted-foreground">{t("level")}</span>
                      <span className="w-8 text-right text-xs font-semibold text-muted-foreground">
                        {inventoryTableTotals.pct}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted">
                      <div
                        className="h-2 rounded-full"
                        style={{
                          width: `${inventoryTableTotals.pct}%`,
                          backgroundColor:
                            inventoryTableTotals.pct > 70
                              ? "hsl(152,55%,36%)"
                              : inventoryTableTotals.pct > 40
                                ? "hsl(35,92%,52%)"
                                : "hsl(0,72%,51%)",
                        }}
                      />
                    </div>
                  </div>
                </div>
              ) : null}
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
                    <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">{t("thBalanceM2")}</th>
                    <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">
                      <span className="inline-flex items-center justify-end gap-1">
                        {t("thBalanceKg")}
                        <span className="group relative inline-flex shrink-0">
                          <HelpCircle
                            className="h-3.5 w-3.5 text-muted-foreground/70"
                            aria-label={t("thBalanceKgTooltipAria")}
                          />
                          <span
                            role="tooltip"
                            className="pointer-events-none absolute bottom-full right-0 z-20 mb-1.5 hidden w-max max-w-[14rem] rounded-md border border-border bg-popover px-2 py-1.5 text-[11px] font-normal normal-case leading-snug text-popover-foreground shadow-md group-hover:block"
                          >
                            {t("thBalanceKgTooltip")}
                          </span>
                        </span>
                      </span>
                    </th>
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
                        {renderBalanceBreakdownButton(
                          z,
                          inventoryBalanceKgToM2(z.currentKg, z.inventoryKgPerM2),
                          "m2",
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {renderBalanceBreakdownButton(z, z.currentKg, "kg")}
                          {/* {z.isManualOverrideActive ? (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                              {t("manualBadge")}
                            </span>
                          ) : null} */}
                        </div>
                        {z.isManualOverrideActive ? (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {t("systemUpdated", {
                            calc: (z.systemKgAtManualOverride ?? z.calculatedKg).toLocaleString(),
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
                    <tr
                      key={o.key}
                      className="border-t border-red-100 bg-red-50/40 hover:bg-red-50/70"
                    >
                      <td className="py-3 px-4 font-medium">{resolveOverlimitFarmLabel(o)}</td>
                      <td className="py-3 px-4">{o.turfgrass}</td>
                      <td className="py-3 px-4 font-medium text-red-700">{t("overlimitZoneLabel")}</td>
                      <td className="py-3 px-4 text-right text-muted-foreground">—</td>
                      <td className="py-3 px-4 text-right text-muted-foreground">—</td>
                      <td className="py-3 px-4 text-right text-muted-foreground">—</td>
                      <td className="py-3 px-4 text-right font-semibold text-red-700">
                        {renderOverlimitKg(o)}
                      </td>
                      <td className="py-3 px-4 text-muted-foreground">—</td>
                    </tr>
                  ))}
                </tbody>
                {inventory.length > 0 ? (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/40">
                      <td colSpan={3} className="py-3 px-4 text-sm font-semibold text-foreground">
                        {t("tableFooterTotal")}
                      </td>
                      <td className="py-3 px-4 text-right text-sm font-semibold tabular-nums text-foreground">
                        {inventoryTableTotals.sizeM2.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right text-sm font-semibold tabular-nums text-foreground">
                        {inventoryTableTotals.maxKg.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right text-sm font-semibold tabular-nums text-foreground">
                        {inventoryTableTotals.balanceM2.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right text-sm font-semibold tabular-nums text-foreground">
                        {inventoryTableTotals.balanceKg.toLocaleString()}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-muted rounded-full">
                            <div
                              className="h-2 rounded-full"
                              style={{
                                width: `${inventoryTableTotals.pct}%`,
                                backgroundColor:
                                  inventoryTableTotals.pct > 70
                                    ? "hsl(152,55%,36%)"
                                    : inventoryTableTotals.pct > 40
                                      ? "hsl(35,92%,52%)"
                                      : "hsl(0,72%,51%)",
                              }}
                            />
                          </div>
                          <span className="text-xs font-semibold text-muted-foreground w-8 text-right">
                            {inventoryTableTotals.pct}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>

            {balanceBreakdownZoneKey ? (
              <div ref={balanceBreakdownRef} className="pt-5">
                <InventoryZoneBalanceBreakdownPanel
                  zoneLabel={[
                    balanceBreakdownData?.row.farmName ??
                      inventory.find((r) => r.forecastZoneKey === balanceBreakdownZoneKey)?.farmName ??
                      "",
                    balanceBreakdownData?.row.turfgrass ??
                      inventory.find((r) => r.forecastZoneKey === balanceBreakdownZoneKey)?.turfgrass ??
                      "",
                    zoneLabel(
                      balanceBreakdownData?.row.zone ??
                        inventory.find((r) => r.forecastZoneKey === balanceBreakdownZoneKey)?.zone ??
                        "",
                    ),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  maxKg={
                    balanceBreakdownData?.row.maxKg ??
                    inventory.find((r) => r.forecastZoneKey === balanceBreakdownZoneKey)?.maxKg ??
                    0
                  }
                  todayYmd={inventoryTodayYmd}
                  todaySnapshot={balanceBreakdownData?.todaySnapshot}
                  timelineEntries={balanceBreakdownData?.timelineEntries ?? []}
                  loading={breakdownLoading}
                  displayUnit={balanceBreakdownUnit}
                  inventoryKgPerM2={
                    balanceBreakdownData?.row.inventoryKgPerM2 ??
                    inventory.find((r) => r.forecastZoneKey === balanceBreakdownZoneKey)
                      ?.inventoryKgPerM2 ??
                    0
                  }
                  onClose={() => {
                    setBalanceBreakdownZoneKey(null);
                    setBalanceBreakdownUnit("kg");
                  }}
                />
              </div>
            ) : null}
          </div>
        </div>
      </DashboardLayout>
    </RequireAuth>
  );
}
