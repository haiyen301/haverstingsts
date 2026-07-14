"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
} from "react";
import { AlignLeft, ArrowDown, HelpCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import type { TranslationValues } from "use-intl";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceDot,
} from "recharts";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import type { ZoneConfigurationRow } from "@/features/admin/api/adminApi";
import type { ForecastHarvestRow } from "@/features/forecasting/forecastingTypes";
import type { RegrowthReferenceConfig } from "@/features/forecasting/forecastingRegrowth";
import {
  sumFarmProductCapacityCapsFromZoneConfigAtDate,
} from "@/features/forecasting/inventoryRegrowthCalculator";
import type { RollingDailyAvailableDay } from "@/features/forecasting/forecastDbTypes";
import {
  buildInventoryAvailableHintModel,
  filterBalanceOverridesForSeries,
  formatInventoryBalanceOverrideLine,
  InventoryAvailableBalanceSummary,
  type InventoryAvailableHintModel,
} from "@/features/forecasting/inventoryAvailableHint";
import {
  forecastLogicalPlanRowId,
  forecastZoneKeyFromRow,
  getRegrowthDateFromHarvest,
  farmProductHasMappedZoneConfigAtYmd,
  mergeZoneCapacityMapsAtDate,
  sumConfiguredZoneCapKgForFarmProduct,
  zoneConfigIsActiveAtYmd,
} from "@/features/forecasting/inventoryRegrowthCalculator";
import {
  applyLatestZoneMaxKgToForecastRows,
  DEFAULT_FALLBACK_INVENTORY_KG_PER_M2,
  FORECAST_NOZONE_ZONE,
  isForecastExcludedZone,
  forecastHarvestRowEffectiveM2,
  forecastHarvestRowInventoryKg,
  kgPerM2ByNormalizedZoneForFarmProduct,
} from "@/features/forecasting/forecastingInventoryConversion";
import {
  computeRegrowthAllocationForFarmProductDate,
  type ZoneRegrowthBreakdown,
} from "@/features/forecasting/regrowthAllocation";
import {
  buildGrassCatalogById,
  collectHiddenGrassIdsForCatalogOnDateRange,
  filterActiveGrassRows,
  isGrassProductVisibleInCatalogOnDate,
  isGrassRowActive,
  zoneIdToLabelResolved,
} from "@/shared/lib/harvestReferenceData";
import { useGrassFilterByFarm } from "@/shared/hooks/useGrassFilterByFarm";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import {
  normalizeInventoryBalanceDateYmd,
  type InventoryAvailableOverrideEntry,
} from "@/shared/store/inventoryAvailableOverrideStore";
import {
  ForecastEventBadge,
  ForecastEventTile,
  ForecastEventTitleRich,
  ForecastRegrowthDayGroup,
  forecastHarvestEventSubtitle,
  forecastUpcomingGrassDetail,
} from "@/features/forecasting/ForecastEventTile";
import { RegrowthPlanDetailsTable } from "@/features/forecasting/RegrowthPlanDetailsTable";
import {
  buildRegrowthPlanDetailRows,
  regrowthEventKey,
} from "@/features/forecasting/regrowthEventPlanDetails";
import { ForecastPageHeaderActions } from "@/features/forecasting/ForecastPageHeaderActions";
import { useForecastSnapshot } from "@/features/forecasting/useForecastSnapshot";
import { getForecastToday } from "@/features/forecasting/forecastDateUtils";
import {
  rowQualifiesAsUpcomingHarvest,
  upcomingHarvestDateYmdFromRow,
} from "@/shared/lib/harvestPlanDates";
import { useDebouncedValue } from "@/features/forecasting/useDebouncedValue";
import { useForecastDbSeries } from "@/features/forecasting/useForecastDbSeries";
import { MultiSelect } from "@/shared/ui/multi-select";
import { cn } from "@/lib/utils";
import { bgSurfaceFilter } from "@/shared/lib/surfaceFilter";
import {
  parseCsvList,
  toCsvList,
  useSyncedFarmMultiSelect,
} from "@/shared/hooks/useSyncedFarmMultiSelect";
import { useFarmUserScope } from "@/shared/store/farmUserScope";
import { ForecastHorizonStrip } from "@/features/forecasting/ForecastHorizonStrip";
import {
  DashboardKpiDateFilter,
  KPI_DATE_PRESET_FORECAST,
} from "@/features/dashboard/DashboardKpiDateFilter";
import {
  type KpiDeliveryDateFilter,
  forecastSpanMonthsFromFilter,
  kpiDateRangeFromFilter,
} from "@/shared/lib/dashboardKpiProjectFilters";

type ForecastPoint = {
  date: string;
  available: number;
  max: number;
  overrideCount: number;
  hint: InventoryAvailableHintModel;
};

type SeriesPoint = {
  date: string;
  hint?: InventoryAvailableHintModel;
  [key: string]: string | number | InventoryAvailableHintModel | undefined;
};

function seriesOverrideCountKey(key: string): string {
  return `__override_count__${key}`;
}

function resolveGrassSeriesLabel(
  productId: number,
  productGrassMeta: ReadonlyMap<number, string>,
  grassNameById: ReadonlyMap<number, string>,
): string {
  const label =
    productGrassMeta.get(productId) ??
    grassNameById.get(productId) ??
    "";
  const trimmed = label.trim();
  return trimmed || `Grass ${productId}`;
}

function collectBreakdownGrassProductIds(args: {
  rollingDailyByFarmProduct: Map<string, Map<string, RollingDailyAvailableDay>>;
  zoneConfigs: ZoneConfigurationRow[];
  activeGrasses: unknown[];
  farmProductFilter: (farmId: number, productId: number) => boolean;
  hiddenGrassIdSet: ReadonlySet<string>;
}): Set<number> {
  const productIds = new Set<number>();
  const todayYmd = ymdFromDate(getForecastToday());

  const tryAdd = (farmId: number, productId: number) => {
    if (farmId <= 0 || productId <= 0) return;
    if (args.hiddenGrassIdSet.has(String(productId))) return;
    if (!args.farmProductFilter(farmId, productId)) return;
    if (!farmProductHasMappedZoneConfigAtYmd(args.zoneConfigs, farmId, productId, todayYmd)) {
      return;
    }
    productIds.add(productId);
  };

  for (const fpKey of args.rollingDailyByFarmProduct.keys()) {
    const [farmIdStr, productIdStr] = fpKey.split("|");
    tryAdd(Number(farmIdStr), Number(productIdStr));
  }

  for (const row of args.zoneConfigs) {
    if (!zoneConfigIsActiveAtYmd(row, todayYmd)) continue;
    if (isForecastExcludedZone(row.zone)) continue;
    tryAdd(Number(row.farm_id), Number(row.grass_id));
  }

  for (const g of args.activeGrasses) {
    if (!g || typeof g !== "object") continue;
    const rec = g as Record<string, unknown>;
    const productId = Number(rec.id);
    if (!Number.isFinite(productId) || productId <= 0) continue;
    if (args.hiddenGrassIdSet.has(String(productId))) continue;
    for (const row of args.zoneConfigs) {
      if (!zoneConfigIsActiveAtYmd(row, todayYmd)) continue;
      if (isForecastExcludedZone(row.zone)) continue;
      if (Number(row.grass_id) !== productId) continue;
      tryAdd(Number(row.farm_id), productId);
    }
  }

  return productIds;
}

/** Keep stacked grass-type totals aligned with the main available chart after rounding. */
function reconcileStackedSeriesTotals(
  row: SeriesPoint,
  seriesKeys: string[],
  targetTotal: number,
): void {
  if (seriesKeys.length <= 1) return;

  const roundedTarget = Math.max(0, Math.round(targetTotal));
  let sum = 0;
  for (const key of seriesKeys) {
    sum += Number(row[key] ?? 0);
  }
  const delta = roundedTarget - sum;
  if (delta === 0) return;

  if (sum <= 0) {
    if (seriesKeys[0]) row[seriesKeys[0]] = roundedTarget;
    return;
  }

  let newSum = 0;
  let largestKey = seriesKeys[0]!;
  let largestVal = -1;
  for (const key of seriesKeys) {
    const scaled = Math.max(0, Math.round((Number(row[key] ?? 0) * roundedTarget) / sum));
    row[key] = scaled;
    newSum += scaled;
    if (scaled > largestVal) {
      largestVal = scaled;
      largestKey = key;
    }
  }

  const drift = roundedTarget - newSum;
  if (drift !== 0) {
    row[largestKey] = Math.max(0, Number(row[largestKey] ?? 0) + drift);
  }
}

const DEBUG_UPCOMING_FILTER = false;
const DEBUG_REGROWTH_EVENTS = false;

function mergeHarvestTypeLabels(a: string, b: string): string {
  const parts = [...a.split(" · "), ...b.split(" · ")]
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(parts)].join(" · ");
}

/** Farm label when the row has no farm name (parallel to no-zone for missing zone). */
function forecastDisplayFarmName(farm: string, emptyLabel: string): string {
  const s = String(farm ?? "").trim();
  return s || emptyLabel;
}

function zoneDisplayForRegrowthTooltip(
  rawLabel: string,
  zoneLabelFn: (id: string) => string,
  t: (key: string, values?: TranslationValues) => string,
): string {
  const s = String(rawLabel ?? "").trim();
  const low = s.toLowerCase().replace(/_/g, "-").replace(/\s+/g, " ");
  if (!s || low === FORECAST_NOZONE_ZONE || low === "no-zone" || low === "no zone") {
    return t("events.noZoneName");
  }
  return zoneLabelFn(s);
}

const GRASS_SERIES_PALETTE = [
  "hsl(152, 55%, 36%)",
  "hsl(28, 80%, 55%)",
  "hsl(210, 75%, 50%)",
  "hsl(280, 55%, 55%)",
  "hsl(345, 70%, 55%)",
  "hsl(45, 85%, 50%)",
  "hsl(180, 60%, 40%)",
  "hsl(95, 50%, 45%)",
];

const FARM_SERIES_PALETTE = [
  "hsl(210, 75%, 50%)",
  "hsl(28, 80%, 55%)",
  "hsl(280, 55%, 55%)",
  "hsl(152, 55%, 36%)",
  "hsl(345, 70%, 55%)",
  "hsl(45, 85%, 50%)",
  "hsl(180, 60%, 40%)",
  "hsl(95, 50%, 45%)",
];

function seriesPaletteColor(index: number, palette: readonly string[]): string {
  if (index < palette.length) return palette[index];
  const hue = Math.round((index * 137.508) % 360);
  return `hsl(${hue}, 55%, 45%)`;
}

function buildSeriesColorMap(
  labels: Iterable<string>,
  palette: readonly string[],
): Record<string, string> {
  const sorted = Array.from(new Set(Array.from(labels).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  );
  const map: Record<string, string> = {};
  sorted.forEach((label, i) => {
    map[label] = seriesPaletteColor(i, palette);
  });
  return map;
}

function forecastRowRefYmd(row: ForecastHarvestRow): string {
  return String(
    row.deliveryDate ?? row.estimatedHarvestDate ?? row.harvestDate ?? "",
  )
    .trim()
    .slice(0, 10);
}

/** Same label sources as breakdown `seriesKeys`, from unfiltered data so hues stay stable. */
function collectStableGrassSeriesLabels(
  rows: ForecastHarvestRow[],
  grasses: unknown[],
  zoneConfigs: ZoneConfigurationRow[],
  overridesByZone: Record<string, InventoryAvailableOverrideEntry>,
  hiddenGrassIdSet: ReadonlySet<string>,
): Set<string> {
  const labels = new Set<string>();
  for (const g of grasses) {
    if (!g || typeof g !== "object") continue;
    if (!isGrassRowActive(g)) continue;
    const rec = g as Record<string, unknown>;
    const label = String(rec.title ?? rec.name ?? "").trim();
    if (label) labels.add(label);
  }
  for (const r of rows) {
    if (hiddenGrassIdSet.has(String(r.productId))) continue;
    if (r.grassType) labels.add(r.grassType);
  }
  for (const row of zoneConfigs) {
    if (hiddenGrassIdSet.has(String(row.grass_id))) continue;
    const turf = String(row.turfgrass ?? "").trim();
    if (turf) labels.add(turf);
  }
  for (const entry of Object.values(overridesByZone)) {
    if (hiddenGrassIdSet.has(String(entry.grassId))) continue;
    const label = String(entry.turfgrass ?? "").trim();
    if (label) labels.add(label);
  }
  return labels;
}

function collectStableFarmSeriesLabels(
  rows: ForecastHarvestRow[],
  farmOptions: Array<{ value: string; label: string }>,
  zoneConfigs: ZoneConfigurationRow[],
  overridesByZone: Record<string, InventoryAvailableOverrideEntry>,
): Set<string> {
  const labels = new Set<string>();
  for (const option of farmOptions) {
    if (option.label) labels.add(option.label);
  }
  for (const r of rows) {
    if (r.farm) labels.add(r.farm);
  }
  for (const row of zoneConfigs) {
    const name = String(row.farm_name ?? "").trim();
    if (name) labels.add(name);
  }
  for (const entry of Object.values(overridesByZone)) {
    const label = String(entry.farmName ?? "").trim();
    if (label) labels.add(label);
  }
  return labels;
}

function harvestTypeLabel(
  harvestType: ForecastHarvestRow["harvestType"],
  t: (key: string) => string,
): string {
  if (harvestType === "sod_for_sprig") return t("types.sodForSprig");
  if (harvestType === "sprig") return t("types.sprig");
  return t("types.sod");
}

/** Normalize plan UOM for display (matches harvest list idea: show real unit, not always kg). */
function forecastQtyUnit(uomRaw: string | undefined): { suffix: string; kind: "kg" | "m2" | "other" } {
  const raw = String(uomRaw ?? "").trim();
  const u = raw.toLowerCase().replace(/\s/g, "").replace(/²/g, "2");
  if (u === "kg" || u === "kgs" || u === "kilogram" || u === "kilograms") {
    return { suffix: "kg", kind: "kg" };
  }
  if (
    u === "m2" ||
    u === "sqm" ||
    u === "sq.m" ||
    u === "m²" ||
    u === "squaremeter" ||
    u === "squaremeters"
  ) {
    return { suffix: "m²", kind: "m2" };
  }
  if (!raw) return { suffix: "", kind: "other" };
  return { suffix: raw, kind: "other" };
}

function formatForecastQty(qty: number, uomRaw: string | undefined): string {
  const { suffix } = forecastQtyUnit(uomRaw);
  const n = qty.toLocaleString();
  return suffix ? `${n} ${suffix}` : n;
}

function formatForecastNativeQty(qty: number, uomRaw: string): string {
  const { suffix, kind } = forecastQtyUnit(uomRaw);
  const unit = suffix || uomRaw;
  if (kind === "m2") {
    return `${qty.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit}`;
  }
  return `${Math.round(qty).toLocaleString()} ${unit}`;
}

function shouldShowForecastM2ConversionHelp(
  harvestType: ForecastHarvestRow["harvestType"] | undefined,
  sourceM2: number,
  lines: ForecastM2ConversionLine[],
): boolean {
  if (lines.length === 0 || sourceM2 <= 0) return false;
  if (harvestType === "sod_for_sprig") return false;
  return true;
}

/** Upcoming harvests: show plan magnitude (m² or kg), not converted inventory kg. */
function forecastUpcomingNativeDisplay(
  harvestType: ForecastHarvestRow["harvestType"],
  inventoryKg: number,
  sourceM2: number,
  planQuantityRaw: number,
  uomRaw?: string,
): { qty: number; uom: string } | null {
  const uomSuffix = forecastQtyUnit(uomRaw).suffix || "kg";
  if (harvestType === "sprig") {
    if (sourceM2 > 0) return { qty: sourceM2, uom: "m²" };
    const qty = planQuantityRaw > 0 ? planQuantityRaw : inventoryKg;
    return { qty, uom: uomSuffix };
  }
  if (harvestType === "sod_for_sprig") {
    const qty = planQuantityRaw > 0 ? planQuantityRaw : inventoryKg;
    return { qty, uom: "kg" };
  }
  if (harvestType === "sod") {
    if (sourceM2 > 0) return { qty: sourceM2, uom: "m²" };
    return { qty: inventoryKg, uom: "kg" };
  }
  return null;
}

function forecastSourceM2FromRow(row: ForecastHarvestRow): number {
  return forecastHarvestRowEffectiveM2(row);
}

function forecastDisplayKgFromRow(row: ForecastHarvestRow): number {
  return forecastHarvestRowInventoryKg(row);
}

function ForecastKgQuantityLabel({
  sign,
  kg,
  sourceM2,
  nativeDisplay,
  className,
  onClick,
}: {
  sign: "+" | "-";
  kg: number;
  sourceM2?: number;
  /** When set, show only the plan magnitude (e.g. m² for Sod) — conversion stays in the ? tooltip. */
  nativeDisplay?: { qty: number; uom: string } | null;
  className?: string;
  onClick?: () => void;
}) {
  const m2 = sourceM2 ?? 0;
  const content = nativeDisplay ? (
    <>
      {sign}
      {formatForecastNativeQty(nativeDisplay.qty, nativeDisplay.uom)}
    </>
  ) : (
    <>
      {sign}
      {Math.round(kg).toLocaleString()} kg
      {m2 > 0 ? ` (${m2.toLocaleString()} m²)` : ""}
    </>
  );
  if (!onClick) {
    return <span className={cn("tabular-nums", className)}>{content}</span>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "cursor-pointer tabular-nums rounded px-1 py-0.5 text-left transition-colors",
        className,
      )}
    >
      {content}
    </button>
  );
}

type ForecastM2ConversionLine = {
  zoneKey: string;
  zoneLabel: string;
  m2: number;
  kgPerM2: number;
};

function formatKgPerM2Rate(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return "0";
  const rounded = Math.round(rate * 100) / 100;
  return rounded.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function resolveRowInventoryKgPerM2(
  row: ForecastHarvestRow,
  kgPerM2ByZone: Record<string, number>,
): number {
  const zoneKey = zoneNormKeyForHarvestZoneTooltip(String(row.zone ?? ""));
  const fromConfig = kgPerM2ByZone[zoneKey];
  if (fromConfig != null && fromConfig > 0) return fromConfig;
  if (zoneKey === FORECAST_NOZONE_ZONE || !String(row.zone ?? "").trim()) {
    const zone1 =
      kgPerM2ByZone["1"] ??
      kgPerM2ByZone["zone-1"] ??
      kgPerM2ByZone["zone 1"] ??
      0;
    if (zone1 > 0) return zone1;
  }
  const m2 = forecastHarvestRowEffectiveM2(row);
  const kg = forecastHarvestRowInventoryKg(row);
  if (m2 > 0 && kg > 0) return kg / m2;
  return 0;
}

function forecastHarvestRowM2ConversionLine(
  row: ForecastHarvestRow,
  kgPerM2ByZone: Record<string, number>,
  zoneLabelFn: (z: string) => string,
  noZoneLabel: string,
): ForecastM2ConversionLine | null {
  const m2Raw = forecastHarvestRowEffectiveM2(row);
  if (m2Raw <= 0) return null;
  const kg = forecastHarvestRowInventoryKg(row);
  if (kg <= 0) return null;

  const zoneRaw = String(row.zone ?? "").trim();
  const zoneKey = zoneNormKeyForHarvestZoneTooltip(zoneRaw);
  const kgPerM2 = resolveRowInventoryKgPerM2(row, kgPerM2ByZone);
  if (kgPerM2 <= 0) return null;

  const m2 =
    row.inventoryKgFromNozoneSpread && row.inventoryKgFromNozoneSpread > 0
      ? kg / kgPerM2
      : m2Raw;

  const zoneLabel =
    zoneKey === FORECAST_NOZONE_ZONE || !zoneRaw ? noZoneLabel : zoneLabelFn(zoneRaw);

  return { zoneKey, zoneLabel, m2, kgPerM2 };
}

function regrowthFragmentM2ConversionLine(
  frag: {
    zoneKey: string;
    zoneLabel: string;
    qty: number;
    sourceM2: number;
    inventoryKgFromNozoneSpread: number;
  },
  kgPerM2ByZone: Record<string, number>,
  noZoneLabel: string,
): ForecastM2ConversionLine | null {
  const m2Raw = frag.sourceM2;
  if (m2Raw <= 0) return null;
  const kg = frag.qty;
  if (kg <= 0) return null;

  const zoneKey = zoneNormKeyForHarvestZoneTooltip(frag.zoneKey);
  let kgPerM2 = kgPerM2ByZone[zoneKey] ?? 0;
  if (kgPerM2 <= 0 && zoneKey === FORECAST_NOZONE_ZONE) {
    kgPerM2 =
      kgPerM2ByZone["1"] ??
      kgPerM2ByZone["zone-1"] ??
      kgPerM2ByZone["zone 1"] ??
      0;
  }
  if (kgPerM2 <= 0 && m2Raw > 0 && kg > 0) {
    kgPerM2 = kg / m2Raw;
  }
  if (kgPerM2 <= 0) return null;

  const m2 =
    frag.inventoryKgFromNozoneSpread > 0 ? kg / kgPerM2 : m2Raw;
  const zoneLabel =
    zoneKey === FORECAST_NOZONE_ZONE || !String(frag.zoneLabel ?? "").trim()
      ? noZoneLabel
      : frag.zoneLabel;

  return { zoneKey, zoneLabel, m2, kgPerM2 };
}

function mergeM2ConversionLines(
  lines: (ForecastM2ConversionLine | null | undefined)[],
): ForecastM2ConversionLine[] {
  const map = new Map<string, ForecastM2ConversionLine>();
  for (const line of lines) {
    if (!line) continue;
    const prev = map.get(line.zoneKey);
    if (!prev) {
      map.set(line.zoneKey, { ...line });
    } else {
      prev.m2 += line.m2;
    }
  }
  return Array.from(map.values()).sort((a, b) => a.zoneLabel.localeCompare(b.zoneLabel));
}

function buildM2ConversionLinesFromZoneSource(
  zoneSource: Record<string, { m2: number; nativeKg: number }>,
  kgPerM2ByZone: Record<string, number>,
  zoneLabelFn: (z: string) => string,
  noZoneLabel: string,
): ForecastM2ConversionLine[] {
  const lines: ForecastM2ConversionLine[] = [];
  for (const [zoneKey, src] of Object.entries(zoneSource)) {
    if (src.m2 <= 0 && src.nativeKg <= 0) continue;
    let kgPerM2 = kgPerM2ByZone[zoneKey] ?? 0;
    if (kgPerM2 <= 0 && zoneKey === FORECAST_NOZONE_ZONE) {
      kgPerM2 =
        kgPerM2ByZone["1"] ??
        kgPerM2ByZone["zone-1"] ??
        kgPerM2ByZone["zone 1"] ??
        0;
    }
    if (kgPerM2 <= 0 && src.nativeKg > 0 && src.m2 > 0) {
      kgPerM2 = src.nativeKg / src.m2;
    }
    if (kgPerM2 <= 0) continue;
    const m2 = src.m2 > 0 ? src.m2 : src.nativeKg / kgPerM2;
    const zoneLabel =
      zoneKey === FORECAST_NOZONE_ZONE ? noZoneLabel : zoneLabelFn(zoneKey);
    lines.push({ zoneKey, zoneLabel, m2, kgPerM2 });
  }
  return lines.sort((a, b) => a.zoneLabel.localeCompare(b.zoneLabel));
}

function ForecastM2ConversionHelp({
  lines,
  t,
}: {
  lines: ForecastM2ConversionLine[];
  t: (key: string, values?: TranslationValues) => string;
}) {
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCloseTimer = () => {
    if (closeTimerRef.current != null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const scheduleClose = () => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => setOpen(false), 160);
  };

  const openPanel = () => {
    clearCloseTimer();
    setOpen(true);
  };

  useEffect(() => {
    return () => {
      if (closeTimerRef.current != null) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, []);

  if (lines.length === 0) return null;

  const tooltipBody = (
    <>
      <p className="font-medium text-foreground">{t("upcoming.m2ConversionTooltipTitle")}</p>
      {lines.map((line) => (
        <p key={line.zoneKey} className="text-muted-foreground">
          {t("upcoming.m2ConversionTooltipLine", {
            zone: line.zoneLabel,
            m2: line.m2.toLocaleString(undefined, { maximumFractionDigits: 2 }),
            rate: formatKgPerM2Rate(line.kgPerM2),
            kg: Math.round(line.m2 * line.kgPerM2).toLocaleString(),
          })}
        </p>
      ))}
    </>
  );

  return (
    <Popover
      modal={false}
      open={open}
      onOpenChange={(next) => {
        if (next) openPanel();
        else {
          clearCloseTimer();
          setOpen(false);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted/30 text-muted-foreground shadow-sm transition-colors",
            "hover:border-border hover:bg-muted/60 hover:text-foreground",
            open && "border-primary/35 bg-primary/5 text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
          )}
          aria-label={t("upcoming.m2ConversionTooltipAria")}
          aria-expanded={open}
          onMouseEnter={openPanel}
          onMouseLeave={scheduleClose}
          onFocus={openPanel}
          onBlur={scheduleClose}
        >
          <HelpCircle className="h-3 w-3" strokeWidth={2} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        role="tooltip"
        side="top"
        align="end"
        sideOffset={6}
        collisionPadding={12}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onMouseEnter={openPanel}
        onMouseLeave={scheduleClose}
        className={cn(
          "z-110 w-[min(18rem,calc(100vw-2rem))] max-h-[min(70vh,22rem)] space-y-1 overflow-y-auto border-border bg-card p-2.5 text-left text-[11px] leading-snug text-card-foreground shadow-lg",
        )}
      >
        {tooltipBody}
      </PopoverContent>
    </Popover>
  );
}

function sumRegrowthTooltipSourceM2(
  zoneSource: Record<string, { m2: number; nativeKg: number }>,
): number {
  return Object.values(zoneSource).reduce((sum, z) => sum + (z.m2 > 0 ? z.m2 : 0), 0);
}

function loadTypeBadgeMeta(
  harvestType: ForecastHarvestRow["harvestType"],
  t: (key: string) => string,
): { label: string; className: string } {
  if (harvestType === "sod_for_sprig") {
    return {
      label: t("badges.sodToSprig"),
      className: "bg-primary/10 text-primary",
    };
  }
  if (harvestType === "sod") {
    return {
      label: t("badges.sod"),
      className: "bg-primary/10 text-primary",
    };
  }
  return {
    label: t("badges.sprig"),
    className: "bg-secondary/40 text-foreground",
  };
}

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

/** Normalize harvest / breakdown zone label for tooltip source map keys. */
function zoneNormKeyForHarvestZoneTooltip(raw: string): string {
  const s = String(raw ?? "").trim().toLowerCase().replace(/_/g, "-").replace(/\s+/g, " ");
  if (!s || s === "no-zone" || s === "no zone") return FORECAST_NOZONE_ZONE;
  return s;
}

function aggregateHarvestByZoneForRegrowthYmd(
  rows: ForecastHarvestRow[],
  regrowthCfg: RegrowthReferenceConfig,
  farmId: number,
  productId: number,
  regrowthYmd: string,
): Record<string, { m2: number; nativeKg: number }> {
  const out: Record<string, { m2: number; nativeKg: number }> = {};
  for (const h of rows) {
    if (h.farmId !== farmId || h.productId !== productId) continue;
    const reg = getRegrowthDateFromHarvest(h, regrowthCfg);
    if (!reg || ymdFromDate(reg) !== regrowthYmd) continue;
    const k = zoneNormKeyForHarvestZoneTooltip(String(h.zone ?? ""));
    const cur = out[k] ?? { m2: 0, nativeKg: 0 };
    const sourceM2 = forecastHarvestRowEffectiveM2(h);
    if (sourceM2 > 0) {
      cur.m2 += sourceM2;
    }
    cur.nativeKg += forecastHarvestRowInventoryKg(h);
    out[k] = cur;
  }
  return out;
}

function regrowthNoZoneInlineText(
  zoneSource: Record<string, { m2: number; nativeKg: number }>,
  nozoneInputKg: number,
  t: (key: string, values?: TranslationValues) => string,
): string | null {
  const nz = zoneSource[FORECAST_NOZONE_ZONE] ?? { m2: 0, nativeKg: 0 };
  const label = t("events.noZoneName");
  if (nz.m2 > 0) {
    const kgStr =
      nz.nativeKg > 0
        ? nz.nativeKg.toLocaleString()
        : nozoneInputKg > 0
          ? nozoneInputKg.toLocaleString()
          : "0";
    return t("events.regrowthInlineNozoneM2Kg", {
      label,
      m2: nz.m2.toLocaleString(),
      kg: kgStr,
    });
  }
  const kgVal = nz.nativeKg > 0 ? nz.nativeKg : nozoneInputKg;
  if (kgVal <= 0) return null;
  return t("events.regrowthInlineNozoneKg", { label, kg: kgVal.toLocaleString() });
}

/** Overlimit = (available day before + regrowth − harvest on regrowth day) − zone-config cap. */
function regrowthMaxOverlimitFromInventoryRoll(
  availablePrevKg: number,
  regrowthKg: number,
  harvestKg: number,
  configuredCapSumKg: number,
): { projectedKg: number; overlimitKg: number } {
  const projectedKg = Math.max(
    0,
    Math.round(availablePrevKg + regrowthKg - harvestKg),
  );
  const cap = Math.round(configuredCapSumKg);
  return { projectedKg, overlimitKg: Math.max(0, projectedKg - cap) };
}

function ymdAddDays(ymd: string, deltaDays: number): string {
  const d = parseYmdLocal(ymd);
  if (!d) return ymd;
  return ymdFromDate(addDays(d, deltaDays));
}

type RegrowthMaxBadgeHelpEv = {
  regrowthDateYmd: string;
  farmLabel: string;
  grassLabel: string;
  availablePrevKg: number;
  regrowthKg: number;
  harvestKg: number;
  configuredCapSumKg: number;
  overlimitKg: number;
};

/** MAX badge: inventory roll — prev available + regrowth − harvest vs farm+grass cap. */
function RegrowthMaxBadgeHelp({
  ev,
  t,
}: {
  ev: RegrowthMaxBadgeHelpEv;
  t: (key: string, values?: TranslationValues) => string;
}) {
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCloseTimer = () => {
    if (closeTimerRef.current != null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const scheduleClose = () => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => setOpen(false), 160);
  };

  const openPanel = () => {
    clearCloseTimer();
    setOpen(true);
  };

  useEffect(() => {
    return () => {
      if (closeTimerRef.current != null) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, []);

  const prevDateLabel = formatDayMonth(ymdAddDays(ev.regrowthDateYmd, -1));
  const regrowthDateLabel = formatDayMonth(ev.regrowthDateYmd);
  const availablePrev = Math.round(ev.availablePrevKg);
  const regrowth = Math.round(ev.regrowthKg);
  const harvest = Math.round(ev.harvestKg);
  const cap = Math.round(ev.configuredCapSumKg);
  const projected = Math.round(
    regrowthMaxOverlimitFromInventoryRoll(
      ev.availablePrevKg,
      ev.regrowthKg,
      ev.harvestKg,
      ev.configuredCapSumKg,
    ).projectedKg,
  );
  const overlimit = Math.round(ev.overlimitKg);

  const tooltipBody = (
    <>
      <p className="font-semibold text-amber-800">
        {t("events.maxTooltipOverlimit", { kg: overlimit.toLocaleString() })}
      </p>
      <p className="font-medium text-foreground">
        {t("events.maxTooltipCeiling", {
          farm: ev.farmLabel,
          grass: ev.grassLabel,
          kg: cap.toLocaleString(),
        })}
      </p>
      <p className="text-muted-foreground">
        {t("events.maxTooltipAvailablePrev", {
          date: prevDateLabel,
          kg: availablePrev.toLocaleString(),
        })}
      </p>
      <p className="text-muted-foreground">
        {t("events.maxTooltipRegrowthDay", {
          date: regrowthDateLabel,
          kg: regrowth.toLocaleString(),
        })}
      </p>
      {harvest > 0 ? (
        <p className="text-muted-foreground">
          {t("events.maxTooltipHarvestDay", {
            date: regrowthDateLabel,
            kg: harvest.toLocaleString(),
          })}
        </p>
      ) : null}
      <p className="text-muted-foreground">
        {t("events.maxTooltipProjected", { kg: projected.toLocaleString() })}
      </p>
      <div className="space-y-0.5 border-t border-border pt-1 tabular-nums text-muted-foreground">
        <p>
          {t("events.maxTooltipFormulaBalance", {
            available: availablePrev.toLocaleString(),
            regrowth: regrowth.toLocaleString(),
            harvest: harvest.toLocaleString(),
            projected: projected.toLocaleString(),
          })}
        </p>
        <p>
          {t("events.maxTooltipFormulaOverlimit", {
            projected: projected.toLocaleString(),
            cap: cap.toLocaleString(),
            overlimit: overlimit.toLocaleString(),
          })}
        </p>
      </div>
    </>
  );

  return (
    <Popover
      modal={false}
      open={open}
      onOpenChange={(next) => {
        if (next) openPanel();
        else {
          clearCloseTimer();
          setOpen(false);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="cursor-default rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 transition-colors hover:bg-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          aria-label={t("events.maxTooltipAria")}
          aria-expanded={open}
          onMouseEnter={openPanel}
          onMouseLeave={scheduleClose}
          onFocus={openPanel}
          onBlur={scheduleClose}
        >
          {t("badges.max")}
        </button>
      </PopoverTrigger>
      <PopoverContent
        role="tooltip"
        side="top"
        align="center"
        sideOffset={6}
        collisionPadding={12}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onMouseEnter={openPanel}
        onMouseLeave={scheduleClose}
        className={cn(
          "z-110 w-[min(16rem,calc(100vw-2rem))] border-border bg-card p-2.5 text-left text-[11px] leading-snug text-card-foreground shadow-lg",
        )}
      >
        {tooltipBody}
      </PopoverContent>
    </Popover>
  );
}

type RegrowthOverflowHelpEv = {
  zoneBreakdowns: ZoneRegrowthBreakdown[];
  overflowBeyondCapKg: number;
};

/** Chi tiết overflow theo từng zone (vượt cap sau khi gộp no-zone). */
function RegrowthOverflowHelp({
  ev,
  zoneLabelFn,
  t,
}: {
  ev: RegrowthOverflowHelpEv;
  zoneLabelFn: (id: string) => string;
  t: (key: string, values?: TranslationValues) => string;
}) {
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCloseTimer = () => {
    if (closeTimerRef.current != null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const scheduleClose = () => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => setOpen(false), 160);
  };

  const openPanel = () => {
    clearCloseTimer();
    setOpen(true);
  };

  useEffect(() => {
    return () => {
      if (closeTimerRef.current != null) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, []);

  const byZone = ev.zoneBreakdowns.filter((z) => z.zoneOverflowKg > 0.0005);
  const sumByZone = byZone.reduce((s, z) => s + z.zoneOverflowKg, 0);
  const otherKg = Math.max(0, ev.overflowBeyondCapKg - sumByZone);

  const tooltipBody = (
    <>
      <p className="font-medium text-foreground">
        {t("events.overflowTooltipTotal", { kg: ev.overflowBeyondCapKg.toLocaleString() })}
      </p>
      {byZone.map((z) => (
        <p key={z.zoneKey} className="text-muted-foreground">
          {t("events.overflowTooltipZoneLine", {
            zone: zoneDisplayForRegrowthTooltip(z.zoneLabel, zoneLabelFn, t),
            kg: z.zoneOverflowKg.toLocaleString(),
          })}
        </p>
      ))}
      {otherKg > 0.5 ? (
        <p className="text-muted-foreground">{t("events.overflowTooltipOther", { kg: otherKg.toLocaleString() })}</p>
      ) : null}
    </>
  );

  return (
    <Popover
      modal={false}
      open={open}
      onOpenChange={(next) => {
        if (next) openPanel();
        else {
          clearCloseTimer();
          setOpen(false);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="shrink-0 rounded-full p-0 text-red-800/85 transition-colors hover:text-red-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          aria-label={t("events.overflowTooltipAria")}
          aria-expanded={open}
          onMouseEnter={openPanel}
          onMouseLeave={scheduleClose}
          onFocus={openPanel}
          onBlur={scheduleClose}
        >
          <HelpCircle className="h-3 w-3" strokeWidth={2} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        role="tooltip"
        side="top"
        align="end"
        sideOffset={6}
        collisionPadding={12}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onMouseEnter={openPanel}
        onMouseLeave={scheduleClose}
        className={cn(
          "z-110 w-[min(18rem,calc(100vw-2rem))] max-h-[min(70vh,22rem)] space-y-1 overflow-y-auto border-border bg-card p-2.5 text-left text-[11px] leading-snug text-card-foreground shadow-lg",
        )}
      >
        {tooltipBody}
      </PopoverContent>
    </Popover>
  );
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

/** Weekly chart dates plus any manual balance dates inside the forecast window. */
type ChartUnitMode = "sprig" | "sod";

function sprigSodSegmentClass(active: boolean): string {
  return cn(
    "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
    active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
  );
}

function ChartUnitModeToggle({
  mode,
  onChange,
  kgLabel,
  m2Label,
}: {
  mode: ChartUnitMode;
  onChange: (mode: ChartUnitMode) => void;
  kgLabel: string;
  m2Label: string;
}) {
  return (
    <div className="flex shrink-0 gap-1 rounded-lg bg-muted p-0.5">
      <button
        type="button"
        onClick={() => onChange("sprig")}
        className={sprigSodSegmentClass(mode === "sprig")}
      >
        {kgLabel}
      </button>
      <button
        type="button"
        onClick={() => onChange("sod")}
        className={sprigSodSegmentClass(mode === "sod")}
      >
        {m2Label}
      </button>
    </div>
  );
}

function representativeKgPerM2ForFarmProduct(
  zoneConfigs: ZoneConfigurationRow[],
  farmId: number,
  productId: number,
): number {
  const byZone = kgPerM2ByNormalizedZoneForFarmProduct(zoneConfigs, farmId, productId);
  const preferred = byZone["1"] ?? byZone["zone-1"] ?? byZone["zone 1"];
  if (preferred && preferred > 0) return preferred;
  const rates = Object.values(byZone).filter((rate) => rate > 0);
  if (rates.length === 0) return DEFAULT_FALLBACK_INVENTORY_KG_PER_M2;
  return rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
}

function kgToChartM2(kg: number, kgPerM2: number): number {
  if (kg <= 0) return 0;
  const rate = kgPerM2 > 0 ? kgPerM2 : DEFAULT_FALLBACK_INVENTORY_KG_PER_M2;
  return Math.max(0, Math.round(kg / rate));
}

function sumZoneCapacityM2AtDate(
  zoneConfigs: ZoneConfigurationRow[],
  asOf: Date,
  farmProductFilter?: (farmId: number, productId: number) => boolean,
): number {
  const ymd = ymdFromDate(asOf);
  let sum = 0;
  for (const row of zoneConfigs) {
    if (!zoneConfigIsActiveAtYmd(row, ymd)) continue;
    if (isForecastExcludedZone(row.zone)) continue;
    const farmId = Number(row.farm_id);
    const productId = Number(row.grass_id);
    if (!Number.isFinite(farmId) || !Number.isFinite(productId) || farmId <= 0 || productId <= 0) {
      continue;
    }
    if (farmProductFilter && !farmProductFilter(farmId, productId)) continue;
    const sizeM2 = Number(row.size_m2 ?? 0);
    if (Number.isFinite(sizeM2) && sizeM2 > 0) sum += sizeM2;
  }
  return sum;
}

function collectForecastChartDateYmds(
  rangeStart: Date,
  horizonEnd: Date,
  overridesByZone: Record<string, InventoryAvailableOverrideEntry>,
  farmProductFilter: (farmId: number, productId: number) => boolean,
): string[] {
  const dates = new Set<string>();
  const start = rangeStart <= horizonEnd ? rangeStart : horizonEnd;
  const end = rangeStart <= horizonEnd ? horizonEnd : rangeStart;

  // Weekly ticks across the selected filter window (not always from "today").
  let cursor = start;
  while (cursor <= end) {
    dates.add(ymdFromDate(cursor));
    cursor = addDays(cursor, 7);
  }
  dates.add(ymdFromDate(start));
  dates.add(ymdFromDate(end));

  for (const entry of Object.values(overridesByZone)) {
    if (!farmProductFilter(entry.farmId, entry.grassId)) continue;
    const ymd = normalizeInventoryBalanceDateYmd(entry.date);
    const d = parseYmdLocal(ymd);
    if (!d || d < start || d > end) continue;
    dates.add(ymd);
  }

  return Array.from(dates).sort((a, b) => a.localeCompare(b));
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

function formatSprigRangeForReference(
  bands: RegrowthReferenceConfig["sprigBands"],
  rowIndex: number,
): string {
  const cur = bands[rowIndex];
  if (!cur) return "";
  const t = Number.isFinite(cur.thresholdKgPerM2) ? cur.thresholdKgPerM2 : 0;
  if (rowIndex === 0) return `≤ ${t} kg/m²`;

  const prev = bands[rowIndex - 1];
  if (!prev) return `≤ ${t} kg/m²`;
  const p = Number.isFinite(prev.thresholdKgPerM2) ? prev.thresholdKgPerM2 : 0;

  if (rowIndex === bands.length - 1 || cur.comparator === "GT" || cur.comparator === "GTE") {
    return `> ${p} kg/m²`;
  }
  return `${p} - ${t} kg/m²`;
}

const DEFAULT_FORECAST_DATE_FILTER: KpiDeliveryDateFilter = { preset: "next3Months" };

type InventoryForecastProps = {
  forecastDateFilter?: KpiDeliveryDateFilter;
  onForecastDateFilterChange?: (filter: KpiDeliveryDateFilter) => void;
};

export function InventoryForecast({
  forecastDateFilter: controlledForecastDateFilter,
  onForecastDateFilterChange,
}: InventoryForecastProps = {}) {
  const t = useTranslations("ForecastInventory");
  const farmZones = useHarvestingDataStore((s) => s.farmZones);
  const grasses = useHarvestingDataStore((s) => s.grasses);
  const activeGrasses = useMemo(() => filterActiveGrassRows(grasses), [grasses]);
  const grassCatalogById = useMemo(() => buildGrassCatalogById(grasses), [grasses]);
  const harvestListGrassFilter = useHarvestingDataStore((s) => s.harvestListGrassFilter);
  const setHarvestListGrassFilter = useHarvestingDataStore((s) => s.setHarvestListGrassFilter);
  const {
    forecastRows: rows,
    harvestRowsRaw,
    zoneConfigs: zoneConfigSnapshot,
    regrowthConfig,
    overridesByZone,
    isLoading: loading,
    isRefreshing,
    hasSnapshot,
    error,
  } = useForecastSnapshot();
  const [selectedRegrowthKey, setSelectedRegrowthKey] = useState<string | null>(null);
  const regrowthPlanDetailsRef = useRef<HTMLDivElement | null>(null);
  const {
    selectedFarmIds,
    selectedFarmIdSet,
    setSelectedFarmIds,
    farmOptions,
  } = useSyncedFarmMultiSelect("forecasting");
  const { scopeIds } = useFarmUserScope("forecasting");
  const [internalForecastDateFilter, setInternalForecastDateFilter] =
    useState<KpiDeliveryDateFilter>(DEFAULT_FORECAST_DATE_FILTER);
  const forecastDateFilter = controlledForecastDateFilter ?? internalForecastDateFilter;
  const setForecastDateFilter = onForecastDateFilterChange ?? setInternalForecastDateFilter;
  const forecastDateRange = useMemo(
    () => kpiDateRangeFromFilter(forecastDateFilter),
    [forecastDateFilter],
  );
  const forecastSpanMonths = useMemo(
    () => forecastSpanMonthsFromFilter(forecastDateFilter),
    [forecastDateFilter],
  );
  const hiddenGrassIdSet = useMemo(
    () =>
      collectHiddenGrassIdsForCatalogOnDateRange(
        grasses,
        forecastDateRange.start,
        forecastDateRange.end,
      ),
    [grasses, forecastDateRange.start, forecastDateRange.end],
  );
  const [showBreakdownChart, setShowBreakdownChart] = useState(false);
  const [chartUnitMode, setChartUnitMode] = useState<ChartUnitMode>("sprig");
  const chartUnitLabel = chartUnitMode === "sprig" ? "kg" : "m²";
  const debouncedFarmIds = useDebouncedValue(selectedFarmIds, 300);
  const debouncedGrassIds = useDebouncedValue(
    useMemo(() => parseCsvList(harvestListGrassFilter), [harvestListGrassFilter]),
    300,
  );
  const debouncedFarmIdSet = useMemo(
    () => new Set(debouncedFarmIds),
    [debouncedFarmIds],
  );
  const debouncedGrassIdSet = useMemo(
    () => new Set(debouncedGrassIds),
    [debouncedGrassIds],
  );

  useEffect(() => {
    if (!hasSnapshot) {
      setShowBreakdownChart(false);
      return;
    }
    const idle =
      typeof requestIdleCallback === "function"
        ? requestIdleCallback
        : (cb: () => void) => window.setTimeout(cb, 0);
    const cancel =
      typeof cancelIdleCallback === "function"
        ? cancelIdleCallback
        : (id: number) => window.clearTimeout(id);
    const id = idle(() => {
      startTransition(() => setShowBreakdownChart(true));
    });
    return () => cancel(id as number);
  }, [hasSnapshot, forecastDateFilter, debouncedFarmIds, debouncedGrassIds]);

  const zoneLabel = useCallback(
    (zoneId: string) => zoneIdToLabelResolved(zoneId, farmZones, t("events.noZoneName")),
    [farmZones, t],
  );

  const selectedGrassIds = useMemo(
    () => parseCsvList(harvestListGrassFilter),
    [harvestListGrassFilter],
  );
  const selectedGrassIdSet = useMemo(
    () => new Set(selectedGrassIds),
    [selectedGrassIds],
  );
  const setSelectedGrassIds = (ids: string[]) =>
    setHarvestListGrassFilter(toCsvList(ids));

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

  const { grassFilterOptions: rawGrassFilterOptions } = useGrassFilterByFarm({
    grasses: activeGrasses,
    zoneConfigs: zoneConfigSnapshot,
    selectedFarmIds,
    selectedGrassIds,
    onSelectedGrassIdsChange: setSelectedGrassIds,
    catalogMode: "sales_window",
    refYmds: [forecastDateRange.start, forecastDateRange.end],
  });

  const grassFilterOptions = useMemo(
    () => rawGrassFilterOptions.filter((o) => !hiddenGrassIdSet.has(o.value)),
    [rawGrassFilterOptions, hiddenGrassIdSet],
  );

  const rowsWithLiveZoneCaps = useMemo(
    () => applyLatestZoneMaxKgToForecastRows(rows, zoneConfigSnapshot),
    [rows, zoneConfigSnapshot],
  );

  const filteredRows = useMemo(
    () =>
      rowsWithLiveZoneCaps.filter((r) => {
        const farmIdStr = String(r.farmId);
        const productIdStr = String(r.productId);
        if (hiddenGrassIdSet.has(productIdStr)) return false;
        if (
          !isGrassProductVisibleInCatalogOnDate(
            r.productId,
            grassCatalogById,
            forecastRowRefYmd(r),
          )
        ) {
          return false;
        }
        if (debouncedFarmIds.length > 0 && !debouncedFarmIdSet.has(farmIdStr)) return false;
        if (debouncedGrassIds.length > 0 && !debouncedGrassIdSet.has(productIdStr)) return false;
        return true;
      }),
    [
      rowsWithLiveZoneCaps,
      hiddenGrassIdSet,
      grassCatalogById,
      debouncedFarmIds,
      debouncedFarmIds,
      debouncedFarmIdSet,
      debouncedGrassIds,
      debouncedGrassIdSet,
    ],
  );

  const farmProductFilter = useCallback(
    (farmId: number, productId: number) => {
      if (hiddenGrassIdSet.has(String(productId))) return false;
      if (scopeIds?.length && !scopeIds.includes(String(farmId))) return false;
      if (debouncedFarmIds.length > 0 && !debouncedFarmIdSet.has(String(farmId))) return false;
      if (debouncedGrassIds.length > 0 && !debouncedGrassIdSet.has(String(productId))) return false;
      return true;
    },
    [hiddenGrassIdSet, scopeIds, debouncedFarmIds, debouncedFarmIdSet, debouncedGrassIds, debouncedGrassIdSet],
  );

  const forecastHorizonStart = useMemo(() => {
    const startYmd = forecastDateRange.start;
    return parseYmdLocal(startYmd) ?? getForecastToday();
  }, [forecastDateRange.start]);

  const forecastHorizonEnd = useMemo(() => {
    const endYmd = forecastDateRange.end;
    return parseYmdLocal(endYmd) ?? addMonths(getForecastToday(), forecastSpanMonths);
  }, [forecastDateRange.end, forecastSpanMonths]);

  /** Chart series: inventory_daily_snapshots aggregate (v14 — engine writes past Cap C / future Cap A). */
  const dbSeries = useForecastDbSeries({
    dateFrom: forecastDateRange.start,
    dateTo: forecastDateRange.end,
    farmIds: debouncedFarmIds,
    grassIds: debouncedGrassIds,
    scopeModule: "forecasting",
    permissionScopeFarmIds: scopeIds ?? [],
    enabled: hasSnapshot,
  });

  const dailySeriesResult = dbSeries.result;
  const regrowthStatsByDate = dbSeries.regrowthStatsByDate;
  const chartDbReady = dbSeries.hasData && !dbSeries.isLoading;
  const chartDbPending = dbSeries.isLoading || dbSeries.isStale;

  const rollingDailyAvailable = dailySeriesResult.aggregate;

  const rollingByDate = useMemo(
    () =>
      new Map<string, RollingDailyAvailableDay>(
        rollingDailyAvailable.map((day: RollingDailyAvailableDay) => [day.date, day]),
      ),
    [rollingDailyAvailable],
  );

  const rollingDailyByFarmProduct = dailySeriesResult.byFarmProduct;

  const collectFarmProductGroupKeys = useCallback(
    (
      rollingByFarmProduct: Map<string, Map<string, RollingDailyAvailableDay>>,
      productFilter: (farmId: number, productId: number) => boolean,
    ) => {
      const todayYmd = ymdFromDate(getForecastToday());
      const keys = new Set<string>();

      const tryAdd = (farmId: number, productId: number) => {
        if (farmId <= 0 || productId <= 0) return;
        if (!productFilter(farmId, productId)) return;
        if (!farmProductHasMappedZoneConfigAtYmd(zoneConfigSnapshot, farmId, productId, todayYmd)) {
          return;
        }
        keys.add(`${farmId}|${productId}`);
      };

      for (const fpKey of rollingByFarmProduct.keys()) {
        const [farmIdStr, productIdStr] = fpKey.split("|");
        tryAdd(Number(farmIdStr), Number(productIdStr));
      }
      for (const row of zoneConfigSnapshot) {
        if (!zoneConfigIsActiveAtYmd(row, todayYmd)) continue;
        if (isForecastExcludedZone(row.zone)) continue;
        tryAdd(Number(row.farm_id), Number(row.grass_id));
      }
      return Array.from(keys).sort((a, b) => a.localeCompare(b));
    },
    [zoneConfigSnapshot],
  );

  const breakdownMode: "grass" | "farm" =
    selectedGrassIds.length > 0 ? "farm" : "grass";

  const farmProductGroupKeys = useMemo(() => {
    const todayYmd = ymdFromDate(getForecastToday());
    const keys = new Set(
      collectFarmProductGroupKeys(rollingDailyByFarmProduct, farmProductFilter),
    );
    for (const row of filteredRows) {
      if (isForecastExcludedZone(row.zone)) continue;
      if (!farmProductFilter(row.farmId, row.productId)) continue;
      if (!farmProductHasMappedZoneConfigAtYmd(zoneConfigSnapshot, row.farmId, row.productId, todayYmd)) {
        continue;
      }
      keys.add(`${row.farmId}|${row.productId}`);
    }
    return Array.from(keys).sort((a, b) => a.localeCompare(b));
  }, [
    collectFarmProductGroupKeys,
    rollingDailyByFarmProduct,
    filteredRows,
    zoneConfigSnapshot,
    farmProductFilter,
  ]);

  const farmProductKgPerM2 = useMemo(() => {
    const out = new Map<string, number>();
    for (const fpKey of farmProductGroupKeys) {
      const [farmIdStr, productIdStr] = fpKey.split("|");
      out.set(
        fpKey,
        representativeKgPerM2ForFarmProduct(
          zoneConfigSnapshot,
          Number(farmIdStr),
          Number(productIdStr),
        ),
      );
    }
    return out;
  }, [farmProductGroupKeys, zoneConfigSnapshot]);

  const totalMaxToday = useMemo(
    () =>
      Math.round(
        sumFarmProductCapacityCapsFromZoneConfigAtDate(
          zoneConfigSnapshot,
          getForecastToday(),
          farmProductFilter,
        ),
      ),
    [zoneConfigSnapshot, farmProductFilter],
  );

  const totalMaxForChart = useMemo(() => {
    if (chartUnitMode === "sprig") return totalMaxToday;
    return Math.round(
      sumZoneCapacityM2AtDate(zoneConfigSnapshot, getForecastToday(), farmProductFilter),
    );
  }, [chartUnitMode, totalMaxToday, zoneConfigSnapshot, farmProductFilter]);

  const zoneSeriesMeta = useMemo(() => {
    const out = new Map<string, string>();
    for (const r of filteredRows) {
      const zoneKey = forecastZoneKeyFromRow(r);
      if (out.has(zoneKey)) continue;
      out.set(zoneKey, r.grassType);
    }
    for (const entry of Object.values(overridesByZone)) {
      if (hiddenGrassIdSet.has(String(entry.grassId))) continue;
      if (debouncedFarmIds.length > 0 && !debouncedFarmIdSet.has(String(entry.farmId))) continue;
      if (selectedGrassIds.length > 0 && !selectedGrassIdSet.has(String(entry.grassId))) continue;
      if (!entry.zoneKey || !entry.turfgrass) continue;
      if (!out.has(entry.zoneKey)) out.set(entry.zoneKey, entry.turfgrass);
    }
    return out;
  }, [filteredRows, overridesByZone, hiddenGrassIdSet, selectedFarmIds, selectedFarmIdSet, selectedGrassIds, selectedGrassIdSet]);

  const zoneFarmMeta = useMemo(() => {
    const out = new Map<string, string>();
    for (const r of filteredRows) {
      const zoneKey = forecastZoneKeyFromRow(r);
      if (!out.has(zoneKey)) out.set(zoneKey, r.farm);
    }
    for (const entry of Object.values(overridesByZone)) {
      if (hiddenGrassIdSet.has(String(entry.grassId))) continue;
      if (debouncedFarmIds.length > 0 && !debouncedFarmIdSet.has(String(entry.farmId))) continue;
      if (selectedGrassIds.length > 0 && !selectedGrassIdSet.has(String(entry.grassId))) continue;
      if (!entry.zoneKey || !entry.farmName) continue;
      if (!out.has(entry.zoneKey)) out.set(entry.zoneKey, entry.farmName);
    }
    return out;
  }, [filteredRows, overridesByZone, hiddenGrassIdSet, selectedFarmIds, selectedFarmIdSet, selectedGrassIds, selectedGrassIdSet]);

  const selectedGrassSummary = useMemo(() => {
    if (selectedGrassIds.length === 0) return "";
    const labels = grassFilterOptions
      .filter((o) => selectedGrassIdSet.has(o.value))
      .map((o) => o.label);
    if (labels.length > 0) return labels.join(", ");
    return selectedGrassIds.join(", ");
  }, [selectedGrassIds, selectedGrassIdSet, grassFilterOptions]);

  const farmNameById = useMemo(() => {
    const out = new Map<number, string>();
    for (const option of farmFilterOptions) {
      const farmId = Number(option.value);
      if (Number.isFinite(farmId) && farmId > 0 && option.label) {
        out.set(farmId, option.label);
      }
    }
    for (const r of filteredRows) {
      if (r.farmId > 0 && r.farm) out.set(r.farmId, r.farm);
    }
    for (const entry of Object.values(overridesByZone)) {
      if (entry.farmId > 0 && entry.farmName) out.set(entry.farmId, entry.farmName.trim());
    }
    const todayYmd = ymdFromDate(getForecastToday());
    for (const row of zoneConfigSnapshot) {
      if (!zoneConfigIsActiveAtYmd(row, todayYmd)) continue;
      const farmId = Number(row.farm_id);
      if (!Number.isFinite(farmId) || farmId <= 0 || out.has(farmId)) continue;
      const name = String(row.farm_name ?? "").trim();
      if (name) out.set(farmId, name);
    }
    return out;
  }, [farmFilterOptions, filteredRows, overridesByZone, zoneConfigSnapshot]);

  const farmProductFarmMeta = useMemo(() => {
    const out = new Map<string, string>();
    for (const r of filteredRows) {
      const k = `${r.farmId}|${r.productId}`;
      if (!out.has(k) && r.farm) out.set(k, r.farm);
    }
    for (const fpKey of farmProductGroupKeys) {
      const farmId = Number(fpKey.split("|")[0] ?? 0);
      const name = farmNameById.get(farmId);
      if (name) out.set(fpKey, name);
    }
    return out;
  }, [filteredRows, farmProductGroupKeys, farmNameById]);

  const grassNameById = useMemo(() => {
    const out = new Map<number, string>();
    for (const option of grassFilterOptions) {
      const grassId = Number(option.value);
      if (Number.isFinite(grassId) && grassId > 0 && option.label) {
        out.set(grassId, option.label);
      }
    }
    for (const g of activeGrasses) {
      if (!g || typeof g !== "object") continue;
      const rec = g as Record<string, unknown>;
      const grassId = Number(rec.id);
      const label = String(rec.title ?? rec.name ?? "").trim();
      if (Number.isFinite(grassId) && grassId > 0 && label) out.set(grassId, label);
    }
    const todayYmd = ymdFromDate(getForecastToday());
    for (const row of zoneConfigSnapshot) {
      if (!zoneConfigIsActiveAtYmd(row, todayYmd)) continue;
      if (isForecastExcludedZone(row.zone)) continue;
      if (hiddenGrassIdSet.has(String(row.grass_id))) continue;
      const grassId = Number(row.grass_id);
      if (!Number.isFinite(grassId) || grassId <= 0 || out.has(grassId)) continue;
      const turf = String(row.turfgrass ?? "").trim();
      if (turf) out.set(grassId, turf);
    }
    for (const r of filteredRows) {
      if (r.productId > 0 && r.grassType) out.set(r.productId, r.grassType);
    }
    for (const entry of Object.values(overridesByZone)) {
      if (hiddenGrassIdSet.has(String(entry.grassId))) continue;
      if (entry.grassId > 0 && entry.turfgrass) out.set(entry.grassId, entry.turfgrass.trim());
    }
    return out;
  }, [grassFilterOptions, activeGrasses, hiddenGrassIdSet, zoneConfigSnapshot, filteredRows, overridesByZone]);

  /** Grass labels for breakdown chart — zone-config + catalog first (same as grass filter). */
  const productGrassMeta = useMemo(() => {
    const out = new Map<number, string>();
    for (const [grassId, label] of grassNameById) {
      out.set(grassId, label);
    }
    for (const fpKey of farmProductGroupKeys) {
      const productId = Number(fpKey.split("|")[1] ?? 0);
      const label = grassNameById.get(productId);
      if (productId > 0 && label) out.set(productId, label);
    }
    return out;
  }, [grassNameById, farmProductGroupKeys]);



  const forecastData = useMemo<ForecastPoint[]>(() => {
    const today = getForecastToday();
    const chartDates = collectForecastChartDateYmds(
      forecastHorizonStart,
      forecastHorizonEnd,
      overridesByZone,
      farmProductFilter,
    );
    const hintFilter = {
      selectedFarmIds,
      selectedFarmIdSet,
      selectedGrassIds,
      selectedGrassIdSet,
      zoneLabel,
      grassNameById,
      farmNameById,
    };

    return chartDates.map((dateStr) => {
      const forecastDate = parseYmdLocal(dateStr) ?? today;
      const rolling = rollingByDate.get(dateStr);
      const totalMax = Math.round(
        sumFarmProductCapacityCapsFromZoneConfigAtDate(
          zoneConfigSnapshot,
          forecastDate,
          farmProductFilter,
        ),
      );
      let available = Math.max(0, Math.round(rolling?.availableKg ?? 0));
      let max = Math.max(0, totalMax);
      if (chartUnitMode === "sod") {
        available = 0;
        for (const fpKey of farmProductGroupKeys) {
          const day = rollingDailyByFarmProduct.get(fpKey)?.get(dateStr);
          if (!day) continue;
          available += kgToChartM2(
            day.availableKg,
            farmProductKgPerM2.get(fpKey) ?? DEFAULT_FALLBACK_INVENTORY_KG_PER_M2,
          );
        }
        max = Math.round(sumZoneCapacityM2AtDate(zoneConfigSnapshot, forecastDate, farmProductFilter));
      }
      const hint = buildInventoryAvailableHintModel({
        available,
        previousAvailable: Math.max(0, Math.round(rolling?.previousAvailableKg ?? 0)),
        regrowthKg: Math.max(0, Math.round(rolling?.regrowthKg ?? 0)),
        harvestKg: Math.max(0, Math.round(rolling?.harvestKg ?? 0)),
        calculatedAvailable: Math.max(
          0,
          Math.round(rolling?.rawAvailableKg ?? rolling?.availableKg ?? 0),
        ),
        dateYmd: dateStr,
        overridesByZone,
        filter: hintFilter,
      });

      return {
        date: dateStr,
        available,
        max,
        overrideCount: hint.balanceOverrides.length,
        hint,
      };
    });
  }, [
    forecastHorizonStart,
    forecastHorizonEnd,
    rollingByDate,
    rollingDailyByFarmProduct,
    farmProductGroupKeys,
    farmProductKgPerM2,
    chartUnitMode,
    zoneConfigSnapshot,
    farmProductFilter,
    overridesByZone,
    selectedFarmIds,
    selectedFarmIdSet,
    selectedGrassIds,
    selectedGrassIdSet,
    zoneLabel,
    grassNameById,
    farmNameById,
  ]);

  const hintsByDate = useMemo(
    () => new Map(forecastData.map((point) => [point.date, point.hint] as const)),
    [forecastData],
  );

  /** When breakdown collapses to one series, mirror the main chart (aggregate rolling basis). */
  const mainAvailableByDate = useMemo(
    () => new Map(forecastData.map((point) => [point.date, point.available] as const)),
    [forecastData],
  );

  const maxAvailableForChart = useMemo(
    () => forecastData.reduce((m, p) => Math.max(m, p.available), 0),
    [forecastData],
  );

  const yAxisMaxForAvailable = useMemo(() => {
    if (maxAvailableForChart <= 0) return 500;
    const padded = maxAvailableForChart * 1.2;
    return Math.max(500, Math.ceil(padded / 100) * 100);
  }, [maxAvailableForChart]);

  const showMaxCapacityBand = useMemo(
    () => totalMaxForChart > 0 && totalMaxForChart <= yAxisMaxForAvailable * 5,
    [totalMaxForChart, yAxisMaxForAvailable],
  );

  const hasManualOverridesInForecast = useMemo(
    () => forecastData.some((point) => point.overrideCount > 0),
    [forecastData],
  );

  const breakdownGrassProductIds = useMemo(
    () =>
      collectBreakdownGrassProductIds({
        rollingDailyByFarmProduct,
        zoneConfigs: zoneConfigSnapshot,
        activeGrasses,
        farmProductFilter,
        hiddenGrassIdSet,
      }),
    [
      rollingDailyByFarmProduct,
      zoneConfigSnapshot,
      activeGrasses,
      farmProductFilter,
      hiddenGrassIdSet,
    ],
  );

  const seriesKeys = useMemo(() => {
    if (breakdownMode === "farm") {
      const set = new Set<string>();
      for (const fpKey of farmProductGroupKeys) {
        const farmId = Number(fpKey.split("|")[0] ?? 0);
        const label = farmProductFarmMeta.get(fpKey) ?? farmNameById.get(farmId);
        if (label) set.add(label);
      }
      for (const r of filteredRows) {
        if (r.farm) set.add(r.farm);
      }
      for (const entry of Object.values(overridesByZone)) {
        if (hiddenGrassIdSet.has(String(entry.grassId))) continue;
        if (debouncedFarmIds.length > 0 && !debouncedFarmIdSet.has(String(entry.farmId))) continue;
        if (selectedGrassIds.length > 0 && !selectedGrassIdSet.has(String(entry.grassId))) continue;
        const label =
          String(entry.farmName ?? "").trim() || farmNameById.get(entry.farmId) || "";
        if (label) set.add(label);
      }
      return Array.from(set).sort((a, b) => a.localeCompare(b));
    }
    const set = new Set<string>();
    for (const productId of breakdownGrassProductIds) {
      set.add(resolveGrassSeriesLabel(productId, productGrassMeta, grassNameById));
    }
    for (const entry of Object.values(overridesByZone)) {
      if (hiddenGrassIdSet.has(String(entry.grassId))) continue;
      if (debouncedFarmIds.length > 0 && !debouncedFarmIdSet.has(String(entry.farmId))) continue;
      if (selectedGrassIds.length > 0 && !selectedGrassIdSet.has(String(entry.grassId))) continue;
      set.add(resolveGrassSeriesLabel(entry.grassId, productGrassMeta, grassNameById));
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [
    filteredRows,
    breakdownMode,
    farmProductGroupKeys,
    farmProductFarmMeta,
    farmNameById,
    breakdownGrassProductIds,
    productGrassMeta,
    grassNameById,
    overridesByZone,
    hiddenGrassIdSet,
    selectedFarmIds,
    selectedFarmIdSet,
    selectedGrassIds,
    selectedGrassIdSet,
  ]);

  const forecastBySeries = useMemo<SeriesPoint[]>(() => {
    const chartDates = collectForecastChartDateYmds(
      forecastHorizonStart,
      forecastHorizonEnd,
      overridesByZone,
      farmProductFilter,
    );
    const points: SeriesPoint[] = [];

    for (const dateStr of chartDates) {
      const row: SeriesPoint = {
        date: dateStr,
        hint: hintsByDate.get(dateStr),
      };
      const overrideYmd = dateStr;

      if (seriesKeys.length === 1) {
        row[seriesKeys[0]!] = Math.max(
          0,
          Math.round(mainAvailableByDate.get(dateStr) ?? 0),
        );
      } else {
        for (const fpKey of rollingDailyByFarmProduct.keys()) {
          const [farmIdStr, productIdStr] = fpKey.split("|");
          const farmId = Number(farmIdStr);
          const productId = Number(productIdStr);
          if (!Number.isFinite(farmId) || !Number.isFinite(productId)) continue;
          if (!farmProductFilter(farmId, productId)) continue;

          const day = rollingDailyByFarmProduct.get(fpKey)?.get(dateStr);
          if (!day) continue;
          const seriesKey =
            breakdownMode === "farm"
              ? farmProductFarmMeta.get(fpKey) ??
                farmNameById.get(farmId) ??
                String(farmId)
              : resolveGrassSeriesLabel(productId, productGrassMeta, grassNameById);
          const qtyKg = day.availableKg;
          const qty =
            chartUnitMode === "sod"
              ? kgToChartM2(
                  qtyKg,
                  farmProductKgPerM2.get(fpKey) ?? DEFAULT_FALLBACK_INVENTORY_KG_PER_M2,
                )
              : qtyKg;
          row[seriesKey] = Number(row[seriesKey] ?? 0) + qty;
        }
      }

      for (const entry of Object.values(overridesByZone)) {
        if (hiddenGrassIdSet.has(String(entry.grassId))) continue;
        if (debouncedFarmIds.length > 0 && !debouncedFarmIdSet.has(String(entry.farmId))) continue;
        if (selectedGrassIds.length > 0 && !selectedGrassIdSet.has(String(entry.grassId))) continue;
        if (normalizeInventoryBalanceDateYmd(entry.date) !== overrideYmd) continue;
        const fpKey = `${entry.farmId}|${entry.grassId}`;
        let seriesKey: string | undefined;
        if (breakdownMode === "farm") {
          seriesKey =
            farmProductFarmMeta.get(fpKey) ||
            String(entry.farmName ?? "").trim() ||
            farmNameById.get(entry.farmId);
        } else {
          seriesKey = resolveGrassSeriesLabel(entry.grassId, productGrassMeta, grassNameById);
        }
        if (!seriesKey) continue;
        row[seriesOverrideCountKey(seriesKey)] =
          Number(row[seriesOverrideCountKey(seriesKey)] ?? 0) + 1;
      }

      for (const key of seriesKeys) {
        row[key] = Math.max(0, Math.round(Number(row[key] ?? 0)));
        row[seriesOverrideCountKey(key)] = Math.max(
          0,
          Math.round(Number(row[seriesOverrideCountKey(key)] ?? 0)),
        );
      }

      if (seriesKeys.length > 1) {
        reconcileStackedSeriesTotals(
          row,
          seriesKeys,
          mainAvailableByDate.get(dateStr) ?? 0,
        );
      }

      points.push(row);
    }

    return points;
  }, [
    forecastHorizonStart,
    forecastHorizonEnd,
    rollingDailyByFarmProduct,
    farmProductKgPerM2,
    chartUnitMode,
    seriesKeys,
    breakdownMode,
    productGrassMeta,
    farmProductFarmMeta,
    overridesByZone,
    farmProductFilter,
    hintsByDate,
    mainAvailableByDate,
    grassNameById,
    farmNameById,
    hiddenGrassIdSet,
    selectedFarmIds,
    selectedFarmIdSet,
    selectedGrassIds,
    selectedGrassIdSet,
  ]);

  const hasManualOverridesInSeriesForecast = useMemo(
    () =>
      forecastBySeries.some((point) =>
        seriesKeys.some((key) => Number(point[seriesOverrideCountKey(key)] ?? 0) > 0),
      ),
    [forecastBySeries, seriesKeys],
  );

  const upcomingHarvests = useMemo(() => {
    const start = forecastHorizonStart;
    const end = forecastHorizonEnd;
    const result = filteredRows
      .filter((h) => {
        if (!rowQualifiesAsUpcomingHarvest(h)) return false;

        const normalized = upcomingHarvestDateYmdFromRow(h);
        if (!normalized) return false;
        const d = parseYmdLocal(normalized);
        if (!d) {
          // if (DEBUG_UPCOMING_FILTER) {
          //   console.log("[forecast][upcoming-filter] reject invalid date", {
          //     id: h.id,
          //     harvestDate: h.harvestDate,
          //     normalized,
          //   });
          // }
          return false;
        }
        const inRange = d >= start && d <= end;
        if (DEBUG_UPCOMING_FILTER) {
          // console.log(
          //   inRange
          //     ? "[forecast][upcoming-filter] pass"
          //     : "[forecast][upcoming-filter] reject out of range",
          //   {
          //     id: h.id,
          //     harvestDate: h.harvestDate,
          //     normalized,
          //     parsed: ymdFromDate(d),
          //     today: ymdFromDate(today),
          //     end: ymdFromDate(end),
          //   },
          // );
        }
        return inRange;
      })
      .map((h) => {
        const kgPerM2ByZone = kgPerM2ByNormalizedZoneForFarmProduct(
          zoneConfigSnapshot,
          h.farmId,
          h.productId,
        );
        const m2ConversionLine = forecastHarvestRowM2ConversionLine(
          h,
          kgPerM2ByZone,
          zoneLabel,
          t("events.noZoneName"),
        );
        const upcomingDate = upcomingHarvestDateYmdFromRow(h) ?? normalizeYmd(h.harvestDate);
        return {
        planId: forecastLogicalPlanRowId(h.id),
        id: h.id,
        date: upcomingDate,
        farm: h.farm,
        grass: h.grassType,
        zone: String(h.zone ?? "").trim(),
        project: h.project ?? "",
        customer: h.customer ?? "",
        qty: forecastDisplayKgFromRow(h),
        sourceM2: forecastSourceM2FromRow(h),
        planQuantityRaw: h.planQuantityRaw,
        m2ConversionLine,
        uom: h.uom ?? "kg",
        inventoryIsCapped: h.inventoryIsCapped,
        harvestType: h.harvestType,
        type: harvestTypeLabel(h.harvestType, t),
      };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    const upcomingByPlan = new Map<
      string,
      {
        planId: string;
        id: string;
        date: string;
        farm: string;
        grass: string;
        zoneIdsSeen: Set<string>;
        zoneIdsOrder: string[];
        project: string;
        customer: string;
        qty: number;
        sourceM2: number;
        planQuantityRaw: number;
        m2ConversionLines: ForecastM2ConversionLine[];
        uom: string;
        inventoryIsCapped: boolean;
        harvestType: (typeof filteredRows)[number]["harvestType"];
        type: string;
      }
    >();
    for (const row of result) {
      const k = `${row.planId}|${row.date}`;
      const prev = upcomingByPlan.get(k);
      if (!prev) {
        const zoneIdsSeen = new Set<string>();
        const zoneIdsOrder: string[] = [];
        const z0 = row.zone.trim();
        if (z0) {
          zoneIdsSeen.add(z0.toLowerCase());
          zoneIdsOrder.push(z0);
        }
        upcomingByPlan.set(k, {
          planId: row.planId,
          id: row.planId,
          date: row.date,
          farm: row.farm,
          grass: row.grass,
          zoneIdsSeen,
          zoneIdsOrder,
          project: row.project,
          customer: row.customer,
          qty: row.qty,
          sourceM2: row.sourceM2,
          planQuantityRaw: row.planQuantityRaw,
          m2ConversionLines: row.m2ConversionLine ? [row.m2ConversionLine] : [],
          uom: row.uom,
          inventoryIsCapped: row.inventoryIsCapped,
          harvestType: row.harvestType,
          type: row.type,
        });
      } else {
        prev.qty += row.qty;
        prev.sourceM2 += row.sourceM2;
        if (row.m2ConversionLine) prev.m2ConversionLines.push(row.m2ConversionLine);
        prev.inventoryIsCapped = prev.inventoryIsCapped || row.inventoryIsCapped;
        const z = row.zone.trim();
        if (z) {
          const lk = z.toLowerCase();
          if (!prev.zoneIdsSeen.has(lk)) {
            prev.zoneIdsSeen.add(lk);
            prev.zoneIdsOrder.push(z);
          }
        }
        if (!prev.project && row.project) prev.project = row.project;
        if (!prev.customer && row.customer) prev.customer = row.customer;
      }
    }

    const mergedUpcoming = Array.from(upcomingByPlan.values())
      .map((agg) => {
        const zones = agg.zoneIdsOrder;
        const nZones = zones.length;
        const zoneLabelOut =
          nZones <= 1 ? zoneLabel(zones[0] ?? "") : t("upcoming.multiZoneZones", { count: nZones });
        return {
          id: agg.id,
          date: agg.date,
          farm: agg.farm,
          grass: agg.grass,
          zone: zoneLabelOut,
          project: agg.project,
          customer: agg.customer,
          qty: agg.qty,
          sourceM2: agg.sourceM2,
          planQuantityRaw: agg.planQuantityRaw,
          m2ConversionLines: mergeM2ConversionLines(agg.m2ConversionLines),
          uom: agg.uom,
          inventoryIsCapped: agg.inventoryIsCapped,
          harvestType: agg.harvestType,
          type: agg.type,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    if (DEBUG_UPCOMING_FILTER) {
      // console.log("[forecast][upcoming-filter] summary", {
      //   filteredRowsCount: filteredRows.length,
      //   upcomingCount: result.length,
      //   today: ymdFromDate(today),
      //   end: ymdFromDate(end),
      // });
      // console.table(
      //   result.map((r) => ({
      //     id: r.id,
      //     harvestDate:
      //       filteredRows.find((h) => h.id === r.id)?.harvestDate ?? "",
      //     date: r.date,
      //     farm: r.farm,
      //     grass: r.grass,
      //     qty: r.qty,
      //     type: r.type,
      //   })),
      // );
    }
    return mergedUpcoming;
  }, [filteredRows, forecastHorizonStart, forecastHorizonEnd, t, zoneLabel, zoneConfigSnapshot]);

  const upcomingHarvestTotalKg = useMemo(
    () => upcomingHarvests.reduce((sum, h) => sum + h.qty, 0),
    [upcomingHarvests],
  );

  const upcomingTotalsSummary = useMemo(() => {
    if (upcomingHarvestTotalKg <= 0) return "";
    return t("upcoming.summaryKg", {
      quantity: Math.ceil(upcomingHarvestTotalKg).toLocaleString(),
    });
  }, [upcomingHarvestTotalKg, t]);

  const regrowthEvents = useMemo(() => {
    const today = getForecastToday();
    const start = forecastHorizonStart;
    const end = forecastHorizonEnd;
    const candidates = filteredRows
      .map((h) => {
        const regrowDateObj = getRegrowthDateFromHarvest(h, regrowthConfig);
        if (!regrowDateObj) return null;
        return {
          planId: forecastLogicalPlanRowId(h.id),
          id: h.id,
          farmId: h.farmId,
          productId: h.productId,
          harvestDate: h.harvestDate,
          dateObj: regrowDateObj,
          date: ymdFromDate(regrowDateObj),
          farm: h.farm,
          grass: h.grassType,
          qty: forecastDisplayKgFromRow(h),
          planQuantityRaw: h.planQuantityRaw,
          sourceM2: forecastSourceM2FromRow(h),
          uom: h.uom ?? "kg",
          harvestType: h.harvestType,
          type: harvestTypeLabel(h.harvestType, t),
          zoneKey: forecastZoneKeyFromRow(h),
          zoneLabel: zoneLabel(String(h.zone ?? "").trim()),
          sourceWasCapped: h.inventoryIsCapped,
          inventoryKgFromNozoneSpread: Math.max(
            0,
            typeof h.inventoryKgFromNozoneSpread === "number" &&
              Number.isFinite(h.inventoryKgFromNozoneSpread)
              ? h.inventoryKgFromNozoneSpread
              : 0,
          ),
        };
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => {
        const da = a.dateObj.getTime() - b.dateObj.getTime();
        if (da !== 0) return da;
        return a.id.localeCompare(b.id);
      });

    type RegrowthFinalLine = {
      planId: string;
      /** `ForecastHarvestRow.id` (có thể là `1615~z0` khi tách zone). */
      forecastRowId: string;
      farmId: number;
      productId: number;
      harvestDate: string;
      date: string;
      farm: string;
      grass: string;
      qty: number;
      planQuantityRaw: number;
      sourceM2: number;
      uom: string;
      harvestType: ForecastHarvestRow["harvestType"];
      type: string;
      inventoryIsCapped: boolean;
      zoneLabel: string;
      zoneKey: string;
      inventoryKgFromNozoneSpread: number;
    };

    const finalEvents: RegrowthFinalLine[] = [];

    for (const ev of candidates) {
      // Same window as charts + upcoming harvests: filter range (never before today).
      if (ev.dateObj < start || ev.dateObj > end) continue;
      if (ev.dateObj <= today) continue;

      finalEvents.push({
        planId: ev.planId,
        forecastRowId: ev.id,
        farmId: ev.farmId,
        productId: ev.productId,
        harvestDate: ev.harvestDate,
        date: ev.date,
        farm: ev.farm,
        grass: ev.grass,
        qty: ev.qty,
        planQuantityRaw: ev.planQuantityRaw,
        sourceM2: ev.sourceM2,
        uom: ev.uom,
        harvestType: ev.harvestType,
        type: ev.type,
        inventoryIsCapped: ev.sourceWasCapped,
        zoneLabel: ev.zoneLabel,
        zoneKey: ev.zoneKey,
        inventoryKgFromNozoneSpread: ev.inventoryKgFromNozoneSpread,
      });
    }

    const groups = new Map<string, RegrowthFinalLine[]>();
    for (const ev of finalEvents) {
      const k = `${ev.farmId}|${ev.productId}|${ev.date}`;
      const arr = groups.get(k) ?? [];
      arr.push(ev);
      groups.set(k, arr);
    }
    const mergedRegrowthList = [...groups.values()]
      .map((frags) => {
        const first = frags[0]!;
        const maxByZone = mergeZoneCapacityMapsAtDate(
          filteredRows,
          zoneConfigSnapshot,
          first.date,
        );
        const alloc = computeRegrowthAllocationForFarmProductDate({
          farmId: first.farmId,
          productId: first.productId,
          maxByZone,
          fragments: frags.map((f) => ({
            zoneKey: f.zoneKey,
            zoneLabel: f.zoneLabel,
            qty: f.qty,
            inventoryKgFromNozoneSpread: f.inventoryKgFromNozoneSpread,
          })),
        });
        const capSum = sumConfiguredZoneCapKgForFarmProduct(maxByZone, first.farmId, first.productId);

        let harvestDate = first.harvestDate;
        const planIds: string[] = [];
        const sourceForecastRowIds = frags.map((f) => f.forecastRowId);
        let mergedType = first.type;
        let planQuantityRaw = 0;
        for (const f of frags) {
          if (f.harvestDate && harvestDate && f.harvestDate < harvestDate) harvestDate = f.harvestDate;
          if (!planIds.includes(f.planId)) planIds.push(f.planId);
          mergedType = mergeHarvestTypeLabels(mergedType, f.type);
          planQuantityRaw += f.planQuantityRaw;
        }

        const zoneSlotLabels: string[] = [];
        const seenZ = new Set<string>();
        const zoneSlotDedupeKey = (raw: string) => {
          const s = raw.trim().toLowerCase();
          if (!s || s === "nozone" || s === "no-zone" || s === "no zone") return "__nozone__";
          return s;
        };
        const pushZone = (z: string) => {
          const s = z.trim();
          if (!s) return;
          const dk = zoneSlotDedupeKey(s);
          if (seenZ.has(dk)) return;
          seenZ.add(dk);
          zoneSlotLabels.push(zoneLabel(s));
        };
        for (const f of frags) pushZone(f.zoneLabel);
        for (const z of alloc.zoneBreakdowns) {
          if (z.capKg > 0 || z.grossZonedKg > 0 || z.nozoneFillKg > 0) pushZone(z.zoneLabel);
        }

        const inventoryIsCapped =
          frags.some((f) => f.inventoryIsCapped) ||
          alloc.overflowUncreditedKg > 0 ||
          alloc.zoneBreakdowns.some((z) => z.zoneOverflowKg > 0);

        const regrowthTooltipZoneSource = aggregateHarvestByZoneForRegrowthYmd(
          filteredRows,
          regrowthConfig,
          first.farmId,
          first.productId,
          first.date,
        );

        const regrowthTooltipKgPerM2ByZone = kgPerM2ByNormalizedZoneForFarmProduct(
          zoneConfigSnapshot,
          first.farmId,
          first.productId,
        );

        const fpKey = `${first.farmId}|${first.productId}`;
        const rollingDay = rollingDailyByFarmProduct.get(fpKey)?.get(first.date);
        const availablePrevKg = Math.round(rollingDay?.previousAvailableKg ?? 0);
        const rollingRegrowthKg = Math.round(
          rollingDay?.regrowthKg ?? alloc.totalCreditedMappedKg,
        );
        const rollingHarvestKg = Math.round(rollingDay?.harvestKg ?? 0);
        const { overlimitKg: maxOverlimitKg } = regrowthMaxOverlimitFromInventoryRoll(
          availablePrevKg,
          rollingRegrowthKg,
          rollingHarvestKg,
          capSum,
        );

        return {
          ...alloc,
          harvestDate,
          date: first.date,
          farmId: first.farmId,
          productId: first.productId,
          farm: first.farm,
          grass: first.grass,
          uom: first.uom,
          harvestType: first.harvestType,
          planQuantityRaw,
          type: mergedType,
          inventoryIsCapped,
          configuredCapSumKg: capSum,
          configuredZoneCount: alloc.configuredZoneCount,
          planIds,
          /** Mỗi dòng forecast trong nhóm (debug: so với `planIds` nếu thiếu plan DB). */
          sourceForecastRowIds,
          totalGrossKg: alloc.totalGrossKg,
          primaryDisplayKg: rollingRegrowthKg > 0 ? rollingRegrowthKg : alloc.totalCreditedMappedKg,
          overflowBeyondCapKg:
            rollingRegrowthKg <= 0 && alloc.totalGrossKg > 0
              ? Math.max(alloc.overflowUncreditedKg, alloc.totalGrossKg)
              : alloc.overflowUncreditedKg,
          regrowthOverlimitDayKg: regrowthStatsByDate.get(first.date)?.overlimit_kg ?? 0,
          regrowthGrossDayKg: regrowthStatsByDate.get(first.date)?.gross_kg ?? 0,
          maxOverlimitKg,
          maxAvailablePrevKg: availablePrevKg,
          maxRegrowthDayKg: rollingRegrowthKg,
          maxHarvestDayKg: rollingHarvestKg,
          zoneSlotLabels,
          fragments: frags,
          regrowthTooltipZoneSource,
          sourceM2: sumRegrowthTooltipSourceM2(regrowthTooltipZoneSource),
          regrowthTooltipKgPerM2ByZone,
          m2ConversionLines: buildM2ConversionLinesFromZoneSource(
            regrowthTooltipZoneSource,
            regrowthTooltipKgPerM2ByZone,
            zoneLabel,
            t("events.noZoneName"),
          ),
        };
      })
      .sort((a, b) => {
        const d = a.date.localeCompare(b.date);
        if (d !== 0) return d;
        return a.harvestDate.localeCompare(b.harvestDate);
      });

    if (DEBUG_REGROWTH_EVENTS) {
      console.log("[forecast][regrowth-events] summary", {
        filteredRowsCount: filteredRows.length,
        finalCountAfterSlice: mergedRegrowthList.length,
      });
      // Same order as UI list (sorted by regrowth date, then sliced top 15).
      console.table(
        mergedRegrowthList.map((ev, idx) => ({
          order: idx + 1,
          harvestDate: ev.harvestDate,
          regrowthDate: ev.date,
          totalGross: ev.totalGrossKg,
          primaryDisplayKg: ev.primaryDisplayKg,
          overflowBeyondCapKg: ev.overflowBeyondCapKg,
          nozoneInput: ev.nozoneInputKg,
          nozoneRemain: ev.nozoneRemainingKg,
          uom: ev.uom,
          farm: ev.farm,
          grass: ev.grass,
          type: ev.type,
          zones: ev.zoneSlotLabels.join(","),
          capSum: ev.configuredCapSumKg,
          planIds: ev.planIds.join(","),
        })),
      );
    }
    return mergedRegrowthList;
  }, [
    filteredRows,
    rollingDailyByFarmProduct,
    forecastHorizonStart,
    forecastHorizonEnd,
    regrowthConfig,
    t,
    zoneConfigSnapshot,
    zoneLabel,
    regrowthStatsByDate,
  ]);

  const selectedRegrowthEvent = useMemo(() => {
    if (!selectedRegrowthKey) return null;
    return (
      regrowthEvents.find(
        (ev) => regrowthEventKey(ev.farmId, ev.productId, ev.date) === selectedRegrowthKey,
      ) ?? null
    );
  }, [regrowthEvents, selectedRegrowthKey]);

  const regrowthByDate = useMemo(() => {
    type RegrowthDayFragment = {
      lineId: string;
      eventKey: string;
      ev: (typeof regrowthEvents)[number];
      frag: (typeof regrowthEvents)[number]["fragments"][number];
      isLastFragmentInEvent: boolean;
    };
    const byDate = new Map<string, RegrowthDayFragment[]>();
    for (const ev of regrowthEvents) {
      const eventKey = regrowthEventKey(ev.farmId, ev.productId, ev.date);
      const fragments =
        ev.fragments.length > 0
          ? ev.fragments
          : [
              {
                forecastRowId: eventKey,
                farm: ev.farm,
                grass: ev.grass,
                qty: ev.primaryDisplayKg,
                planQuantityRaw: ev.planQuantityRaw,
                sourceM2: ev.sourceM2,
                uom: ev.uom,
                harvestType: ev.harvestType,
                type: ev.type,
                zoneLabel: "",
                planId: "",
                farmId: ev.farmId,
                productId: ev.productId,
                harvestDate: ev.harvestDate,
                date: ev.date,
                inventoryIsCapped: ev.inventoryIsCapped,
                zoneKey: "",
                inventoryKgFromNozoneSpread: 0,
              },
            ];
      fragments.forEach((frag, fragIdx) => {
        const arr = byDate.get(ev.date) ?? [];
        arr.push({
          lineId: `${eventKey}|${frag.forecastRowId ?? fragIdx}`,
          eventKey,
          ev,
          frag,
          isLastFragmentInEvent: fragIdx === fragments.length - 1,
        });
        byDate.set(ev.date, arr);
      });
    }
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [regrowthEvents]);

  const regrowthPlanDetailRows = useMemo(() => {
    if (!selectedRegrowthEvent) return [];
    return buildRegrowthPlanDetailRows(
      selectedRegrowthEvent.planIds,
      harvestRowsRaw,
      zoneLabel,
    );
  }, [selectedRegrowthEvent, harvestRowsRaw, zoneLabel]);

  useEffect(() => {
    setSelectedRegrowthKey(null);
  }, [debouncedFarmIds, debouncedGrassIds, forecastDateFilter]);

  useEffect(() => {
    if (!selectedRegrowthKey || regrowthPlanDetailRows.length === 0) return;
    const id = requestAnimationFrame(() => {
      regrowthPlanDetailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(id);
  }, [selectedRegrowthKey, regrowthPlanDetailRows.length]);

  /** Stable colors from full dataset so hues do not shift when filters change (matches Harvesting Portal). */
  const grassColors = useMemo(
    () =>
      buildSeriesColorMap(
        collectStableGrassSeriesLabels(
          rows,
          activeGrasses,
          zoneConfigSnapshot,
          overridesByZone,
          hiddenGrassIdSet,
        ),
        GRASS_SERIES_PALETTE,
      ),
    [rows, activeGrasses, zoneConfigSnapshot, overridesByZone, hiddenGrassIdSet],
  );

  const farmColors = useMemo(
    () =>
      buildSeriesColorMap(
        collectStableFarmSeriesLabels(rows, farmFilterOptions, zoneConfigSnapshot, overridesByZone),
        FARM_SERIES_PALETTE,
      ),
    [rows, farmFilterOptions, zoneConfigSnapshot, overridesByZone],
  );

  const seriesColor = (key: string) =>
    (breakdownMode === "farm" ? farmColors[key] : grassColors[key]) ?? GRASS_SERIES_PALETTE[0];

  const filterTriggerIcon = (
    <>
      <AlignLeft className="h-3.5 w-3.5 shrink-0" />
      <ArrowDown className="h-3.5 w-3.5 shrink-0" />
    </>
  );
  const multiSelectBaseClass =
    "min-w-[140px] max-w-[180px] rounded-md border border-input text-sm hover:bg-btnhover/40";

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold">{t("title")}</h2>
          <ForecastPageHeaderActions className="shrink-0" />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("subtitle", { months: forecastSpanMonths })}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <MultiSelect
          options={farmFilterOptions}
          values={selectedFarmIds}
          onChange={setSelectedFarmIds}
          placeholder={t("filters.allFarms")}
          showAllOption
          className={cn(multiSelectBaseClass, bgSurfaceFilter(selectedFarmIds.length > 0))}
          rightIcon={filterTriggerIcon}
        />
        <MultiSelect
          options={grassFilterOptions}
          values={selectedGrassIds}
          onChange={setSelectedGrassIds}
          placeholder={t("filters.allGrasses")}
          showAllOption
          className={cn(multiSelectBaseClass, bgSurfaceFilter(selectedGrassIds.length > 0))}
          rightIcon={filterTriggerIcon}
        />
        <DashboardKpiDateFilter
          value={forecastDateFilter}
          onChange={setForecastDateFilter}
          presets={KPI_DATE_PRESET_FORECAST}
          baselinePreset="next3Months"
        />
      </div>

      {loading && !hasSnapshot ? (
        <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          {t("loading")}
        </div>
      ) : null}

      {isRefreshing ? (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {t("loading")}
        </div>
      ) : null}

      {dbSeries.error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          {dbSeries.error}
        </div>
      ) : null}

      {!chartDbReady && !chartDbPending && hasSnapshot ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {t.rich("noSnapshotInDateRange", {
            command: (chunks) => <code className="text-[11px]">{chunks}</code>,
          })}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {hasSnapshot ? (
      <>
      <ForecastHorizonStrip
        horizonEnd={forecastHorizonEnd}
        upcomingHarvestCount={upcomingHarvests.length}
        upcomingHarvestTotalKg={upcomingHarvestTotalKg}
      />

      <div className="relative rounded-xl border  border-border bg-card p-5">
        {chartDbPending ? (
          <div className="pointer-events-none absolute inset-0 z-10 rounded-xl bg-background/30" />
        ) : null}
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <h3 className="text-sm font-semibold">{t("charts.projectedInventory")}</h3>
          <ChartUnitModeToggle
            mode={chartUnitMode}
            onChange={setChartUnitMode}
            kgLabel={t("charts.sprigKgToggle")}
            m2Label={t("charts.sodM2Toggle")}
          />
        </div>
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={forecastData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(214,18%,89%)" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => formatDayMonth(String(v))} />
            <YAxis
              domain={[0, yAxisMaxForAvailable]}
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => `${(Number(v) / 1000).toFixed(0)}k`}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0) return null;
                const point = payload.find((item) => item.payload)?.payload as ForecastPoint | undefined;
                if (!point) return null;
                return (
                  <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
                    <p className="font-medium text-foreground">{formatDateLong(point.date)}</p>
                    <div className="mt-2 space-y-2">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-muted-foreground">{t("charts.available")}</span>
                        <span className="font-medium text-foreground">
                          {point.available.toLocaleString()} {chartUnitLabel}
                        </span>
                      </div>
                      <InventoryAvailableBalanceSummary model={point.hint} variant="chart" />
                      <div className="flex items-center justify-between gap-4 border-t border-border pt-2">
                        <span className="text-muted-foreground">{t("charts.maxCapacity")}</span>
                        <span className="font-medium text-foreground">
                          {point.max.toLocaleString()} {chartUnitLabel}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              }}
            />
            {showMaxCapacityBand ? (
              <Area
                type="monotone"
                dataKey="max"
                stroke="hsl(214,18%,89%)"
                fill="hsl(214,18%,89%)"
                fillOpacity={0.3}
                strokeDasharray="4 4"
              />
            ) : null}
            <Area
              type="monotone"
              dataKey="available"
              stroke="hsl(152,55%,36%)"
              fill="hsl(152,55%,36%)"
              fillOpacity={0.2}
              strokeWidth={2}
            />
            {forecastData.map((point) =>
              point.overrideCount > 0 ? (
                <ReferenceDot
                  key={`override-${point.date}`}
                  x={point.date}
                  y={point.available}
                  r={4}
                  fill="hsl(35,92%,52%)"
                  stroke="white"
                  strokeWidth={2}
                />
              ) : null,
            )}
          </AreaChart>
        </ResponsiveContainer>
        {hasManualOverridesInForecast ? (
          <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-full bg-[hsl(35,92%,52%)] ring-2 ring-white" />
              <span>{t("charts.manualOverrideActive")}</span>
            </div>
          </div>
        ) : null}
        {!showMaxCapacityBand ? (
          <p className="mt-2 text-[11px] text-muted-foreground">
            {t("charts.maxCapacityHidden")}
          </p>
        ) : null}
      </div>

      {showBreakdownChart ? (
      <div className="rounded-xl border  border-border bg-card p-5">
        <div className="mb-1 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <h3 className="text-sm font-semibold">
            {breakdownMode === "farm"
              ? t("charts.projectedByFarm", { grass: selectedGrassSummary })
              : t("charts.projectedByGrass")}
          </h3>
          <ChartUnitModeToggle
            mode={chartUnitMode}
            onChange={setChartUnitMode}
            kgLabel={t("charts.sprigKgToggle")}
            m2Label={t("charts.sodM2Toggle")}
          />
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {seriesKeys.map((k) => (
            <div key={k} className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: seriesColor(k) }} />
              <span className="text-[11px] text-muted-foreground">{k}</span>
            </div>
          ))}
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          {breakdownMode === "farm"
            ? t("charts.stackedHintByFarm", { grass: selectedGrassSummary })
            : t("charts.stackedHint")}
        </p>
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={forecastBySeries}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(214,18%,89%)" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => formatDayMonth(String(v))} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(Number(v) / 1000).toFixed(0)}k`} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const point = payload.find((item) => item.payload)?.payload as SeriesPoint | undefined;
                if (!point) return null;
                const dateStr = normalizeInventoryBalanceDateYmd(String(point.date ?? ""));
                const hintPoint = point.hint ?? hintsByDate.get(dateStr);
                const balanceRows = hintPoint?.balanceOverrides ?? [];
                const balanceRowsShownOnSeries = new Set<string>();

                return (
                  <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
                    <p className="font-medium text-foreground">{formatDateLong(dateStr)}</p>
                    <div className="mt-2 space-y-2">
                      {seriesKeys.map((key) => {
                        const balance = Number(point[key] ?? 0);
                        const overrideCount = Number(point[seriesOverrideCountKey(key)] ?? 0);
                        const seriesBalanceRows = hintPoint
                          ? filterBalanceOverridesForSeries(balanceRows, key, breakdownMode)
                          : [];
                        for (const row of seriesBalanceRows) {
                          balanceRowsShownOnSeries.add(`${row.zoneKey}|${row.savedDate}`);
                        }
                        if (balance <= 0 && seriesBalanceRows.length === 0) return null;
                        return (
                          <div key={key}>
                            {balance > 0 ? (
                              <div className="flex items-center justify-between gap-4">
                                <div className="flex items-center gap-2">
                                  <span
                                    className="inline-block h-2.5 w-2.5 rounded-sm"
                                    style={{ backgroundColor: seriesColor(key) }}
                                  />
                                  <span style={{ color: seriesColor(key) }}>{key}</span>
                                  {overrideCount > 0 ? (
                                    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                                      {t("charts.manualOverrideActive")}
                                    </span>
                                  ) : null}
                                </div>
                                <span className="font-medium text-foreground">
                                  {balance.toLocaleString()} {chartUnitLabel}
                                </span>
                              </div>
                            ) : null}
                            {seriesBalanceRows.length > 0 ? (
                              <div className={balance > 0 ? "mt-1 space-y-0.5 pl-4" : "space-y-0.5"}>
                                {seriesBalanceRows.map((row) => (
                                  <p
                                    key={`${row.zoneKey}-${row.savedDate}`}
                                    className="text-[11px] leading-snug tabular-nums text-amber-800"
                                  >
                                    {formatInventoryBalanceOverrideLine(row)}
                                  </p>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                      {balanceRows.some(
                        (row) => !balanceRowsShownOnSeries.has(`${row.zoneKey}|${row.savedDate}`),
                      ) && hintPoint ? (
                        <InventoryAvailableBalanceSummary model={hintPoint} variant="chart" />
                      ) : null}
                    </div>
                  </div>
                );
              }}
            />
            {seriesKeys.map((k) => (
              <Area
                key={k}
                type="monotone"
                dataKey={k}
                stackId="1"
                stroke={seriesColor(k)}
                fill={seriesColor(k)}
                fillOpacity={0.45}
                strokeWidth={1.5}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
        {hasManualOverridesInSeriesForecast ? (
          <p className="mt-3 text-[11px] text-muted-foreground">
            {t("charts.manualOverrideTooltipHint")}
          </p>
        ) : null}
      </div>
      ) : null}

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t("upcoming.title")}</h3>
          <span className="text-xs font-medium text-muted-foreground">
            {upcomingHarvests.length}{" "}
            {upcomingHarvests.length !== 1 ? t("upcoming.harvests") : t("upcoming.harvest")}
            {upcomingTotalsSummary ? ` · ${upcomingTotalsSummary}` : ""}
          </span>
        </div>
        {upcomingHarvests.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("upcoming.empty")}
          </p>
        ) : (
          <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
            {upcomingHarvests.map((h) => {
              const farm = forecastDisplayFarmName(h.farm, t("events.noFarmName"));
              const grassDetail = forecastUpcomingGrassDetail(h.grass, h.zone);
              const subtitleText = forecastHarvestEventSubtitle(h.customer, h.project);
              const typeBadge = loadTypeBadgeMeta(h.harvestType, t);
              const nativeDisplay = forecastUpcomingNativeDisplay(
                h.harvestType,
                h.qty,
                h.sourceM2,
                h.planQuantityRaw,
                h.uom,
              );
              return (
                <ForecastEventTile
                  key={h.id}
                  accentClassName="bg-accent"
                  dateLabel={formatDayMonth(h.date)}
                  title={
                    <ForecastEventTitleRich farm={farm} detail={grassDetail} />
                  }
                  subtitle={
                    subtitleText ? (
                      <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                        {subtitleText}
                      </p>
                    ) : undefined
                  }
                  amount={
                    <>
                      {shouldShowForecastM2ConversionHelp(
                        h.harvestType,
                        h.sourceM2,
                        h.m2ConversionLines,
                      ) ? (
                        <ForecastM2ConversionHelp lines={h.m2ConversionLines} t={t} />
                      ) : null}
                      <ForecastKgQuantityLabel
                        sign="-"
                        kg={h.qty}
                        sourceM2={h.sourceM2}
                        nativeDisplay={nativeDisplay}
                        className="text-destructive"
                      />
                    </>
                  }
                  badges={[
                    <ForecastEventBadge
                      key="scheduled"
                      label={t("upcoming.scheduled")}
                      className="bg-accent/10 text-accent"
                    />,
                    <ForecastEventBadge
                      key="type"
                      label={typeBadge.label}
                      className={typeBadge.className}
                    />,
                    ...(h.inventoryIsCapped
                      ? [
                          <ForecastEventBadge
                            key="max"
                            label={t("badges.max")}
                            className="bg-amber-100 text-amber-700"
                          />,
                        ]
                      : []),
                  ]}
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="mb-4 text-sm font-semibold">{t("events.title")}</h3>
        {/* <p className="mb-4 text-xs text-muted-foreground">
          {t("events.description")}
        </p> */}
        {regrowthEvents.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("events.empty")}</p>
        ) : (
          <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
            {regrowthByDate.map(([date, dayFragments]) => {
              const singleEvent =
                dayFragments.length > 0 &&
                dayFragments.every((f) => f.eventKey === dayFragments[0]!.eventKey)
                  ? dayFragments[0]!.ev
                  : null;
              const canOpenFromDate =
                singleEvent != null && singleEvent.planIds.length > 0;
              const openPlanDetails = (eventKey: string, canShow: boolean) => {
                if (!canShow) return;
                setSelectedRegrowthKey((prev) => (prev === eventKey ? null : eventKey));
              };

              const dayLines = dayFragments.map(
                ({ lineId, eventKey, ev, frag, isLastFragmentInEvent }) => {
                  const canShowPlanDetails = ev.planIds.length > 0;
                  const nativeDisplay = forecastUpcomingNativeDisplay(
                    frag.harvestType,
                    frag.qty,
                    frag.sourceM2,
                    frag.planQuantityRaw,
                    frag.uom,
                  );
                  const typeBadge = loadTypeBadgeMeta(frag.harvestType, t);
                  const grassDetail = forecastUpcomingGrassDetail(
                    frag.grass,
                    frag.zoneLabel,
                  );
                  const sodM2ConversionLine =
                    frag.harvestType === "sod"
                      ? regrowthFragmentM2ConversionLine(
                          frag,
                          ev.regrowthTooltipKgPerM2ByZone,
                          t("events.noZoneName"),
                        )
                      : null;
                  const sodM2ConversionLines = sodM2ConversionLine
                    ? [sodM2ConversionLine]
                    : [];
                  const groupBadges = isLastFragmentInEvent
                    ? [
                        ...(ev.maxOverlimitKg > 0
                          ? [
                              <RegrowthMaxBadgeHelp
                                key="max"
                                ev={{
                                  regrowthDateYmd: ev.date,
                                  farmLabel: forecastDisplayFarmName(
                                    ev.farm,
                                    t("events.noFarmName"),
                                  ),
                                  grassLabel: ev.grass,
                                  availablePrevKg: ev.maxAvailablePrevKg,
                                  regrowthKg: ev.maxRegrowthDayKg,
                                  harvestKg: ev.maxHarvestDayKg,
                                  configuredCapSumKg: ev.configuredCapSumKg,
                                  overlimitKg: ev.maxOverlimitKg,
                                }}
                                t={t}
                              />,
                            ]
                          : []),
                        ...(ev.nozoneRemainingKg > 0
                          ? [
                              <ForecastEventBadge
                                key="nozone"
                                label={t("events.nonzonPoolBadge", {
                                  noZone: t("events.noZoneName"),
                                  kg: ev.nozoneRemainingKg.toLocaleString(),
                                })}
                                className="bg-orange-100 text-orange-900"
                              />,
                            ]
                          : []),
                        ...(ev.primaryDisplayKg <= 0 && ev.overflowBeyondCapKg > 0
                          ? [
                              <ForecastEventBadge
                                key="zero-credited"
                                label={`0 kg · over ${ev.overflowBeyondCapKg.toLocaleString()} kg`}
                                className="bg-amber-100 text-amber-800"
                              />,
                            ]
                          : []),
                        ...(ev.overflowBeyondCapKg > 0
                          ? [
                              <span key="overflow" className="inline-flex items-center gap-1">
                                <ForecastEventBadge
                                  label={`+${ev.overflowBeyondCapKg.toLocaleString()} ${t("events.overflow")}`}
                                  className="bg-red-100 text-red-700"
                                />
                                <RegrowthOverflowHelp ev={ev} zoneLabelFn={zoneLabel} t={t} />
                              </span>,
                            ]
                          : []),
                      ]
                    : [];

                  return {
                    id: lineId,
                    farm: forecastDisplayFarmName(ev.farm, t("events.noFarmName")),
                    grassDetail,
                    subtitle:
                      isLastFragmentInEvent && ev.planIds.length > 1 ? (
                        <p className="text-[10px] text-muted-foreground">
                          {t("events.mergedHarvestPlans", { count: ev.planIds.length })}
                        </p>
                      ) : undefined,
                    amount: (
                      <span className="inline-flex items-center justify-end gap-1">
                        {frag.harvestType === "sod" &&
                        shouldShowForecastM2ConversionHelp(
                          frag.harvestType,
                          frag.sourceM2,
                          sodM2ConversionLines,
                        ) ? (
                          <ForecastM2ConversionHelp lines={sodM2ConversionLines} t={t} />
                        ) : null}
                        <ForecastKgQuantityLabel
                          sign="+"
                          kg={frag.qty}
                          sourceM2={frag.sourceM2}
                          nativeDisplay={nativeDisplay}
                          className="text-primary"
                          onClick={
                            canShowPlanDetails
                              ? () => openPlanDetails(eventKey, true)
                              : undefined
                          }
                        />
                      </span>
                    ),
                    badges: [
                      <ForecastEventBadge
                        key="type"
                        label={typeBadge.label}
                        className={typeBadge.className}
                      />,
                      ...groupBadges,
                    ],
                  };
                },
              );

              return (
                <ForecastRegrowthDayGroup
                  key={date}
                  accentClassName="bg-primary"
                  dateLabel={formatDayMonth(date)}
                  lines={dayLines}
                  onDateClick={
                    canOpenFromDate
                      ? () =>
                          openPlanDetails(
                            regrowthEventKey(
                              singleEvent!.farmId,
                              singleEvent!.productId,
                              singleEvent!.date,
                            ),
                            true,
                          )
                      : undefined
                  }
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t("reference.title")}</h3>
          <span className="text-[11px] text-muted-foreground">
            {t("reference.editableInAdmin")}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs lg:grid-cols-3">
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="font-medium">{t("reference.sodHarvest")}</p>
            <p className="mt-1 text-muted-foreground">{regrowthConfig.sodDays} {t("days")}</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="font-medium">{t("reference.sodForSprig")}</p>
            <p className="mt-1 text-muted-foreground">{regrowthConfig.sodForSprigDays} {t("days")}</p>
          </div>
          {regrowthConfig.sprigBands.map((b, idx) => (
            <div key={b.id} className="rounded-lg bg-muted/50 p-3">
              <p className="font-medium">
                {t("reference.sprig")} {formatSprigRangeForReference(regrowthConfig.sprigBands, idx)}
              </p>
              <p className="mt-1 text-muted-foreground">{b.regrowthDays} {t("days")}</p>
            </div>
          ))}
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="font-medium">{t("reference.overrideRecovery")}</p>
            <p className="mt-1 text-muted-foreground">
              {regrowthConfig.overrideRecoveryDays} {t("days")}
            </p>
          </div>
        </div>
      </div>

      {selectedRegrowthEvent && regrowthPlanDetailRows.length > 0 ? (
        <div ref={regrowthPlanDetailsRef}>
          <RegrowthPlanDetailsTable
            rows={regrowthPlanDetailRows}
            regrowthDateLabel={formatDateLong(selectedRegrowthEvent.date)}
            farmGrassLabel={`${forecastDisplayFarmName(selectedRegrowthEvent.farm, t("events.noFarmName"))} · ${selectedRegrowthEvent.grass}`}
          />
        </div>
      ) : null}
      </>
      ) : null}
    </div>
  );
}
