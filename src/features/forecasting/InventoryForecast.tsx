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

/** Cập nhật isReady / daysUntilReady theo ngày tham chiếu (không phải chỉ “hôm nay”). */
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

/**
 * Neo 6 tháng forecast: khi có range harvest thì lấy `to`, không có `to` thì `from`, không chọn range thì hôm nay.
 */
function forecastAnchorDateFromHarvestRange(range: {
  from?: string;
  to?: string;
}): Date {
  const fallback = new Date();
  if (range.to) {
    const d = parseISO(range.to);
    return isValid(d) ? d : fallback;
  }
  if (range.from) {
    const d = parseISO(range.from);
    return isValid(d) ? d : fallback;
  }
  return fallback;
}

function generateForecast(
  grassTypeList: string[],
  harvestHistory: ForecastHarvestRow[],
  anchorDate: Date,
): Array<Record<string, string | number>> {
  const forecast: Array<Record<string, string | number>> = [];

  for (let month = 0; month <= 6; month++) {
    const forecastDate = new Date(anchorDate);
    forecastDate.setMonth(forecastDate.getMonth() + month);
    const dateStr = forecastDate.toISOString().split("T")[0];

    const entry: Record<string, string | number> = {
      date: dateStr,
      month: forecastDate.toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
      }),
    };

    grassTypeList.forEach((grass) => {
      const availableHarvests = harvestHistory.filter(
        (h) => h.grassType === grass && new Date(h.readyDate) <= forecastDate,
      );
      entry[grass] = availableHarvests.reduce((sum, h) => sum + h.quantity, 0);
    });

    forecast.push(entry);
  }

  return forecast;
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
  const [selectedFarm, setSelectedFarm] = useState<string | null>(null);
  const [selectedGrass, setSelectedGrass] = useState<string | null>(null);
  const [selectedCountryId, setSelectedCountryId] = useState<string | null>(null);
  const [harvestDateRange, setHarvestDateRange] = useState<{
    from?: string;
    to?: string;
  }>(() => getDefaultHarvestRange());
  const [viewMode, setViewMode] = useState<"current" | "forecast" | "timeline">(
    "current",
  );

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

  /** Chỉ đổi khi đổi năm trong picker — tránh refetch khi chỉ thu hẹp tháng (client lọc overlap). */
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
        country_id: selectedCountryId ?? undefined,
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
  }, [harvestYearForApi, selectedCountryId]);

  const regrowthDaysPreview = useMemo(
    () => mapApiHarvestRawToRegrowthDays(apiHarvestRaw),
    [apiHarvestRaw],
  );

  const monthlyAvailabilityFromRaw = useMemo(
    () => computeMonthlyAvailabilityFromRaw(apiHarvestRaw),
    [apiHarvestRaw],
  );
  const monthlyAvailabilityByProduct = useMemo(
    () =>
      computeMonthlyAvailabilityByProductFromRaw(apiHarvestRaw, {
        fromYmd: harvestDateRange.from,
        toYmd: harvestDateRange.to,
      }),
    [apiHarvestRaw, harvestDateRange.from, harvestDateRange.to],
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
    () => rowsToMockHarvestRows(apiHarvestRaw),
    [apiHarvestRaw],
  );

  const mockHarvestHistory = useMemo(
    () => generateHarvestHistory(grassTypeList, farmList),
    [grassTypeList, farmList],
  );

  // console.log(mockHarvestHistory);

  /** API dùng `actual_harvest_date_from`/`to` với CASE actual|estimated như PHP; khi lỗi API fallback demo. */
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
  /** Ngày xem “đã ready chưa”: phụ thuộc harvest (from–to) — nếu khoảng đã qua, xem tại ngày cuối khoảng. */
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

  /** Gộp loại cỏ từ API và từ danh mục sản phẩm (để biểu đồ không bỏ sót tên cỏ mới). */
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
        if (selectedFarm && h.farm !== selectedFarm) return false;
        if (selectedGrass && h.grassType !== selectedGrass) return false;
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
    [harvestHistoryAtRef, selectedFarm, selectedGrass, harvestDateRange],
  );

  const regrowthRowsInSelectedRange = useMemo(() => {
    return regrowthPreviewWithGrass.filter((r) => {
      // Regrowth/Growing chỉ lấy những dòng có chính ngày regrowth nằm trong khoảng đang chọn.
      if (!ymdInRange(r.regrowthDateYmd, harvestDateRange)) {
        return false;
      }
      if (selectedFarm && normalizeText(r.farm_name) !== normalizeText(selectedFarm)) {
        return false;
      }
      if (
        selectedGrass &&
        normalizeText(r.grassLabel) !== normalizeText(selectedGrass)
      ) {
        return false;
      }
      return true;
    });
  }, [regrowthPreviewWithGrass, harvestDateRange, selectedFarm, selectedGrass]);

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
      // Available = regrowth đã tới ngày ready tại mốc inventoryRefYmd.
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
  /** Farm / grass lists cho UI: khi đang lọc thì chỉ hiển thị cột hoặc thẻ tương ứng. */
  const displayFarmList = useMemo(
    () => (selectedFarm ? [selectedFarm] : farmListForCharts),
    [selectedFarm, farmListForCharts],
  );
  const displayGrassList = useMemo(
    () => (selectedGrass ? [selectedGrass] : grassTypeListForCharts),
    [selectedGrass, grassTypeListForCharts],
  );

  const inventory = useMemo(
    () =>
      calculateInventory(farmListForCharts, grassTypeListForCharts, filteredHistory),
    [farmListForCharts, grassTypeListForCharts, filteredHistory],
  );

  const forecastAnchor = useMemo(
    () => forecastAnchorDateFromHarvestRange(harvestDateRange),
    [harvestDateRange],
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

  const forecast = useMemo(
    () =>
      generateForecast(grassTypeListForCharts, filteredHistory, forecastAnchor),
    [grassTypeListForCharts, filteredHistory, forecastAnchor],
  );

  const timeline = useMemo(
    () => generateTimeline(filteredHistory),
    [filteredHistory],
  );

  // Calculate stats (ưu tiên nguồn đã tính chuỗi tháng: computeMonthlyAvailabilityFromRaw)
  const totalAvailable =
    monthlyAvailabilityAtRef
      ? monthlyAvailabilityAtRef.availableKg + monthlyAvailabilityAtRef.availableM2
      : filteredHistory
          .filter((h) => h.isReady)
          .reduce((sum, h) => sum + h.quantity, 0);

  const totalGrowing =
    monthlyAvailabilityAtRef
      ? monthlyAvailabilityAtRef.regrowthKg + monthlyAvailabilityAtRef.regrowthM2
      : filteredHistory
          .filter((h) => !h.isReady)
          .reduce((sum, h) => sum + h.quantity, 0);

  const readyThisWeek = filteredHistory.filter(
    (h) => !h.isReady && h.daysUntilReady <= 7
  ).length;

  const readyNextMonth = filteredHistory.filter(
    (h) => !h.isReady && h.daysUntilReady <= 30
  ).length;

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

        {/* View mode + harvest date range — áp dụng cho toàn bộ số liệu và biểu đồ phía dưới */}
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
              6-Month Forecast
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
              Harvest date (from – to)
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

        {/* Key Stats — filteredHistory: overlap [harvest, ready] với range; ready từ công thức regrowth */}
        <div className="mb-8">
          <p className="mb-2 text-xs text-gray-500">
            Harvest range lọc các lô có cửa sổ gặt → regrowth xong giao với khoảng đó. Trạng thái
            Available / Growing tính tại{" "}
            <span className="font-medium text-gray-700">{inventoryRefYmd}</span>
            {harvestDateRange.to && harvestDateRange.to < todayYmd
              ? " (cuối khoảng đã chọn)"
              : ""}
            . Số lượng theo UOM trên từng lô (kg hoặc m²).
          </p>
          {harvestRangeSummary ? (
            <p className="mb-3 text-xs text-gray-500">
              Farm / grass filters áp dụng thêm cho các số dưới đây.
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Available Now</span>
              <CheckCircle className="w-5 h-5 text-green-600" />
            </div>
            <div className="text-3xl font-semibold text-gray-900">
              {(totalAvailable / 1000).toFixed(0)}K
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Ready before {inventoryRefYmd} (theo ngày regrowth xong từ công thức)
            </p>
          </div>

          <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Growing</span>
              <Sprout className="w-5 h-5 text-yellow-600" />
            </div>
            <div className="text-3xl font-semibold text-gray-900">
              {(totalGrowing / 1000).toFixed(0)}K
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Chưa ready tại {inventoryRefYmd} — ready date từ kg/m²→ngày hoặc M2 +tháng
            </p>
          </div>

          <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Ready This Week</span>
              <Clock className="w-5 h-5 text-blue-600" />
            </div>
            <div className="text-3xl font-semibold text-gray-900">{readyThisWeek}</div>
            <p className="text-xs text-gray-500 mt-1">fields becoming available</p>
          </div>

          <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Next 30 Days</span>
              <TrendingUp className="w-5 h-5 text-purple-600" />
            </div>
            <div className="text-3xl font-semibold text-gray-900">{readyNextMonth}</div>
            <p className="text-xs text-gray-500 mt-1">fields maturing soon</p>
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
              <select
                value={selectedCountryId || ""}
                onChange={(e) => setSelectedCountryId(e.target.value || null)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#1F7A4C]"
              >
                <option value="">All countries</option>
                {countryOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Filter by Farm
              </label>
              <select
                value={selectedFarm || ''}
                onChange={(e) => setSelectedFarm(e.target.value || null)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1F7A4C]"
              >
                <option value="">All Farms</option>
                {farmList.map((farm) => (
                  <option key={farm} value={farm}>
                    {farm}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Filter by Grass Type
              </label>
              <select
                value={selectedGrass || ''}
                onChange={(e) => setSelectedGrass(e.target.value || null)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1F7A4C]"
              >
                <option value="">All Grass Types</option>
                {grassTypeList.map((grass) => (
                  <option key={grass} value={grass}>
                    {grass}
                  </option>
                ))}
              </select>
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
                  data={displayGrassList.map((grass) => {
                    const available = filteredHistory
                      .filter((h) => h.grassType === grass && h.isReady)
                      .reduce((sum, h) => sum + h.quantity, 0);
                    return { grass, available };
                  })}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="grass" tick={{ fontSize: 11 }} angle={-45} textAnchor="end" height={80} />
                  <YAxis tick={{ fontSize: 12 }} domain={["auto", "auto"]} />
                  <ReferenceLine y={0} stroke="#6B7280" strokeDasharray="4 4" />
                  <Tooltip
                    formatter={(value: number) =>
                      `${value.toLocaleString()} (plan qty, mixed UOM)`
                    }
                    contentStyle={{
                      backgroundColor: 'white',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                    }}
                  />
                  <Bar dataKey="available" fill="#16A34A" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Growing Inventory — tổng quantity các lô chưa ready tại inventoryRefYmd; ready từ công thức regrowth */}
            <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-1">
                Growing Inventory (In Regrowth)
              </h2>
              <p className="mb-4 text-xs text-gray-500">
                Tổng số lượng theo plan (kg hoặc m²) của các lô vẫn trong regrowth tại{" "}
                <span className="font-medium text-gray-700">{inventoryRefYmd}</span>, sau khi
                lọc theo harvest range (from–to) ở trên. Ngày regrowth xong lấy từ công thức
                (kg/m² → ngày; M2 cộng tháng).
              </p>
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
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b text-gray-500">
                      <th className="py-2 pr-3">farm_id</th>
                      <th className="py-2 pr-3">farm</th>
                      <th className="py-2 pr-3">available_kg</th>
                      <th className="py-2">available_m2</th>
                    </tr>
                  </thead>
                  <tbody>
                    {availableByFarmRows.map((row) => (
                      <tr
                        key={`${row.farmId ?? "unknown"}-${row.farmName}`}
                        className="border-b border-gray-100"
                      >
                        <td className="py-2 pr-3 font-mono">
                          {row.farmId ?? "—"}
                        </td>
                        <td className="py-2 pr-3">{row.farmName}</td>
                        <td className="py-2 pr-3 tabular-nums">
                          {Math.round(row.availableKg).toLocaleString()}
                        </td>
                        <td className="py-2 tabular-nums">
                          {Math.round(row.availableM2).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm lg:col-span-2">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Product Monthly Availability
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b text-gray-500">
                      <th className="py-2 pr-3">month</th>
                      <th className="py-2 pr-3">product_id</th>
                      <th className="py-2 pr-3">grass</th>
                      <th className="py-2 pr-3">starting (kg/m2)</th>
                      <th className="py-2 pr-3">regrowth (kg/m2)</th>
                      <th className="py-2 pr-3">harvest (kg/m2)</th>
                      <th className="py-2">available (kg/m2)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyAvailabilityByProductInSelectedRange.map((row) => (
                      <tr
                        key={`${row.productId}-${row.monthKey}`}
                        className="border-b border-gray-100"
                      >
                        <td className="py-2 pr-3 font-mono">{row.monthKey}</td>
                        <td className="py-2 pr-3 font-mono">{row.productId}</td>
                        <td className="py-2 pr-3">
                          {grassNameById.get(row.productId) ?? "—"}
                        </td>
                        <td className="py-2 pr-3 tabular-nums">
                          {Math.round(row.startingKg).toLocaleString()} / {Math.round(row.startingM2).toLocaleString()}
                        </td>
                        <td className="py-2 pr-3 tabular-nums">
                          {Math.round(row.regrowthKg).toLocaleString()} / {Math.round(row.regrowthM2).toLocaleString()}
                        </td>
                        <td className="py-2 pr-3 tabular-nums">
                          {Math.round(row.harvestedKg).toLocaleString()} / {Math.round(row.harvestedM2).toLocaleString()}
                        </td>
                        <td className="py-2 tabular-nums">
                          {Math.round(row.availableKg).toLocaleString()} / {Math.round(row.availableM2).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Forecast View */}
        {viewMode === 'forecast' && (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-1">
                6-Month Availability Forecast
              </h2>
              <p className="mb-4 text-sm text-gray-600">
                Monthly buckets start from{" "}
                <span className="font-medium text-gray-800">
                  {format(forecastAnchor, "MMM d, yyyy")}
                </span>
                {harvestDateRange.from || harvestDateRange.to
                  ? " (from your harvest date range)."
                  : " (today when no date range is selected)."}
              </p>
              <ResponsiveContainer width="100%" height={400}>
                <AreaChart data={forecast}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(value: number) => `${value.toLocaleString()} sq. ft.`}
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
                              {(qty(grass) / 1000).toFixed(1)}K
                            </td>
                          ))}
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            {(total / 1000).toFixed(1)}K
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
                {timeline.slice(0, 12).map((week: any, index) => (
                  <div
                    key={index}
                    className="border border-gray-200 rounded-lg p-4 hover:border-[#1F7A4C] transition-colors"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Clock className="w-5 h-5 text-blue-600" />
                        <span className="font-medium text-gray-900">
                          Week {Math.floor(week.weekStart / 7) + 1}
                        </span>
                        <span className="text-sm text-gray-600">
                          ({week.weekStart}-{week.weekEnd} days)
                        </span>
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-gray-600">Total Available</div>
                        <div className="text-lg font-semibold text-[#1F7A4C]">
                          {(week.totalQuantity / 1000).toFixed(1)}K sq. ft.
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {week.harvests.map((harvest: any) => (
                        <div
                          key={harvest.id}
                          className="bg-gray-50 rounded-lg p-3 text-sm"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium text-gray-900">{harvest.id}</span>
                            <span
                              className={`px-2 py-0.5 rounded text-xs font-medium ${
                                harvest.harvestType === 'sod'
                                  ? 'bg-blue-100 text-blue-700'
                                  : 'bg-green-100 text-green-700'
                              }`}
                            >
                              {harvest.harvestType.toUpperCase()}
                            </span>
                          </div>
                          <div className="space-y-1 text-xs text-gray-600">
                            <div>{harvest.grassType}</div>
                            <div>{harvest.farm}</div>
                            <div className="font-medium text-gray-900">
                              {harvest.quantity.toLocaleString()} sq. ft.
                            </div>
                            <div className="text-blue-600">
                              Ready in {harvest.daysUntilReady} days
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
                        Type
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                        Harvested
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                        Ready Date
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
                    {filteredHistory.slice(0, 15).map((harvest) => (
                      <tr key={harvest.id} className="hover:bg-gray-50">
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
                              harvest.harvestType === 'sod'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-green-100 text-green-700'
                            }`}
                          >
                            {harvest.harvestType.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {new Date(harvest.harvestDate).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {new Date(harvest.readyDate).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {harvest.quantity.toLocaleString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {harvest.isReady ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                              <CheckCircle className="w-3 h-3" />
                              Ready
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                              <Clock className="w-3 h-3" />
                              {harvest.daysUntilReady}d
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
