"use client";

import { differenceInCalendarDays, format, isValid, parseISO } from "date-fns";
import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import {
  Calendar,
  TrendingUp,
  Clock,
  CheckCircle,
  Sprout,
} from "lucide-react";

import { mapRowsToSelectOptions } from "@/shared/lib/harvestReferenceData";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { DateRangePicker } from "@/shared/ui/date-picker/date-range-picker";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  fetchHarvestRowsForForecasting,
  rowsToMockHarvestRows,
} from "@/features/forecasting/mapHarvestApiToForecastRows";
import {
  computeMonthlyAvailabilityByProductFromRaw,
  computeMonthlyAvailabilityFromRaw,
  mapApiHarvestRawToRegrowthDays,
  type RegrowthPreviewRow,
} from "@/features/forecasting/regrowthDaysFromHarvestRow";
import type { ForecastHarvestRow } from "@/features/forecasting/forecastingTypes";
import {
  harvestRegrowthWindowOverlapsRange,
  inventoryReferenceYmd,
} from "@/shared/lib/harvestPlanDates";

/** Fallback labels when API / Zustand ref lists are still empty */
const FALLBACK_GRASS_TYPES = [
  "Bermuda",
  "Bentgrass",
  "Kentucky Bluegrass",
  "Zoysia",
  "Fescue",
];
const FALLBACK_FARMS = [
  "Oak Ridge Farm",
  "Meadowbrook Farm",
  "Sunset Valley Farm",
  "Highland Farm",
];

/** Update isReady / daysUntilReady using a reference date (not only "today"). */
function applyInventoryReference(
  h: ForecastHarvestRow,
  refYmd: string,
): ForecastHarvestRow {
  const readyOk =
    typeof h.readyDate === "string" && h.readyDate.length >= 10;
  const isReady = readyOk && h.readyDate <= refYmd;
  let daysUntilReady = 0;
  if (!isReady && readyOk) {
    const rd = parseISO(h.readyDate);
    const rf = parseISO(refYmd);
    if (isValid(rd) && isValid(rf)) {
      daysUntilReady = Math.max(0, differenceInCalendarDays(rd, rf));
    }
  }
  return { ...h, isReady, daysUntilReady };
}

const GRASS_PALETTE = [
  "#1F7A4C",
  "#2E9B5F",
  "#3EBC72",
  "#4FDD85",
  "#60EE98",
  "#22c55e",
  "#16a34a",
  "#15803d",
];

function buildGrassColors(grassNames: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  grassNames.forEach((g, i) => {
    out[g] = GRASS_PALETTE[i % GRASS_PALETTE.length];
  });
  return out;
}

function normalizeText(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function normalizeFarmKey(v: unknown): string {
  return String(v ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function ymdInRange(
  ymd: string,
  range: { from?: string; to?: string },
): boolean {
  if (!range.from && !range.to) return true;
  if (range.from && ymd < range.from) return false;
  if (range.to && ymd > range.to) return false;
  return true;
}

const REGROWTH_PERIODS: Record<"sod" | "sprig", number> = {
  sod: 4,
  sprig: 1,
};

/** @deprecated Use ForecastHarvestRow from forecastingTypes */
export type MockHarvestRow = ForecastHarvestRow;

function generateHarvestHistory(
  grassTypeList: string[],
  farmList: string[],
): ForecastHarvestRow[] {
  if (!grassTypeList.length || !farmList.length) return [];
  const history: ForecastHarvestRow[] = [];
  const today = new Date();

  for (let i = 0; i < 20; i++) {
    const daysAgo = Math.floor(Math.random() * 120);
    const harvestDate = new Date(today);
    harvestDate.setDate(harvestDate.getDate() - daysAgo);

    const harvestType: "sod" | "sprig" = Math.random() > 0.6 ? "sod" : "sprig";
    const grassType =
      grassTypeList[Math.floor(Math.random() * grassTypeList.length)];
    const farm = farmList[Math.floor(Math.random() * farmList.length)];
    const quantity = Math.floor(Math.random() * 15000) + 5000;

    const regrowthMonths = REGROWTH_PERIODS[harvestType];
    const readyDate = new Date(harvestDate);
    readyDate.setMonth(readyDate.getMonth() + regrowthMonths);

    const isReady = readyDate <= today;

    history.push({
      id: `H${1000 + i}`,
      farm,
      grassType,
      harvestType,
      harvestDate: harvestDate.toISOString().split("T")[0],
      readyDate: readyDate.toISOString().split("T")[0],
      quantity,
      isReady,
      daysUntilReady: isReady
        ? 0
        : Math.ceil(
            (readyDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
          ),
      uom: "KG",
    });
  }

  return history.sort(
    (a, b) =>
      new Date(b.harvestDate).getTime() - new Date(a.harvestDate).getTime(),
  );
}

function calculateInventory(
  farmList: string[],
  grassTypeList: string[],
  harvestHistory: ForecastHarvestRow[],
): Record<string, Record<string, number>> {
  const inventory: Record<string, Record<string, number>> = {};

  farmList.forEach((farm) => {
    inventory[farm] = {};
    grassTypeList.forEach((grass) => {
      const harvests = harvestHistory.filter(
        (h) => h.farm === farm && h.grassType === grass && h.isReady,
      );
      const available = harvests.reduce((sum, h) => sum + h.quantity, 0);
      inventory[farm][grass] = available;
    });
  });

  return inventory;
}

function generateTimeline(harvestHistory: ForecastHarvestRow[]) {
  const futureHarvests = harvestHistory
    .filter((h) => !h.isReady && h.daysUntilReady <= 180)
    .sort((a, b) => a.daysUntilReady - b.daysUntilReady);

  const grouped: Record<
    string,
    {
      weekStart: number;
      weekEnd: number;
      harvests: ForecastHarvestRow[];
      totalQuantity: number;
    }
  > = {};

  futureHarvests.forEach((h) => {
    const weekKey = Math.floor(h.daysUntilReady / 7);
    const key = String(weekKey);
    if (!grouped[key]) {
      grouped[key] = {
        weekStart: weekKey * 7,
        weekEnd: (weekKey + 1) * 7,
        harvests: [],
        totalQuantity: 0,
      };
    }
    grouped[key].harvests.push(h);
    grouped[key].totalQuantity += h.quantity;
  });

  return Object.values(grouped);
}

function getDefaultHarvestRange(): { from: string; to: string } {
  const now = new Date();
  const year = now.getFullYear();
  return {
    from: format(now, "yyyy-MM-dd"),
    to: `${year}-12-31`,
  };
}

export function InventoryForecast() {
  const [selectedFarms, setSelectedFarms] = useState<string[]>([]);
  const [selectedGrasses, setSelectedGrasses] = useState<string[]>([]);
  const [selectedCountryIds, setSelectedCountryIds] = useState<string[]>([]);
  const [harvestDateRange, setHarvestDateRange] = useState<{
    from?: string;
    to?: string;
  }>(() => getDefaultHarvestRange());
  const [viewMode, setViewMode] = useState<"current" | "forecast" | "timeline">(
    "current",
  );
  const [forecastUnit, setForecastUnit] = useState<"MIXED" | "KG" | "M2">("MIXED");

  const farmsRaw = useHarvestingDataStore((s) => s.farms);
  const grassesRaw = useHarvestingDataStore((s) => s.grasses);
  const countriesRaw = useHarvestingDataStore((s) => s.countries);
  const refLoading = useHarvestingDataStore((s) => s.loading);
  const refError = useHarvestingDataStore((s) => s.error);
  const fetchAllHarvestingReferenceData = useHarvestingDataStore(
    (s) => s.fetchAllHarvestingReferenceData,
  );

  useEffect(() => {
    void fetchAllHarvestingReferenceData();
  }, [fetchAllHarvestingReferenceData]);

  const farmOptions = useMemo(
    () => mapRowsToSelectOptions(farmsRaw as unknown[], "name"),
    [farmsRaw],
  );
  const grassOptions = useMemo(
    () => mapRowsToSelectOptions(grassesRaw as unknown[], "title"),
    [grassesRaw],
  );

  const farmList = useMemo(() => {
    const labels = farmOptions.map((o) => o.label).filter(Boolean);
    return labels.length ? labels : FALLBACK_FARMS;
  }, [farmOptions]);

  const grassTypeList = useMemo(() => {
    const labels = grassOptions.map((o) => o.label).filter(Boolean);
    return labels.length ? labels : FALLBACK_GRASS_TYPES;
  }, [grassOptions]);

  const countryOptions = useMemo(() => {
    const rows = countriesRaw as unknown[];
    const out: { id: string; label: string }[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      if (r.id === undefined || r.id === null) continue;
      const label = String(
        r.country_name ?? r.name ?? r.title ?? r.id,
      ).trim();
      out.push({ id: String(r.id), label: label || String(r.id) });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [countriesRaw]);

  const [apiHarvestRaw, setApiHarvestRaw] = useState<Record<string, unknown>[]>(
    [],
  );
  const [apiHarvestLoading, setApiHarvestLoading] = useState(true);
  const [apiHarvestError, setApiHarvestError] = useState<string | null>(null);

  /** Only change when picker year changes—avoid refetch for month-only narrowing (client overlap filtering). */
  const harvestYearForApi = useMemo(() => {
    return (
      harvestDateRange.from ??
      harvestDateRange.to ??
      getDefaultHarvestRange().from
    ).slice(0, 4);
  }, [harvestDateRange.from, harvestDateRange.to]);

  useEffect(() => {
    let cancelled = false;
    const from = `${harvestYearForApi}-01-01`;
    const to = `${harvestYearForApi}-12-31`;
    if (!from || !to) {
      setApiHarvestLoading(false);
      return;
    }

    setApiHarvestLoading(true);
    setApiHarvestError(null);

    void (async () => {
      const res = await fetchHarvestRowsForForecasting({
        actual_harvest_date_from: from,
        actual_harvest_date_to: to,
        perPage: 200,
        maxPages: 50,
      });
      if (cancelled) return;
      if (res.error) {
        setApiHarvestError(res.error);
        setApiHarvestRaw([]);
      } else {
        setApiHarvestRaw(res.rows);
      }
      setApiHarvestLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [harvestYearForApi]);

  const filteredApiHarvestRaw = useMemo(() => {
    if (selectedCountryIds.length === 0) return apiHarvestRaw;
    return apiHarvestRaw.filter((raw) =>
      selectedCountryIds.includes(String(raw.country_id ?? "").trim()),
    );
  }, [apiHarvestRaw, selectedCountryIds]);

  const regrowthDaysPreview = useMemo(
    () => mapApiHarvestRawToRegrowthDays(filteredApiHarvestRaw),
    [filteredApiHarvestRaw],
  );

  const monthlyAvailabilityFromRaw = useMemo(
    () => computeMonthlyAvailabilityFromRaw(filteredApiHarvestRaw),
    [filteredApiHarvestRaw],
  );
  const monthlyAvailabilityByProduct = useMemo(
    () =>
      computeMonthlyAvailabilityByProductFromRaw(filteredApiHarvestRaw, {
        fromYmd: harvestDateRange.from,
        toYmd: harvestDateRange.to,
      }),
    [filteredApiHarvestRaw, harvestDateRange.from, harvestDateRange.to],
  );

  const monthlyAvailabilityInSelectedRange = useMemo(() => {
    const fromKey = harvestDateRange.from?.slice(0, 7);
    const toKey = harvestDateRange.to?.slice(0, 7);
    return monthlyAvailabilityFromRaw.filter((row) => {
      if (fromKey && row.monthKey < fromKey) return false;
      if (toKey && row.monthKey > toKey) return false;
      return true;
    });
  }, [monthlyAvailabilityFromRaw, harvestDateRange.from, harvestDateRange.to]);

  const monthlyAvailabilityByProductInSelectedRange = useMemo(
    () => monthlyAvailabilityByProduct,
    [monthlyAvailabilityByProduct],
  );

  const grassNameById = useMemo(() => {
    const out = new Map<number, string>();
    const rows = grassesRaw as unknown[];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const id = Number(r.id);
      if (!Number.isFinite(id)) continue;
      const title = String(r.title ?? r.name ?? "").trim();
      if (title) out.set(id, title);
    }
    return out;
  }, [grassesRaw]);

  const regrowthPreviewWithGrass = useMemo(() => {
    return regrowthDaysPreview.map((row) => {
      const mapped = row.product_id ? grassNameById.get(row.product_id) : undefined;
      return {
        ...row,
        grassLabel: mapped ?? "",
      };
    });
  }, [regrowthDaysPreview, grassNameById]);

  const harvestHistoryFromApi = useMemo(
    () => rowsToMockHarvestRows(filteredApiHarvestRaw),
    [filteredApiHarvestRaw],
  );

  const mockHarvestHistory = useMemo(
    () => generateHarvestHistory(grassTypeList, farmList),
    [grassTypeList, farmList],
  );

  // console.log(mockHarvestHistory);

  /** API uses `actual_harvest_date_from`/`to` with actual|estimated CASE like PHP; fallback to demo on API error. */
  const harvestHistory = useMemo(() => {
    if (apiHarvestError) return mockHarvestHistory;
    if (apiHarvestLoading) return mockHarvestHistory;
    return harvestHistoryFromApi;
  }, [
    apiHarvestError,
    apiHarvestLoading,
    harvestHistoryFromApi,
    mockHarvestHistory,
  ]);

  const todayYmd = format(new Date(), "yyyy-MM-dd");
  /** Reference date for "is ready": depends on harvest (from–to)—if range is in the past, use range end date. */
  const inventoryRefYmd = useMemo(
    () => inventoryReferenceYmd(harvestDateRange, todayYmd),
    [harvestDateRange.from, harvestDateRange.to, todayYmd],
  );

  const monthlyAvailabilityAtRef = useMemo(() => {
    const refKey = inventoryRefYmd.slice(0, 7);
    let pick = monthlyAvailabilityInSelectedRange.find((x) => x.monthKey === refKey);
    if (pick) return pick;
    const prior = monthlyAvailabilityInSelectedRange
      .filter((x) => x.monthKey <= refKey)
      .sort((a, b) => b.monthKey.localeCompare(a.monthKey));
    pick = prior[0];
    return pick ?? null;
  }, [monthlyAvailabilityInSelectedRange, inventoryRefYmd]);

  const harvestHistoryAtRef = useMemo(
    () => harvestHistory.map((h) => applyInventoryReference(h, inventoryRefYmd)),
    [harvestHistory, inventoryRefYmd],
  );

  /** Merge grass types from API and product catalog (so charts do not miss newly added grass names). */
  const grassTypeListForCharts = useMemo(() => {
    const s = new Set(grassTypeList);
    harvestHistory.forEach((h) => {
      if (h.grassType) s.add(h.grassType);
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [grassTypeList, harvestHistory]);

  const farmListForCharts = useMemo(() => {
    const s = new Set(farmList);
    harvestHistory.forEach((h) => {
      if (h.farm) s.add(h.farm);
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [farmList, harvestHistory]);

  const grassColors = useMemo(
    () => buildGrassColors(grassTypeListForCharts),
    [grassTypeListForCharts],
  );

  const usingStoreFarms = farmOptions.length > 0;
  const usingStoreGrasses = grassOptions.length > 0;

  const filteredHistory = useMemo(
    () =>
      harvestHistoryAtRef.filter((h) => {
        if (selectedFarms.length > 0 && !selectedFarms.includes(h.farm)) return false;
        if (selectedGrasses.length > 0 && !selectedGrasses.includes(h.grassType))
          return false;
        if (
          !harvestRegrowthWindowOverlapsRange(
            h.harvestDate,
            h.readyDate,
            harvestDateRange,
          )
        )
          return false;
        return true;
      }),
    [harvestHistoryAtRef, selectedFarms, selectedGrasses, harvestDateRange],
  );

  const regrowthRowsInSelectedRange = useMemo(() => {
    return regrowthPreviewWithGrass.filter((r) => {
      // Regrowth/Growing only includes rows whose regrowth date is inside the selected range.
      if (!ymdInRange(r.regrowthDateYmd, harvestDateRange)) {
        return false;
      }
      if (
        selectedFarms.length > 0 &&
        !selectedFarms.some((f) => normalizeText(r.farm_name) === normalizeText(f))
      ) {
        return false;
      }
      if (
        selectedGrasses.length > 0 &&
        !selectedGrasses.some((g) => normalizeText(r.grassLabel) === normalizeText(g))
      ) {
        return false;
      }
      return true;
    });
  }, [regrowthPreviewWithGrass, harvestDateRange, selectedFarms, selectedGrasses]);

  const growingByProductRows = useMemo(() => {
    const byProduct = new Map<
      string,
      { productId: number | null; grass: string; growingKg: number; growingM2: number }
    >();
    for (const row of regrowthRowsInSelectedRange) {
      const key = String(row.product_id ?? `unknown:${row.grassLabel || "Unknown"}`);
      const current = byProduct.get(key) ?? {
        productId: row.product_id,
        grass: row.grassLabel || "Unknown",
        growingKg: 0,
        growingM2: 0,
      };
      if (row.uom === "M2") {
        current.growingM2 += row.regrowthQuantity;
      } else {
        current.growingKg += row.regrowthQuantity;
      }
      byProduct.set(key, current);
    }
    return Array.from(byProduct.values()).sort((a, b) =>
      a.grass.localeCompare(b.grass),
    );
  }, [regrowthRowsInSelectedRange]);

  const availableByProductRows = useMemo(() => {
    const byProduct = new Map<
      string,
      { productId: number | null; grass: string; availableKg: number; availableM2: number }
    >();
    for (const row of regrowthRowsInSelectedRange) {
      // Available = regrowth that has reached ready date at inventoryRefYmd.
      if (row.regrowthDateYmd > inventoryRefYmd) continue;
      const key = String(row.product_id ?? `unknown:${row.grassLabel || "Unknown"}`);
      const current = byProduct.get(key) ?? {
        productId: row.product_id,
        grass: row.grassLabel || "Unknown",
        availableKg: 0,
        availableM2: 0,
      };
      if (row.uom === "M2") {
        current.availableM2 += row.regrowthQuantity;
      } else {
        current.availableKg += row.regrowthQuantity;
      }
      byProduct.set(key, current);
    }
    return Array.from(byProduct.values()).sort((a, b) =>
      a.grass.localeCompare(b.grass),
    );
  }, [regrowthRowsInSelectedRange, inventoryRefYmd]);

  const availableByFarmRows = useMemo(() => {
    const byFarm = new Map<
      string,
      { farmId: number | null; farmName: string; availableKg: number; availableM2: number }
    >();
    for (const row of regrowthRowsInSelectedRange) {
      if (row.regrowthDateYmd > inventoryRefYmd) continue;
      const key = String(row.farm_id ?? `unknown:${row.farm_name || "Unknown"}`);
      const current = byFarm.get(key) ?? {
        farmId: row.farm_id,
        farmName: row.farm_name || "Unknown",
        availableKg: 0,
        availableM2: 0,
      };
      if (row.uom === "M2") {
        current.availableM2 += row.regrowthQuantity;
      } else {
        current.availableKg += row.regrowthQuantity;
      }
      byFarm.set(key, current);
    }
    return Array.from(byFarm.values()).sort((a, b) =>
      a.farmName.localeCompare(b.farmName),
    );
  }, [regrowthRowsInSelectedRange, inventoryRefYmd]);

  // console.log(availableByFarmRows);
  const formatValueForCard = (value: number): string => {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return "0";
    const abs = Math.abs(n);
    if (abs < 1000) return Math.round(n).toLocaleString();
    const scaled = abs / 1000;
    // Keep up to 3 decimals to preserve meaningful precision (e.g., 5323 -> 5.323k),
    // while trimming trailing zeros (e.g., 5323000 -> 5323k).
    const compact = scaled
      .toFixed(3)
      .replace(/\.000$/, "")
      .replace(/(\.\d*[1-9])0+$/, "$1");
    return `${n < 0 ? "-" : ""}${compact}k`;
  };

  const currentInventoryByFarmCards = useMemo(() => {
    type NumPair = { kg: number; m2: number };
    type Series = {
      farmName: string;
      farmId: number | null;
      grass: string;
      regByMonth: Map<string, NumPair>;
      harByMonth: Map<string, NumPair>;
    };
    type FarmCard = {
      farmId: number | null;
      farmName: string;
      totalKg: number;
      totalM2: number;
      byGrass: Map<string, { kg: number; m2: number; lastMonthKey: string }>;
    };

    const monthInc = (monthKey: string): string => {
      const [yStr, mStr] = monthKey.split("-");
      const y = Number(yStr);
      const m = Number(mStr);
      if (m >= 12) return `${String(y + 1).padStart(4, "0")}-01`;
      return `${String(y).padStart(4, "0")}-${String(m + 1).padStart(2, "0")}`;
    };

    const selectedYear = Number(
      String(harvestDateRange.from ?? harvestDateRange.to ?? "").slice(0, 4),
    );
    const targetYear = Number.isFinite(selectedYear) ? selectedYear : new Date().getFullYear();
    const yearStartKey = `${String(targetYear).padStart(4, "0")}-01`;
    const yearEndKey = `${String(targetYear).padStart(4, "0")}-12`;
    const fromKey =
      harvestDateRange.from?.slice(0, 7).startsWith(String(targetYear))
        ? String(harvestDateRange.from).slice(0, 7)
        : yearStartKey;
    const toKeyRaw =
      harvestDateRange.to?.slice(0, 7).startsWith(String(targetYear))
        ? String(harvestDateRange.to).slice(0, 7)
        : yearEndKey;
    const toKey = toKeyRaw > yearEndKey ? yearEndKey : toKeyRaw;

    const rawFarmsForCards =
      selectedFarms.length > 0 ? selectedFarms : farmListForCharts;
    const farmDisplayByKey = new Map<string, string>();
    for (const f of rawFarmsForCards) {
      const label = String(f ?? "").trim();
      const key = normalizeFarmKey(label);
      if (!key) continue;
      if (!farmDisplayByKey.has(key)) farmDisplayByKey.set(key, label);
    }
    const farmsForCards = Array.from(farmDisplayByKey.values());
    const grassesForCards =
      selectedGrasses.length > 0 ? selectedGrasses : grassTypeListForCharts;
    const seriesMap = new Map<string, Series>();

    const ensureSeries = (
      farmName: string,
      grass: string,
      farmId: number | null,
    ): Series => {
      const farmKey = normalizeFarmKey(farmName);
      const key = `${farmKey}__${grass}`;
      const existing = seriesMap.get(key);
      if (existing) return existing;
      const created: Series = {
        farmName: farmDisplayByKey.get(farmKey) ?? farmName,
        farmId,
        grass,
        regByMonth: new Map<string, NumPair>(),
        harByMonth: new Map<string, NumPair>(),
      };
      seriesMap.set(key, created);
      return created;
    };

    // Regrowth by farm + grass + month
    for (const row of regrowthPreviewWithGrass) {
      const farmName = String(row.farm_name || "Unknown").trim();
      const farmKey = normalizeFarmKey(farmName);
      if (!farmDisplayByKey.has(farmKey)) continue;
      if (
        selectedGrasses.length > 0 &&
        !selectedGrasses.some((g) => normalizeText(row.grassLabel) === normalizeText(g))
      ) continue;
      const monthKey = row.regrowthDateYmd.slice(0, 7);
      if (!monthKey.startsWith(String(targetYear))) continue;
      const s = ensureSeries(
        farmDisplayByKey.get(farmKey) ?? farmName,
        row.grassLabel || "Unknown",
        row.farm_id,
      );
      const cur = s.regByMonth.get(monthKey) ?? { kg: 0, m2: 0 };
      if (row.uom === "M2") cur.m2 += row.regrowthQuantity;
      else cur.kg += row.regrowthQuantity;
      s.regByMonth.set(monthKey, cur);
    }

    // Harvest by farm + grass + month (actual_harvest_date)
    for (const raw of apiHarvestRaw) {
      const actual = String(raw.actual_harvest_date ?? "").trim();
      const match = /^(\d{4}-\d{2})-\d{2}$/.exec(actual);
      if (!match) continue;
      const monthKey = match[1];
      if (!monthKey.startsWith(String(targetYear))) continue;
      const farmName = String(raw.farm_name ?? "").trim() || "Unknown";
      const farmKey = normalizeFarmKey(farmName);
      if (!farmDisplayByKey.has(farmKey)) continue;
      const productId = Number(raw.product_id ?? NaN);
      const grass =
        grassNameById.get(productId) ??
        (String(raw.grass_name ?? "").trim() || "Unknown");
      if (
        selectedGrasses.length > 0 &&
        !selectedGrasses.some((g) => normalizeText(grass) === normalizeText(g))
      ) continue;
      const s = ensureSeries(
        farmDisplayByKey.get(farmKey) ?? farmName,
        grass,
        Number.isFinite(Number(raw.farm_id)) ? Number(raw.farm_id) : null,
      );
      const cur = s.harByMonth.get(monthKey) ?? { kg: 0, m2: 0 };
      const qty = Number(raw.quantity ?? 0);
      const uom = String(raw.uom ?? "").trim().toUpperCase();
      if (uom === "M2") cur.m2 += qty;
      else cur.kg += qty;
      s.harByMonth.set(monthKey, cur);
    }

    const byFarm = new Map<string, FarmCard>();
    for (const farmName of farmsForCards) {
      byFarm.set(normalizeFarmKey(farmName), {
        farmId: null,
        farmName,
        totalKg: 0,
        totalM2: 0,
        byGrass: new Map<string, { kg: number; m2: number; lastMonthKey: string }>(),
      });
    }

    // Compute monthly available using: (starting + regrowth) - harvested
    for (const s of seriesMap.values()) {
      const activityKeys = Array.from(
        new Set([...s.regByMonth.keys(), ...s.harByMonth.keys()]),
      ).sort((a, b) => a.localeCompare(b));
      const earliest = activityKeys[0];
      const seriesStart = earliest && earliest < fromKey ? earliest : fromKey;
      const monthToShow = toKey;

      let prevKg = 0;
      let prevM2 = 0;
      let cursor = seriesStart;
      const availableByMonth = new Map<string, NumPair>();
      while (cursor <= toKey) {
        const reg = s.regByMonth.get(cursor) ?? { kg: 0, m2: 0 };
        const har = s.harByMonth.get(cursor) ?? { kg: 0, m2: 0 };
        const available = {
          kg: prevKg + reg.kg - har.kg,
          m2: prevM2 + reg.m2 - har.m2,
        };
        availableByMonth.set(cursor, available);
        prevKg = available.kg;
        prevM2 = available.m2;
        cursor = monthInc(cursor);
      }

      const last = availableByMonth.get(monthToShow) ?? { kg: 0, m2: 0 };
      const farm = byFarm.get(normalizeFarmKey(s.farmName));
      if (!farm) continue;
      farm.farmId = farm.farmId ?? s.farmId;
      farm.byGrass.set(s.grass, { kg: last.kg, m2: last.m2, lastMonthKey: monthToShow });
      farm.totalKg += last.kg;
      farm.totalM2 += last.m2;
    }

    // Keep all grasses on UI; show 0 even when no data is present.
    for (const farm of byFarm.values()) {
      for (const grass of grassesForCards) {
        if (!farm.byGrass.has(grass)) {
          farm.byGrass.set(grass, { kg: 0, m2: 0, lastMonthKey: toKey });
        }
      }
    }

    const mergedByDisplayName = new Map<string, FarmCard>();
    for (const farm of byFarm.values()) {
      const k = normalizeFarmKey(farm.farmName);
      const existing = mergedByDisplayName.get(k);
      if (!existing) {
        mergedByDisplayName.set(k, {
          farmId: farm.farmId,
          farmName: farm.farmName,
          totalKg: 0,
          totalM2: 0,
          byGrass: new Map(farm.byGrass),
        });
        continue;
      }

      for (const [grass, v] of farm.byGrass.entries()) {
        const cur = existing.byGrass.get(grass);
        if (!cur) {
          existing.byGrass.set(grass, v);
          continue;
        }
        existing.byGrass.set(grass, {
          kg: cur.kg + v.kg,
          m2: cur.m2 + v.m2,
          lastMonthKey: v.lastMonthKey > cur.lastMonthKey ? v.lastMonthKey : cur.lastMonthKey,
        });
      }
      if (!existing.farmId && farm.farmId) existing.farmId = farm.farmId;
    }

    for (const farm of mergedByDisplayName.values()) {
      let totalKg = 0;
      let totalM2 = 0;
      for (const v of farm.byGrass.values()) {
        totalKg += v.kg;
        totalM2 += v.m2;
      }
      farm.totalKg = totalKg;
      farm.totalM2 = totalM2;
    }

    return Array.from(mergedByDisplayName.values()).sort((a, b) =>
      a.farmName.localeCompare(b.farmName),
    );
  }, [
    apiHarvestRaw,
    regrowthPreviewWithGrass,
    grassNameById,
    selectedFarms,
    selectedGrasses,
    farmListForCharts,
    grassTypeListForCharts,
    harvestDateRange.from,
    harvestDateRange.to,
  ]);

  /** Farm / grass lists for UI: when filtered, only display corresponding columns/cards. */
  const displayFarmList = useMemo(
    () => (selectedFarms.length > 0 ? selectedFarms : farmListForCharts),
    [selectedFarms, farmListForCharts],
  );
  const displayGrassList = useMemo(
    () => (selectedGrasses.length > 0 ? selectedGrasses : grassTypeListForCharts),
    [selectedGrasses, grassTypeListForCharts],
  );
  const availableByGrassLastMonthRows = useMemo(() => {
    const byGrassMonth = new Map<string, Map<string, { kg: number; m2: number }>>();
    for (const row of monthlyAvailabilityByProductInSelectedRange) {
      const grass = grassNameById.get(row.productId) ?? `Product ${row.productId}`;
      const monthMap = byGrassMonth.get(grass) ?? new Map<string, { kg: number; m2: number }>();
      const cur = monthMap.get(row.monthKey) ?? { kg: 0, m2: 0 };
      cur.kg += row.availableKg;
      cur.m2 += row.availableM2;
      monthMap.set(row.monthKey, cur);
      byGrassMonth.set(grass, monthMap);
    }

    return displayGrassList.map((grass) => {
      const monthMap = byGrassMonth.get(grass) ?? new Map<string, { kg: number; m2: number }>();
      const lastMonthKey = Array.from(monthMap.keys()).sort((a, b) => a.localeCompare(b)).pop();
      const last = lastMonthKey ? monthMap.get(lastMonthKey) : undefined;
      return {
        grass,
        availableKg: last?.kg ?? 0,
        availableM2: last?.m2 ?? 0,
        lastMonthKey: lastMonthKey ?? "—",
      };
    });
  }, [monthlyAvailabilityByProductInSelectedRange, grassNameById, displayGrassList]);

  const inventory = useMemo(
    () =>
      calculateInventory(farmListForCharts, grassTypeListForCharts, filteredHistory),
    [farmListForCharts, grassTypeListForCharts, filteredHistory],
  );

  const harvestRangeSummary = useMemo(() => {
    if (!harvestDateRange.from && !harvestDateRange.to) return null;
    const f = harvestDateRange.from ? parseISO(harvestDateRange.from) : undefined;
    const t = harvestDateRange.to ? parseISO(harvestDateRange.to) : undefined;
    const okF = f && isValid(f);
    const okT = t && isValid(t);
    if (okF && okT) {
      return `${format(f!, "MMM d, yyyy")} – ${format(t!, "MMM d, yyyy")}`;
    }
    if (okF) return `From ${format(f!, "MMM d, yyyy")}`;
    if (okT) return `Until ${format(t!, "MMM d, yyyy")}`;
    return null;
  }, [harvestDateRange]);

  const forecastMonthCount = useMemo(() => {
    const from = harvestDateRange.from ? parseISO(harvestDateRange.from) : null;
    const to = harvestDateRange.to ? parseISO(harvestDateRange.to) : null;
    if (!from || !to || !isValid(from) || !isValid(to) || to < from) return 1;
    return (
      (to.getFullYear() - from.getFullYear()) * 12 +
      (to.getMonth() - from.getMonth()) +
      1
    );
  }, [harvestDateRange.from, harvestDateRange.to]);

  const forecast = useMemo(() => {
    const from = harvestDateRange.from ? parseISO(harvestDateRange.from) : null;
    const to = harvestDateRange.to ? parseISO(harvestDateRange.to) : null;
    const validRange = Boolean(from && to && isValid(from) && isValid(to) && to >= from);

    const start = validRange ? new Date(from!.getFullYear(), from!.getMonth(), 1) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const end = validRange ? new Date(to!.getFullYear(), to!.getMonth(), 1) : new Date(start.getFullYear(), start.getMonth() + 5, 1);

    const monthKeys: string[] = [];
    let cursor = new Date(start);
    while (cursor <= end) {
      monthKeys.push(`${String(cursor.getFullYear()).padStart(4, "0")}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }

    const byGrassMonth = new Map<string, Map<string, number>>();
    for (const row of monthlyAvailabilityByProductInSelectedRange) {
      const grass = grassNameById.get(row.productId) ?? `Product ${row.productId}`;
      const monthMap = byGrassMonth.get(grass) ?? new Map<string, number>();
      const available =
        forecastUnit === "KG"
          ? row.availableKg
          : forecastUnit === "M2"
            ? row.availableM2
            : row.availableKg + row.availableM2;
      monthMap.set(row.monthKey, (monthMap.get(row.monthKey) ?? 0) + available);
      byGrassMonth.set(grass, monthMap);
    }

    return monthKeys.map((monthKey) => {
      const [yearStr, monthStr] = monthKey.split("-");
      const d = new Date(Number(yearStr), Number(monthStr) - 1, 1);
      const entry: Record<string, string | number> = {
        date: monthKey,
        month: d.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
      };
      for (const grass of displayGrassList) {
        entry[grass] = byGrassMonth.get(grass)?.get(monthKey) ?? 0;
      }
      return entry;
    });
  }, [
    harvestDateRange.from,
    harvestDateRange.to,
    monthlyAvailabilityByProductInSelectedRange,
    grassNameById,
    displayGrassList,
    forecastUnit,
  ]);

  const regrowthTimeline = useMemo(() => {
    const today = parseISO(todayYmd);
    const getWeekOfYear = (d: Date): { year: number; week: number } => {
      const year = d.getFullYear();
      const jan1 = new Date(year, 0, 1);
      const dayOfYear = differenceInCalendarDays(d, jan1) + 1;
      const week = Math.floor((dayOfYear - 1) / 7) + 1;
      return { year, week };
    };

    const grouped = new Map<
      string,
      {
        year: number;
        weekOfYear: number;
        totalKg: number;
        totalM2: number;
        items: Array<{
          id: string | number | null;
          farm: string;
          grass: string;
          uom: "KG" | "M2";
          quantity: number;
          regrowthDateYmd: string;
          daysUntilRegrowth: number;
          weekNoInYear: number;
        }>;
      }
    >();

    for (const r of regrowthRowsInSelectedRange) {
      const regrowthDate = parseISO(r.regrowthDateYmd);
      if (!isValid(regrowthDate)) continue;
      const daysUntilRegrowth = Math.max(0, differenceInCalendarDays(regrowthDate, today));
      const wk = getWeekOfYear(regrowthDate);
      const weekKey = `${wk.year}-${String(wk.week).padStart(2, "0")}`;
      const bucket = grouped.get(weekKey) ?? {
        year: wk.year,
        weekOfYear: wk.week,
        totalKg: 0,
        totalM2: 0,
        items: [],
      };
      if (r.uom === "M2") bucket.totalM2 += r.regrowthQuantity;
      else bucket.totalKg += r.regrowthQuantity;
      bucket.items.push({
        id: r.id,
        farm: r.farm_name,
        grass: r.grassLabel || "Unknown",
        uom: r.uom,
        quantity: r.regrowthQuantity,
        regrowthDateYmd: r.regrowthDateYmd,
        daysUntilRegrowth,
        weekNoInYear: wk.week,
      });
      grouped.set(weekKey, bucket);
    }

    return Array.from(grouped.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, v]) => v);
  }, [regrowthRowsInSelectedRange, todayYmd]);

  const harvestStatusRows = useMemo(() => {
    const today = parseISO(todayYmd);
    return regrowthRowsInSelectedRange
      .map((row) => {
        const ready = parseISO(row.regrowthDateYmd);
        const diff = isValid(ready) ? differenceInCalendarDays(ready, today) : 0;
        return {
          id: String(row.id ?? ""),
          farm: row.farm_name || "Unknown",
          grassType: row.grassLabel || "Unknown",
          harvestType: row.uom === "M2" ? "m2" : "kg",
          harvestDate: row.actualHarvestDateYmd,
          readyDate: row.regrowthDateYmd,
          quantity: row.regrowthQuantity,
          statusType: diff > 0 ? "pending" : "ready",
          statusLabel: diff > 0 ? `${diff}d` : "Ready",
        };
      })
      .sort((a, b) => a.readyDate.localeCompare(b.readyDate));
  }, [regrowthRowsInSelectedRange, todayYmd]);

  const timeline = useMemo(
    () => generateTimeline(filteredHistory),
    [filteredHistory],
  );

  // KPI based on regrowth set already filtered by Harvest date (from–to).
  const totalAvailableByUom = useMemo(() => {
    const currentMonth = todayYmd.slice(0, 7);
    let kg = 0;
    let m2 = 0;
    for (const r of regrowthRowsInSelectedRange) {
      if (r.regrowthDateYmd.slice(0, 7) !== currentMonth) continue;
      if (r.regrowthDateYmd > todayYmd) continue;
      if (r.uom === "M2") m2 += r.regrowthQuantity;
      else kg += r.regrowthQuantity;
    }
    return { kg, m2, total: kg + m2 };
  }, [regrowthRowsInSelectedRange, todayYmd]);

  const totalGrowingByUom = useMemo(() => {
    let kg = 0;
    let m2 = 0;
    for (const r of regrowthRowsInSelectedRange) {
      if (r.uom === "M2") m2 += r.regrowthQuantity;
      else kg += r.regrowthQuantity;
    }
    return { kg, m2, total: kg + m2 };
  }, [regrowthRowsInSelectedRange]);

  const readyThisWeekFarmCount = useMemo(() => {
    const today = parseISO(todayYmd);
    const farms = new Set<string>();
    for (const r of regrowthRowsInSelectedRange) {
      const ready = parseISO(r.regrowthDateYmd);
      if (!isValid(ready)) continue;
      const diff = differenceInCalendarDays(ready, today);
      if (diff >= 0 && diff <= 6) farms.add(normalizeFarmKey(r.farm_name));
    }
    return farms.size;
  }, [regrowthRowsInSelectedRange, todayYmd]);

  const readyNext30DaysFarmCount = useMemo(() => {
    const today = parseISO(todayYmd);
    const farms = new Set<string>();
    for (const r of regrowthRowsInSelectedRange) {
      const ready = parseISO(r.regrowthDateYmd);
      if (!isValid(ready)) continue;
      const diff = differenceInCalendarDays(ready, today);
      if (diff >= 0 && diff <= 30) farms.add(normalizeFarmKey(r.farm_name));
    }
    return farms.size;
  }, [regrowthRowsInSelectedRange, todayYmd]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <Calendar className="w-8 h-8 text-[#1F7A4C]" />
              <div>
                <h1 className="text-2xl sm:text-3xl font-semibold text-gray-900">
                  Inventory Forecast & Planning
                </h1>
                <p className="text-sm text-gray-600 mt-1">
                  Track regrowth and plan future harvests
                </p>
                {harvestRangeSummary ? (
                  <p className="mt-2 text-sm font-medium text-[#1F7A4C]">
                    Harvest dates: {harvestRangeSummary}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {refError ? (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {refError}
          </div>
        ) : null}
        {refLoading ? (
          <p className="mb-6 text-sm text-gray-500">
            Loading farms and grass types…
          </p>
        ) : null}
        {apiHarvestError ? (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            Could not load live harvesting data ({apiHarvestError}). Charts use
            demo data until the API is reachable.
          </div>
        ) : null}
        {apiHarvestLoading && !apiHarvestError ? (
          <p className="mb-6 text-sm text-gray-500">
            Loading harvesting plans for the selected period…
          </p>
        ) : null}
        {!refLoading && (!usingStoreFarms || !usingStoreGrasses) ? (
          <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            Demo labels are shown until farm and grass lists are available from
            the server.
          </p>
        ) : null}

        {/* View mode + harvest date range — applies to all metrics and charts below */}
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setViewMode("current")}
              className={`rounded-lg border px-4 py-2 transition-colors ${
                viewMode === "current"
                  ? "border-[#1F7A4C] bg-[#1F7A4C] text-white"
                  : "border-gray-300 bg-white text-gray-700 hover:border-[#1F7A4C]"
              }`}
            >
              Current Inventory
            </button>
            <button
              type="button"
              onClick={() => setViewMode("forecast")}
              className={`rounded-lg border px-4 py-2 transition-colors ${
                viewMode === "forecast"
                  ? "border-[#1F7A4C] bg-[#1F7A4C] text-white"
                  : "border-gray-300 bg-white text-gray-700 hover:border-[#1F7A4C]"
              }`}
            >
              {forecastMonthCount}-Month Forecast
            </button>
            <button
              type="button"
              onClick={() => setViewMode("timeline")}
              className={`rounded-lg border px-4 py-2 transition-colors ${
                viewMode === "timeline"
                  ? "border-[#1F7A4C] bg-[#1F7A4C] text-white"
                  : "border-gray-300 bg-white text-gray-700 hover:border-[#1F7A4C]"
              }`}
            >
              Regrowth Timeline
            </button>
          </div>
          <div className="flex w-full flex-col gap-2 sm:max-w-md lg:w-auto lg:min-w-[min(100%,320px)]">
            <span className="text-sm font-medium text-gray-700">
            </span>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <DateRangePicker
                value={harvestDateRange}
                onChange={setHarvestDateRange}
                placeholder="Harvest date range (default: today → end of current year)"
                className="min-w-0 flex-1"
              />
              <button
                type="button"
                onClick={() => setHarvestDateRange(getDefaultHarvestRange())}
                className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:border-[#1F7A4C]"
              >
                Reset to this year
              </button>
            </div>
          </div>
        </div>

        {/* Key Stats — filteredHistory: [harvest, ready] overlap with selected range; ready date from regrowth formula */}
        <div className="mb-8">
          
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Available Now</span>
              <CheckCircle className="w-5 h-5 text-green-600" />
            </div>
            <div className="text-3xl font-semibold text-gray-900">
              {formatValueForCard(totalAvailableByUom.total)}
            </div>
            <div className="mt-1 text-xs text-gray-600">
              KG: <span className="font-medium text-gray-800">{formatValueForCard(totalAvailableByUom.kg)}</span>
              {" | "}
              M2: <span className="font-medium text-gray-800">{formatValueForCard(totalAvailableByUom.m2)}</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Total regrowth ready in the current month
            </p>
          </div>

          <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Growing</span>
              <Sprout className="w-5 h-5 text-yellow-600" />
            </div>
            <div className="text-3xl font-semibold text-gray-900">
              {formatValueForCard(totalGrowingByUom.total)}
            </div>
            <div className="mt-1 text-xs text-gray-600">
              KG: <span className="font-medium text-gray-800">{formatValueForCard(totalGrowingByUom.kg)}</span>
              {" | "}
              M2: <span className="font-medium text-gray-800">{formatValueForCard(totalGrowingByUom.m2)}</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Total regrowth within Harvest date (from–to)
            </p>
          </div>

          <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Ready This Week</span>
              <Clock className="w-5 h-5 text-blue-600" />
            </div>
            <div className="text-3xl font-semibold text-gray-900">{readyThisWeekFarmCount}</div>
            <p className="text-xs text-gray-500 mt-1">Number of farms with regrowth this week</p>
          </div>

          <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Next 30 Days</span>
              <TrendingUp className="w-5 h-5 text-purple-600" />
            </div>
            <div className="text-3xl font-semibold text-gray-900">{readyNext30DaysFarmCount}</div>
            <p className="text-xs text-gray-500 mt-1">Number of farms with regrowth in the next 30 days</p>
          </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Country
              </label>
              <MultiSelect
                options={countryOptions.map((c) => ({ value: c.id, label: c.label }))}
                values={selectedCountryIds}
                onChange={setSelectedCountryIds}
                placeholder="All countries"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Filter by Farm
              </label>
              <MultiSelect
                options={farmList.map((farm) => ({ value: farm, label: farm }))}
                values={selectedFarms}
                onChange={setSelectedFarms}
                placeholder="All farms"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Filter by Grass Type
              </label>
              <MultiSelect
                options={grassTypeList.map((grass) => ({ value: grass, label: grass }))}
                values={selectedGrasses}
                onChange={setSelectedGrasses}
                placeholder="All grass types"
              />
            </div>
          </div>
        </div>

    
        {/* Current Inventory View */}
        {viewMode === 'current' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Available by Grass Type */}
            <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Available Inventory by Grass Type
              </h2>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={availableByGrassLastMonthRows}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="grass" tick={{ fontSize: 11 }} angle={-45} textAnchor="end" height={80} />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    domain={[
                      (dataMin: number) => Math.min(0, Math.floor(dataMin)),
                      (dataMax: number) => Math.max(0, Math.ceil(dataMax)),
                    ]}
                  />
                  <ReferenceLine y={0} stroke="#6B7280" strokeDasharray="4 4" />
                  <Tooltip
                    formatter={(value: number, _name: string, ctx) => {
                      const month = String((ctx?.payload as { lastMonthKey?: string })?.lastMonthKey ?? "—");
                      const key = String(ctx?.dataKey ?? "");
                      const unit = key === "availableKg" ? "KG" : "M2";
                      return `${value.toLocaleString()} ${unit} (last month: ${month})`;
                    }}
                    contentStyle={{
                      backgroundColor: 'white',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                    }}
                  />
                  <Legend />
                  <Bar dataKey="availableKg" fill="#16A34A" radius={[8, 8, 0, 0]} name="KG" />
                  <Bar dataKey="availableM2" fill="#2563EB" radius={[8, 8, 0, 0]} name="M2" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Growing Inventory — total quantity of lots not ready at inventoryRefYmd; ready date from regrowth formula */}
            <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-1">
                Growing Inventory (In Regrowth)
              </h2>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={growingByProductRows}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="grass" tick={{ fontSize: 11 }} angle={-45} textAnchor="end" height={80} />
                  <YAxis tick={{ fontSize: 12 }} domain={["auto", "auto"]} />
                  <ReferenceLine y={0} stroke="#6B7280" strokeDasharray="4 4" />
                  <Tooltip
                    formatter={(value: number, name: string) =>
                      `${value.toLocaleString()} ${name === "growingKg" ? "KG" : "M2"}`
                    }
                    contentStyle={{
                      backgroundColor: 'white',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                    }}
                  />
                  <Legend />
                  <Bar dataKey="growingKg" name="KG" fill="#F59E0B" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="growingM2" name="M2" fill="#2563EB" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Inventory by Farm */}
            <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm lg:col-span-2">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Current Inventory by Farm
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {currentInventoryByFarmCards.map((farm) => (
                  <div
                    key={`${farm.farmId ?? "unknown"}-${farm.farmName}`}
                    className="rounded-lg border border-gray-200 bg-gray-50 p-4"
                  >
                    <h3 className="text-xl font-semibold text-gray-800">{farm.farmName}</h3>
                    <div
                      className={`mt-2 text-3xl font-bold ${
                        farm.totalKg + farm.totalM2 < 0 ? "text-red-600" : "text-[#1F7A4C]"
                      }`}
                    >
                      {formatValueForCard(farm.totalKg + farm.totalM2)}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {formatValueForCard(farm.totalKg)} <small className="text-[70%]">KG</small> | {formatValueForCard(farm.totalM2)} <small className="text-[70%]">M2</small> 
                    </div>
                    <div className="mt-3 space-y-1.5 text-sm">
                      {displayGrassList.map((grass) => {
                        const item = farm.byGrass.get(grass) ?? { kg: 0, m2: 0 };
                        return (
                          <div key={`${farm.farmName}-${grass}`} className="flex items-start justify-between gap-3">
                            <span className="text-gray-700">{grass}</span>
                            <span className="text-right tabular-nums leading-5">
                              <div className={item.kg < 0 ? "text-red-600" : "text-gray-900"}>
                                {formatValueForCard(item.kg)} <small className="text-[70%]">KG</small>
                              </div>
                              <div className={item.m2 < 0 ? "text-red-600" : "text-gray-900"}>
                                {formatValueForCard(item.m2)} <small className="text-[70%]">M2</small>
                              </div>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}

        {/* Forecast View */}
        {viewMode === 'forecast' && (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-1">
                {forecastMonthCount}-Month Availability Forecast
              </h2>
              <div className="mb-4 flex items-center gap-2 text-xs">
                <span className="text-gray-600">Display unit:</span>
                {(["MIXED", "KG", "M2"] as const).map((unit) => (
                  <button
                    key={unit}
                    type="button"
                    onClick={() => setForecastUnit(unit)}
                    className={`rounded border px-2 py-1 ${
                      forecastUnit === unit
                        ? "border-[#1F7A4C] bg-[#1F7A4C] text-white"
                        : "border-gray-300 bg-white text-gray-700"
                    }`}
                  >
                    {unit}
                  </button>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={400}>
                <AreaChart data={forecast}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(value: number) =>
                      `${formatValueForCard(value)} ${forecastUnit === "MIXED" ? "(KG+M2)" : forecastUnit}`
                    }
                    contentStyle={{
                      backgroundColor: 'white',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  {displayGrassList.map((grass) => (
                    <Area
                      key={grass}
                      type="monotone"
                      dataKey={grass}
                      stackId="1"
                      stroke={grassColors[grass] ?? GRASS_PALETTE[0]}
                      fill={grassColors[grass] ?? GRASS_PALETTE[0]}
                      fillOpacity={0.6}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Forecast Details */}
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Monthly Forecast Details</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                        Month
                      </th>
                      {displayGrassList.map((grass) => (
                        <th
                          key={grass}
                          className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase"
                        >
                          {grass}
                        </th>
                      ))}
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {forecast.map((row) => {
                      const qty = (grass: string) =>
                        typeof row[grass] === "number" ? row[grass] : 0;
                      const total = displayGrassList.reduce(
                        (sum, grass) => sum + qty(grass),
                        0,
                      );
                      return (
                        <tr key={String(row.date)} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">
                            {row.month}
                          </td>
                          {displayGrassList.map((grass) => (
                            <td key={grass} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {formatValueForCard(qty(grass))}
                            </td>
                          ))}
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            {formatValueForCard(total)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Timeline View */}
        {viewMode === 'timeline' && (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Upcoming Availability Timeline
              </h2>
              <p className="text-sm text-gray-600 mb-6">
                Fields grouped by week until ready for harvest
              </p>

              <div className="space-y-4">
                {regrowthTimeline.slice(0, 24).map((week, index) => (
                  <div
                    key={index}
                    className="border border-gray-200 rounded-lg p-4 hover:border-[#1F7A4C] transition-colors"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Clock className="w-5 h-5 text-blue-600" />
                        <span className="font-medium text-gray-900">
                          Week {week.weekOfYear}
                        </span>
                        <span className="text-sm text-gray-600">
                          (Year {week.year})
                        </span>
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-gray-600">Total Regrowth</div>
                        <div className="text-lg font-semibold text-[#1F7A4C]">
                          {formatValueForCard(week.totalKg)} KG / {formatValueForCard(week.totalM2)} M2
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {week.items.map((item) => (
                        <div
                          key={`${item.id}-${item.regrowthDateYmd}-${item.grass}`}
                          className="bg-gray-50 rounded-lg p-3 text-sm"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium text-gray-900">{item.id}</span>
                            <span
                              className={`px-2 py-0.5 rounded text-xs font-medium ${
                                item.uom === 'M2'
                                  ? 'bg-blue-100 text-blue-700'
                                  : 'bg-green-100 text-green-700'
                              }`}
                            >
                              {item.uom}
                            </span>
                          </div>
                          <div className="space-y-1 text-xs text-gray-600">
                            <div>{item.grass}</div>
                            <div>{item.farm}</div>
                            <div className="font-medium text-gray-900">
                              {formatValueForCard(item.quantity)} {item.uom}
                            </div>
                            <div className="text-blue-600">
                              Regrowth in {item.daysUntilRegrowth} days
                            </div>
                            <div className="text-gray-500">
                              Date: {item.regrowthDateYmd} | Week {item.weekNoInYear}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Harvest History */}
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Recent Harvest History</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                        ID
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                        Farm
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                        Grass Type
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                        UOM
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                        Harvested
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                        Regrowth Ready Date
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                        Quantity
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {harvestStatusRows.slice(0, 30).map((harvest) => (
                      <tr key={`${harvest.id}-${harvest.farm}-${harvest.grassType}`} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {harvest.id}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {harvest.farm}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {harvest.grassType}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span
                            className={`px-2 py-1 rounded text-xs font-medium ${
                              harvest.harvestType === 'm2'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-green-100 text-green-700'
                            }`}
                          >
                            {harvest.harvestType.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {harvest.harvestDate ? new Date(harvest.harvestDate).toLocaleDateString() : "—"}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {harvest.readyDate ? new Date(harvest.readyDate).toLocaleDateString() : "—"}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {formatValueForCard(harvest.quantity)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {harvest.statusType === "ready" ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                              <CheckCircle className="w-3 h-3" />
                              Ready
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                              <Clock className="w-3 h-3" />
                              {harvest.statusLabel}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
