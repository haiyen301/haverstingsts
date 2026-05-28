"use client";

import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from "react";
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

import {
  buildRegrowthZoneSetupBadges,
  type RegrowthZoneSetupBadge,
} from "@/features/forecasting/regrowthZoneConfigPeriod";
import type { ZoneConfigurationRow } from "@/features/admin/api/adminApi";
import type { ForecastHarvestRow } from "@/features/forecasting/forecastingTypes";
import type { RegrowthReferenceConfig } from "@/features/forecasting/forecastingRegrowth";
import {
  sumFarmProductCapacityCapsFromZoneConfigAtDate,
  type RollingDailyAvailableDay,
} from "@/features/forecasting/forecastAvailableAtDate";
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
  mergeZoneCapacityMapsAtDate,
  sumConfiguredZoneCapKgForFarmProduct,
  zoneConfigIsActiveAtYmd,
} from "@/features/forecasting/inventoryRegrowthCalculator";
import {
  applyLatestZoneMaxKgToForecastRows,
  FORECAST_NOZONE_ZONE,
  forecastHarvestRowEffectiveM2,
  forecastHarvestRowInventoryKg,
  kgPerM2ByNormalizedZoneForFarmProduct,
} from "@/features/forecasting/forecastingInventoryConversion";
import {
  computeRegrowthAllocationForFarmProductDate,
  type ZoneRegrowthBreakdown,
} from "@/features/forecasting/regrowthAllocation";
import { pickGrassCatalogRows, zoneIdToLabelResolved } from "@/shared/lib/harvestReferenceData";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import {
  normalizeInventoryBalanceDateYmd,
  type InventoryAvailableOverrideEntry,
} from "@/shared/store/inventoryAvailableOverrideStore";
import { useForecastSnapshot } from "@/features/forecasting/useForecastSnapshot";
import { getForecastToday } from "@/features/forecasting/forecastDateUtils";
import { useDebouncedValue } from "@/features/forecasting/useDebouncedValue";
import { useForecastDailySeries } from "@/features/forecasting/useForecastCompute";
import { MultiSelect } from "@/shared/ui/multi-select";
import { cn } from "@/lib/utils";
import { bgSurfaceFilter } from "@/shared/lib/surfaceFilter";
import {
  parseCsvList,
  toCsvList,
  useSyncedFarmMultiSelect,
} from "@/shared/hooks/useSyncedFarmMultiSelect";

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

function regrowthZoneLineVisible(z: ZoneRegrowthBreakdown): boolean {
  return z.creditedTotalKg + z.zoneOverflowKg + z.nozoneFillKg + z.grossZonedKg > 0;
}

function regrowthZoneTooltipVisible(z: ZoneRegrowthBreakdown): boolean {
  return z.capKg > 0 || regrowthZoneLineVisible(z);
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

function forecastSourceM2FromRow(row: ForecastHarvestRow): number {
  return forecastHarvestRowEffectiveM2(row);
}

function forecastDisplayKgFromRow(row: ForecastHarvestRow): number {
  return forecastHarvestRowInventoryKg(row);
}

/** Display kg used in forecast; append source m² when the plan UOM was converted from m². */
function formatForecastKgWithOptionalM2(kg: number, sourceM2?: number): string {
  const kgStr = `${Math.round(kg).toLocaleString()} kg`;
  const m2 = sourceM2 ?? 0;
  if (m2 > 0) {
    return `${kgStr} (${m2.toLocaleString()} m²)`;
  }
  return kgStr;
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

type RegrowthEventTooltipModel = {
  zoneBreakdowns: ZoneRegrowthBreakdown[];
  nozoneInputKg: number;
  configuredCapSumKg: number;
  regrowthTooltipZoneSource: Record<string, { m2: number; nativeKg: number }>;
  /** Zone norm key → inventory kg/m² từ cấu hình (quy đổi fill no-zone → m²). */
  regrowthTooltipKgPerM2ByZone: Record<string, number>;
};

function RegrowthEventNumbersHelp({
  ev,
  zoneLabelFn,
  t,
}: {
  ev: RegrowthEventTooltipModel;
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

  const zonesToShow = ev.zoneBreakdowns.filter(regrowthZoneTooltipVisible);
  const nZonesConfigured = ev.zoneBreakdowns.filter((z) => z.capKg > 0).length;
  const noZoneLabel = t("events.noZoneName");

  const tooltipBody = (
    <>
      <p className="font-medium text-foreground">
        {t("events.regrowthTooltipZoneCount", { count: nZonesConfigured })}
      </p>
      {zonesToShow.map((z) => {
        const nk = zoneNormKeyForHarvestZoneTooltip(z.zoneLabel);
        const src = ev.regrowthTooltipZoneSource[nk] ?? { m2: 0, nativeKg: 0 };
        const label = zoneDisplayForRegrowthTooltip(z.zoneLabel, zoneLabelFn, t);
        const intoStr = z.totalIntoZoneKg.toLocaleString();
        const fillStr = z.nozoneFillKg.toLocaleString();
        const spreadKg = z.grossZonedFromNozoneSpreadKg;
        const nativeDirectKg = Math.max(0, z.grossZonedKg - spreadKg);
        const primarilyFromNozone = z.nozoneFillKg > 0.5 && z.grossZonedKg < 0.5;
        const primarilyFromMapSpread =
          spreadKg > 0.5 && nativeDirectKg < 0.5 && z.nozoneFillKg < 0.5;

        const mixBreakdown =
          spreadKg > 0.5 ? (
            <span className="block text-[10px] text-muted-foreground/90">
              {t("events.regrowthTooltipZoneNozoneMapSpread", {
                noZone: noZoneLabel,
                zone: label,
                kg: spreadKg.toLocaleString(),
              })}
              {nativeDirectKg > 0.5 ? (
                <>
                  {" · "}
                  {t("events.regrowthTooltipZoneMixDirect", {
                    kg: nativeDirectKg.toLocaleString(),
                  })}
                </>
              ) : null}
              {z.nozoneFillKg > 0.5 ? (
                <>
                  {" · "}
                  {t("events.regrowthTooltipZoneMixFill", {
                    noZone: noZoneLabel,
                    kg: fillStr,
                  })}
                </>
              ) : null}
            </span>
          ) : z.nozoneFillKg > 0.5 ? (
            <span className="block text-[10px] text-muted-foreground/90">
              {t("events.regrowthTooltipZoneIntoBreakdown", {
                direct: nativeDirectKg.toLocaleString(),
                fill: fillStr,
                noZone: noZoneLabel,
              })}
            </span>
          ) : null;

        if (src.m2 > 0) {
          if (primarilyFromNozone || primarilyFromMapSpread) {
            return (
              <p key={z.zoneKey} className="text-muted-foreground">
                {t("events.regrowthTooltipZoneM2NozoneFill", {
                  noZone: noZoneLabel,
                  zone: label,
                  m2: src.m2.toLocaleString(),
                  into: intoStr,
                })}
              </p>
            );
          }
          return (
            <p key={z.zoneKey} className="text-muted-foreground">
              {t("events.regrowthTooltipZoneM2Kg", {
                zone: label,
                m2: src.m2.toLocaleString(),
                into: intoStr,
              })}
              {mixBreakdown}
            </p>
          );
        }
        if (primarilyFromNozone) {
          return (
            <p key={z.zoneKey} className="text-muted-foreground">
              {t("events.regrowthTooltipZoneLineNozoneFill", {
                noZone: noZoneLabel,
                zone: label,
                into: intoStr,
              })}
            </p>
          );
        }
        if (primarilyFromMapSpread) {
          return (
            <p key={z.zoneKey} className="text-muted-foreground">
              {t("events.regrowthTooltipZoneLineNozoneFill", {
                noZone: noZoneLabel,
                zone: label,
                into: intoStr,
              })}
            </p>
          );
        }
        return (
          <p key={z.zoneKey} className="text-muted-foreground">
            {t("events.regrowthTooltipZoneKg", { zone: label, into: intoStr })}
            {mixBreakdown}
          </p>
        );
      })}
      {ev.nozoneInputKg > 0 ? (
        <p className="text-muted-foreground">
          {t("events.regrowthTooltipNozone", {
            noZone: noZoneLabel,
            kg: ev.nozoneInputKg.toLocaleString(),
          })}
        </p>
      ) : null}
      {zonesToShow.map((z) => {
        if (z.nozoneFillKg <= 0) return null;
        if (z.nozoneFillKg > 0.5 && z.grossZonedKg < 0.5) return null;
        const nk = zoneNormKeyForHarvestZoneTooltip(z.zoneLabel);
        const kgpm2 = ev.regrowthTooltipKgPerM2ByZone[nk] ?? 0;
        const m2Equiv = kgpm2 > 0 ? z.nozoneFillKg / kgpm2 : 0;
        const label = zoneDisplayForRegrowthTooltip(z.zoneLabel, zoneLabelFn, t);
        const m2Str =
          m2Equiv > 0 && Number.isFinite(m2Equiv)
            ? m2Equiv.toLocaleString(undefined, { maximumFractionDigits: 2 })
            : "";
        return (
          <p key={`nz-into-${z.zoneKey}`} className="text-muted-foreground">
            {t("events.regrowthTooltipNozoneInto", {
              noZone: noZoneLabel,
              zone: label,
              kg: z.nozoneFillKg.toLocaleString(),
            })}
            {m2Str ? t("events.regrowthTooltipNozoneIntoM2Equiv", { m2: m2Str }) : null}
          </p>
        );
      })}
      <p className="border-t border-border pt-1 text-muted-foreground">
        {t("events.regrowthTooltipCapacity", {
          kg: ev.configuredCapSumKg.toLocaleString(),
        })}
      </p>
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
          className="rounded-full p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label={t("events.regrowthTooltipAria")}
          aria-expanded={open}
          onMouseEnter={openPanel}
          onMouseLeave={scheduleClose}
          onFocus={openPanel}
          onBlur={scheduleClose}
        >
          <HelpCircle className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        role="tooltip"
        side="top"
        align="start"
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
function collectForecastChartDateYmds(
  today: Date,
  forecastMonths: number,
  overridesByZone: Record<string, InventoryAvailableOverrideEntry>,
  farmProductFilter: (farmId: number, productId: number) => boolean,
): string[] {
  const horizonEnd = addMonths(today, forecastMonths);
  const dates = new Set<string>();
  const totalWeeks = Math.max(1, Math.round(forecastMonths * 4.33));

  for (let w = 0; w < totalWeeks; w++) {
    dates.add(ymdFromDate(addDays(today, w * 7)));
  }

  for (const entry of Object.values(overridesByZone)) {
    if (!farmProductFilter(entry.farmId, entry.grassId)) continue;
    const ymd = normalizeInventoryBalanceDateYmd(entry.date);
    const d = parseYmdLocal(ymd);
    if (!d || d < today || d > horizonEnd) continue;
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

function RegrowthZoneSetupBadges({
  badges,
  zoneLabelFn,
  t,
}: {
  badges: RegrowthZoneSetupBadge[];
  zoneLabelFn: (zone: string) => string;
  t: (key: string, values?: TranslationValues) => string;
}) {
  if (badges.length === 0) return null;
  const showZoneName = badges.length > 1;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      {badges.map((b) => {
        const isPeriod = b.kind === "period";
        const isDefault = b.kind === "default";
        const rangeLabel = isPeriod
          ? b.effectiveTo
            ? t("events.zoneSetupPeriod", {
                from: formatDayMonth(b.effectiveFrom ?? ""),
                to: formatDayMonth(b.effectiveTo),
                max: b.maxKg.toLocaleString(),
              })
            : b.effectiveFrom
              ? t("events.zoneSetupPeriodOpen", {
                  from: formatDayMonth(b.effectiveFrom),
                  max: b.maxKg.toLocaleString(),
                })
              : t("events.zoneSetupDefault", { max: b.maxKg.toLocaleString() })
          : isDefault
            ? t("events.zoneSetupDefault", { max: b.maxKg.toLocaleString() })
            : t("events.zoneSetupNotSet");

        return (
          <span
            key={`${b.zone}-${b.kind}-${b.effectiveFrom ?? ""}-${b.effectiveTo ?? ""}`}
            className={cn(
              "inline-flex max-w-full flex-wrap items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
              isPeriod
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : isDefault
                  ? "border-slate-200 bg-slate-50 text-slate-700"
                  : "border-amber-200 bg-amber-50 text-amber-800",
            )}
          >
            {showZoneName ? (
              <span className="font-semibold">{zoneLabelFn(b.zone)}</span>
            ) : null}
            <span className="font-normal tabular-nums">{rangeLabel}</span>
          </span>
        );
      })}
    </div>
  );
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

export function InventoryForecast() {
  const t = useTranslations("ForecastInventory");
  const farmZones = useHarvestingDataStore((s) => s.farmZones);
  const grasses = useHarvestingDataStore((s) => s.grasses);
  const harvestListGrassFilter = useHarvestingDataStore((s) => s.harvestListGrassFilter);
  const setHarvestListGrassFilter = useHarvestingDataStore((s) => s.setHarvestListGrassFilter);
  const {
    forecastRows: rows,
    zoneConfigs: zoneConfigSnapshot,
    regrowthConfig,
    overridesByZone,
    isLoading: loading,
    isRefreshing,
    isRecomputing,
    hasSnapshot,
    error,
  } = useForecastSnapshot();
  const {
    selectedFarmIds,
    selectedFarmIdSet,
    setSelectedFarmIds,
    farmOptions,
  } = useSyncedFarmMultiSelect();
  const [forecastMonths, setForecastMonths] = useState<number>(6);
  const [showBreakdownChart, setShowBreakdownChart] = useState(false);
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
  }, [hasSnapshot, forecastMonths, debouncedFarmIds, debouncedGrassIds]);

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

  const farmFilterOptions = useMemo(
    () => farmOptions.map((o) => ({ value: o.id, label: o.label })),
    [farmOptions],
  );

  /** Grass filter: STS sales window on today (empty `refYmds` → today); URL-selected ids stay pinned. */
  const grassFilterOptions = useMemo(() => {
    const picked = pickGrassCatalogRows({
      catalog: grasses as unknown[],
      mode: "sales_window",
      refYmds: [],
      pinnedGrassIds: selectedGrassIds,
    });
    return picked
      .map((g) => {
        if (!g || typeof g !== "object") return null;
        const rec = g as Record<string, unknown>;
        const value = String(rec.id ?? "").trim();
        const label = String(rec.title ?? rec.name ?? "").trim() || value;
        if (!value) return null;
        return { value, label };
      })
      .filter((x): x is { value: string; label: string } => x !== null)
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [grasses, selectedGrassIds]);

  const rowsWithLiveZoneCaps = useMemo(
    () => applyLatestZoneMaxKgToForecastRows(rows, zoneConfigSnapshot),
    [rows, zoneConfigSnapshot],
  );

  const filteredRows = useMemo(
    () =>
      rowsWithLiveZoneCaps.filter((r) => {
        const farmIdStr = String(r.farmId);
        const productIdStr = String(r.productId);
        if (debouncedFarmIds.length > 0 && !debouncedFarmIdSet.has(farmIdStr)) return false;
        if (debouncedGrassIds.length > 0 && !debouncedGrassIdSet.has(productIdStr)) return false;
        return true;
      }),
    [
      rowsWithLiveZoneCaps,
      debouncedFarmIds,
      debouncedFarmIdSet,
      debouncedGrassIds,
      debouncedGrassIdSet,
    ],
  );

  const farmProductFilter = useCallback(
    (farmId: number, productId: number) => {
      if (debouncedFarmIds.length > 0 && !debouncedFarmIdSet.has(String(farmId))) return false;
      if (debouncedGrassIds.length > 0 && !debouncedGrassIdSet.has(String(productId))) return false;
      return true;
    },
    [debouncedFarmIds, debouncedFarmIdSet, debouncedGrassIds, debouncedGrassIdSet],
  );

  const forecastHorizonEnd = useMemo(
    () => addMonths(getForecastToday(), forecastMonths),
    [forecastMonths],
  );

  /** Same rolling daily basis as dev Daily harvest / available calendar. */
  const dailySeriesResult = useForecastDailySeries({
    filteredRows,
    zoneConfigs: zoneConfigSnapshot,
    regrowthConfig,
    overridesByZone,
    forecastHorizonEnd,
    debouncedFarmIds,
    debouncedGrassIds,
    enabled: hasSnapshot,
  });

  const rollingDailyAvailable = dailySeriesResult.aggregate;

  const rollingByDate = useMemo(
    () =>
      new Map<string, RollingDailyAvailableDay>(
        rollingDailyAvailable.map((day: RollingDailyAvailableDay) => [day.date, day]),
      ),
    [rollingDailyAvailable],
  );

  const rollingDailyByFarmProduct = dailySeriesResult.byFarmProduct;

  const farmProductGroupKeys = useMemo(() => {
    const keys = new Set<string>(rollingDailyByFarmProduct.keys());
    for (const row of filteredRows) {
      if (row.farmId <= 0 || row.productId <= 0) continue;
      if (!farmProductFilter(row.farmId, row.productId)) continue;
      keys.add(`${row.farmId}|${row.productId}`);
    }
    const todayYmd = ymdFromDate(getForecastToday());
    for (const row of zoneConfigSnapshot) {
      if (!zoneConfigIsActiveAtYmd(row, todayYmd)) continue;
      const farmId = Number(row.farm_id);
      const productId = Number(row.grass_id);
      if (!Number.isFinite(farmId) || !Number.isFinite(productId) || farmId <= 0 || productId <= 0) {
        continue;
      }
      if (!farmProductFilter(farmId, productId)) continue;
      keys.add(`${farmId}|${productId}`);
    }
    return Array.from(keys).sort((a, b) => a.localeCompare(b));
  }, [rollingDailyByFarmProduct, filteredRows, zoneConfigSnapshot, farmProductFilter]);

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

  const zoneSeriesMeta = useMemo(() => {
    const out = new Map<string, string>();
    for (const r of filteredRows) {
      const zoneKey = forecastZoneKeyFromRow(r);
      if (out.has(zoneKey)) continue;
      out.set(zoneKey, r.grassType);
    }
    for (const entry of Object.values(overridesByZone)) {
      if (selectedFarmIds.length > 0 && !selectedFarmIdSet.has(String(entry.farmId))) continue;
      if (selectedGrassIds.length > 0 && !selectedGrassIdSet.has(String(entry.grassId))) continue;
      if (!entry.zoneKey || !entry.turfgrass) continue;
      if (!out.has(entry.zoneKey)) out.set(entry.zoneKey, entry.turfgrass);
    }
    return out;
  }, [filteredRows, overridesByZone, selectedFarmIds, selectedFarmIdSet, selectedGrassIds, selectedGrassIdSet]);

  const zoneFarmMeta = useMemo(() => {
    const out = new Map<string, string>();
    for (const r of filteredRows) {
      const zoneKey = forecastZoneKeyFromRow(r);
      if (!out.has(zoneKey)) out.set(zoneKey, r.farm);
    }
    for (const entry of Object.values(overridesByZone)) {
      if (selectedFarmIds.length > 0 && !selectedFarmIdSet.has(String(entry.farmId))) continue;
      if (selectedGrassIds.length > 0 && !selectedGrassIdSet.has(String(entry.grassId))) continue;
      if (!entry.zoneKey || !entry.farmName) continue;
      if (!out.has(entry.zoneKey)) out.set(entry.zoneKey, entry.farmName);
    }
    return out;
  }, [filteredRows, overridesByZone, selectedFarmIds, selectedFarmIdSet, selectedGrassIds, selectedGrassIdSet]);

  const breakdownMode: "grass" | "farm" =
    selectedGrassIds.length > 0 ? "farm" : "grass";

  const selectedGrassSummary = useMemo(() => {
    if (selectedGrassIds.length === 0) return "";
    const labels = grassFilterOptions
      .filter((o) => selectedGrassIdSet.has(o.value))
      .map((o) => o.label);
    if (labels.length > 0) return labels.join(", ");
    return selectedGrassIds.join(", ");
  }, [selectedGrassIds, selectedGrassIdSet, grassFilterOptions]);

  const productGrassMeta = useMemo(() => {
    const out = new Map<number, string>();
    for (const r of filteredRows) {
      if (r.productId > 0 && r.grassType && !out.has(r.productId)) {
        out.set(r.productId, r.grassType);
      }
    }
    return out;
  }, [filteredRows]);

  const farmProductFarmMeta = useMemo(() => {
    const out = new Map<string, string>();
    for (const r of filteredRows) {
      const k = `${r.farmId}|${r.productId}`;
      if (!out.has(k) && r.farm) out.set(k, r.farm);
    }
    return out;
  }, [filteredRows]);

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
    return out;
  }, [farmFilterOptions, filteredRows, overridesByZone]);

  const grassNameById = useMemo(() => {
    const out = new Map<number, string>();
    for (const option of grassFilterOptions) {
      const grassId = Number(option.value);
      if (Number.isFinite(grassId) && grassId > 0 && option.label) {
        out.set(grassId, option.label);
      }
    }
    for (const g of grasses) {
      if (!g || typeof g !== "object") continue;
      const rec = g as Record<string, unknown>;
      const grassId = Number(rec.id);
      const label = String(rec.title ?? rec.name ?? "").trim();
      if (Number.isFinite(grassId) && grassId > 0 && label) out.set(grassId, label);
    }
    for (const r of filteredRows) {
      if (r.productId > 0 && r.grassType) out.set(r.productId, r.grassType);
    }
    for (const entry of Object.values(overridesByZone)) {
      if (entry.grassId > 0 && entry.turfgrass) out.set(entry.grassId, entry.turfgrass.trim());
    }
    return out;
  }, [grassFilterOptions, grasses, filteredRows, overridesByZone]);

  const forecastData = useMemo<ForecastPoint[]>(() => {
    const today = getForecastToday();
    const chartDates = collectForecastChartDateYmds(
      today,
      forecastMonths,
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
      const available = Math.max(0, Math.round(rolling?.availableKg ?? 0));
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
        max: Math.max(0, totalMax),
        overrideCount: hint.balanceOverrides.length,
        hint,
      };
    });
  }, [
    forecastMonths,
    rollingByDate,
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
    () => totalMaxToday > 0 && totalMaxToday <= yAxisMaxForAvailable * 5,
    [totalMaxToday, yAxisMaxForAvailable],
  );

  const hasManualOverridesInForecast = useMemo(
    () => forecastData.some((point) => point.overrideCount > 0),
    [forecastData],
  );

  const seriesKeys = useMemo(() => {
    if (breakdownMode === "farm") {
      const set = new Set<string>();
      for (const r of filteredRows) {
        if (r.farm) set.add(r.farm);
      }
      for (const entry of Object.values(overridesByZone)) {
        if (selectedFarmIds.length > 0 && !selectedFarmIdSet.has(String(entry.farmId))) continue;
        if (selectedGrassIds.length > 0 && !selectedGrassIdSet.has(String(entry.grassId))) continue;
        if (entry.farmName) set.add(entry.farmName);
      }
      return Array.from(set).sort((a, b) => a.localeCompare(b));
    }
    const set = new Set(filteredRows.map((r) => r.grassType).filter(Boolean));
    for (const entry of Object.values(overridesByZone)) {
      if (selectedFarmIds.length > 0 && !selectedFarmIdSet.has(String(entry.farmId))) continue;
      if (selectedGrassIds.length > 0 && !selectedGrassIdSet.has(String(entry.grassId))) continue;
      if (entry.turfgrass) set.add(entry.turfgrass);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [
    filteredRows,
    breakdownMode,
    overridesByZone,
    selectedFarmIds,
    selectedFarmIdSet,
    selectedGrassIds,
    selectedGrassIdSet,
  ]);

  const forecastBySeries = useMemo<SeriesPoint[]>(() => {
    const today = getForecastToday();
    const chartDates = collectForecastChartDateYmds(
      today,
      forecastMonths,
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

      for (const fpKey of farmProductGroupKeys) {
        const day = rollingDailyByFarmProduct.get(fpKey)?.get(dateStr);
        if (!day) continue;
        const productId = Number(fpKey.split("|")[1] ?? 0);
        const seriesKey =
          breakdownMode === "farm"
            ? farmProductFarmMeta.get(fpKey)
            : productGrassMeta.get(productId);
        if (!seriesKey) continue;
        row[seriesKey] = Number(row[seriesKey] ?? 0) + day.availableKg;
      }

      for (const entry of Object.values(overridesByZone)) {
        if (selectedFarmIds.length > 0 && !selectedFarmIdSet.has(String(entry.farmId))) continue;
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
          seriesKey =
            String(entry.turfgrass ?? "").trim() ||
            productGrassMeta.get(entry.grassId) ||
            grassNameById.get(entry.grassId);
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

      points.push(row);
    }

    return points;
  }, [
    forecastMonths,
    farmProductGroupKeys,
    rollingDailyByFarmProduct,
    seriesKeys,
    breakdownMode,
    productGrassMeta,
    farmProductFarmMeta,
    overridesByZone,
    farmProductFilter,
    hintsByDate,
    grassNameById,
    farmNameById,
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
    const today = getForecastToday();
    const end = addMonths(today, forecastMonths);
    const result = filteredRows
      .filter((h) => {
        const normalized = normalizeYmd(h.harvestDate);
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
        const inRange = d >= today && d <= end;
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
      .map((h) => ({
        planId: forecastLogicalPlanRowId(h.id),
        id: h.id,
        date: normalizeYmd(h.harvestDate),
        farm: h.farm,
        grass: h.grassType,
        zone: String(h.zone ?? "").trim(),
        project: h.project ?? "",
        customer: h.customer ?? "",
        qty: forecastDisplayKgFromRow(h),
        sourceM2: forecastSourceM2FromRow(h),
        uom: "kg",
        inventoryIsCapped: h.inventoryIsCapped,
        harvestType: h.harvestType,
        type: harvestTypeLabel(h.harvestType, t),
      }))
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
          uom: row.uom,
          inventoryIsCapped: row.inventoryIsCapped,
          harvestType: row.harvestType,
          type: row.type,
        });
      } else {
        prev.qty += row.qty;
        prev.sourceM2 += row.sourceM2;
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
  }, [filteredRows, forecastMonths, t, zoneLabel]);

  const upcomingTotalsSummary = useMemo(() => {
    const kgSum = upcomingHarvests.reduce((sum, h) => sum + h.qty, 0);
    if (kgSum <= 0) return "";
    return t("upcoming.summaryKg", { quantity: kgSum.toLocaleString() });
  }, [upcomingHarvests, t]);

  const regrowthEvents = useMemo(() => {
    const today = getForecastToday();
    const end = addMonths(today, forecastMonths);
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
          uom: "kg",
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
      uom: string;
      type: string;
      inventoryIsCapped: boolean;
      zoneLabel: string;
      zoneKey: string;
      inventoryKgFromNozoneSpread: number;
    };

    const finalEvents: RegrowthFinalLine[] = [];

    for (const ev of candidates) {
      // Same horizon as charts + upcoming harvests: today .. today + forecastMonths
      if (ev.dateObj <= today || ev.dateObj > end) continue;

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
        uom: ev.uom,
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
        for (const f of frags) {
          if (f.harvestDate && harvestDate && f.harvestDate < harvestDate) harvestDate = f.harvestDate;
          if (!planIds.includes(f.planId)) planIds.push(f.planId);
          mergedType = mergeHarvestTypeLabels(mergedType, f.type);
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

        const zoneSetupBadges = buildRegrowthZoneSetupBadges(zoneConfigSnapshot, {
          farmId: first.farmId,
          productId: first.productId,
          regrowthYmd: first.date,
          fragments: frags.map((f) => ({
            zoneKey: f.zoneKey,
            zoneLabel: f.zoneLabel,
          })),
          zoneBreakdowns: alloc.zoneBreakdowns,
        });

        const regrowthTooltipZoneSource = aggregateHarvestByZoneForRegrowthYmd(
          filteredRows,
          regrowthConfig,
          first.farmId,
          first.productId,
          first.date,
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
          type: mergedType,
          inventoryIsCapped,
          configuredCapSumKg: capSum,
          planIds,
          /** Mỗi dòng forecast trong nhóm (debug: so với `planIds` nếu thiếu plan DB). */
          sourceForecastRowIds,
          totalGrossKg: alloc.totalGrossKg,
          primaryDisplayKg: alloc.totalCreditedMappedKg,
          overflowBeyondCapKg: alloc.overflowUncreditedKg,
          zoneSlotLabels,
          zoneSetupBadges,
          regrowthTooltipZoneSource,
          sourceM2: sumRegrowthTooltipSourceM2(regrowthTooltipZoneSource),
          regrowthTooltipKgPerM2ByZone: kgPerM2ByNormalizedZoneForFarmProduct(
            zoneConfigSnapshot,
            first.farmId,
            first.productId,
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
  }, [filteredRows, forecastMonths, regrowthConfig, t, zoneConfigSnapshot, zoneLabel]);

  /** Stable colors from full dataset so hues do not shift when filters change (matches Harvesting Portal). */
  const grassColors = useMemo(() => {
    const all = Array.from(new Set(rows.map((r) => r.grassType).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b),
    );
    const map: Record<string, string> = {};
    all.forEach((g, i) => {
      map[g] = GRASS_SERIES_PALETTE[i % GRASS_SERIES_PALETTE.length];
    });
    return map;
  }, [rows]);

  const farmColors = useMemo(() => {
    const all = Array.from(new Set(rows.map((r) => r.farm).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b),
    );
    const map: Record<string, string> = {};
    all.forEach((f, i) => {
      map[f] = FARM_SERIES_PALETTE[i % FARM_SERIES_PALETTE.length];
    });
    return map;
  }, [rows]);

  const seriesColor = (key: string) =>
    (breakdownMode === "farm" ? farmColors[key] : grassColors[key]) ?? GRASS_SERIES_PALETTE[0];

  const filterTriggerIcon = (
    <>
      <AlignLeft className="h-3.5 w-3.5 shrink-0" />
      <ArrowDown className="h-3.5 w-3.5 shrink-0" />
    </>
  );
  const multiSelectBaseClass =
    "min-w-[140px] max-w-[180px] rounded-md border border-input text-sm text-foreground hover:bg-btnhover/40";

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-2xl font-bold">{t("title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("subtitle", { months: forecastMonths })}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <MultiSelect
          options={farmFilterOptions}
          values={selectedFarmIds}
          onChange={setSelectedFarmIds}
          placeholder={t("filters.allFarms")}
          className={cn(multiSelectBaseClass, bgSurfaceFilter(selectedFarmIds.length > 0))}
          rightIcon={filterTriggerIcon}
        />
        <MultiSelect
          options={grassFilterOptions}
          values={selectedGrassIds}
          onChange={setSelectedGrassIds}
          placeholder={t("filters.allGrasses")}
          className={cn(multiSelectBaseClass, bgSurfaceFilter(selectedGrassIds.length > 0))}
          rightIcon={filterTriggerIcon}
        />
        <select
          value={forecastMonths}
          onChange={(e) => setForecastMonths(Number(e.target.value))}
          className={cn(
            "h-10 min-w-[140px] max-w-[200px] rounded-md border border-input px-3 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] hover:bg-btnhover/40 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35",
            bgSurfaceFilter(forecastMonths !== 6),
          )}
        >
          <option value={6}>{t("filters.nextMonths", { months: 6 })}</option>
          <option value={12}>{t("filters.nextMonths", { months: 12 })}</option>
          <option value={18}>{t("filters.nextMonths", { months: 18 })}</option>
        </select>
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

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {hasSnapshot ? (
      <>
      <div className="relative rounded-xl border  border-border bg-card p-5">
        {isRecomputing ? (
          <div className="pointer-events-none absolute inset-0 z-10 rounded-xl bg-background/30" />
        ) : null}
        <h3 className="mb-4 text-sm font-semibold">{t("charts.projectedInventory")}</h3>
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
                          {point.available.toLocaleString()} kg
                        </span>
                      </div>
                      <InventoryAvailableBalanceSummary model={point.hint} variant="chart" />
                      <div className="flex items-center justify-between gap-4 border-t border-border pt-2">
                        <span className="text-muted-foreground">{t("charts.maxCapacity")}</span>
                        <span className="font-medium text-foreground">
                          {point.max.toLocaleString()} kg
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
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            {breakdownMode === "farm"
              ? t("charts.projectedByFarm", { grass: selectedGrassSummary })
              : t("charts.projectedByGrass")}
          </h3>
          <div className="flex flex-wrap items-center gap-3">
            {seriesKeys.map((k) => (
              <div key={k} className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: seriesColor(k) }} />
                <span className="text-[11px] text-muted-foreground">{k}</span>
              </div>
            ))}
          </div>
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
                                  {balance.toLocaleString()} kg
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
                    <span className="font-medium">
                      {forecastDisplayFarmName(h.farm, t("events.noFarmName"))}
                    </span>
                    <span className="text-muted-foreground"> . {h.grass} {zoneLabel(h.zone)}</span>
                  </p>
                  {(h.project || h.customer) && (
                    <p className="text-[11px] text-muted-foreground truncate">
                      {h.customer}{h.customer && h.project ? ' · ' : ''}{h.project}
                    </p>
                  )}
                </div>
                <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
                  {t("upcoming.scheduled")}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${loadTypeBadgeMeta(h.harvestType, t).className}`}
                >
                  {loadTypeBadgeMeta(h.harvestType, t).label}
                </span>
                {h.inventoryIsCapped ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                    {t("badges.max")}
                  </span>
                ) : null}
                <span className="min-w-22 shrink-0 text-right text-sm font-medium text-destructive">
                  -{formatForecastKgWithOptionalM2(h.qty, h.sourceM2)}
                </span>
              </div>
            ))}
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
            {regrowthEvents.map((ev) => {
              const noZoneInline = regrowthNoZoneInlineText(
                ev.regrowthTooltipZoneSource,
                ev.nozoneInputKg,
                t,
              );
              return (
              <div
                key={`${ev.farmId}-${ev.productId}-${ev.date}`}
                className="flex items-center gap-4 rounded-lg px-3 py-2.5 hover:bg-[hsl(var(--muted)/0.3)]"
              >
                <div className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                <div className="min-w-[90px] text-sm font-medium">{formatDayMonth(ev.date)}</div>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                    <span className="shrink-0 font-medium">
                      {forecastDisplayFarmName(ev.farm, t("events.noFarmName"))}
                    </span>
                    <span className="shrink-0 text-muted-foreground">·</span>
                    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-muted-foreground">
                      <span className="truncate">{ev.grass}</span>
                      <RegrowthEventNumbersHelp ev={ev} zoneLabelFn={zoneLabel} t={t} />
                      {noZoneInline ? (
                        <>
                          <span className="text-muted-foreground/80" aria-hidden>
                            ·
                          </span>
                          <span className="whitespace-nowrap">{noZoneInline}</span>
                        </>
                      ) : null}
                    </span>
                  </p>
                  {ev.planIds.length > 1 ? (
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {t("events.mergedHarvestPlans", { count: ev.planIds.length })}
                    </p>
                  ) : null}
                  <RegrowthZoneSetupBadges
                    badges={ev.zoneSetupBadges ?? []}
                    zoneLabelFn={zoneLabel}
                    t={t}
                  />
                </div>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  {ev.type}
                </span>
                {ev.inventoryIsCapped || ev.overflowBeyondCapKg > 0 ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                    {t("badges.max")}
                  </span>
                ) : null}
                {ev.nozoneRemainingKg > 0 ? (
                  <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-900">
                    {t("events.nonzonPoolBadge", {
                      noZone: t("events.noZoneName"),
                      kg: ev.nozoneRemainingKg.toLocaleString(),
                    })}
                  </span>
                ) : null}
                {ev.overflowBeyondCapKg > 0 ? (
                  <span className="inline-flex shrink-0 items-center gap-1">
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">
                      +{ev.overflowBeyondCapKg.toLocaleString()} {t("events.overflow")}
                    </span>
                    <RegrowthOverflowHelp ev={ev} zoneLabelFn={zoneLabel} t={t} />
                  </span>
                ) : null}
                <span className="min-w-22 shrink-0 text-right text-sm font-medium">
                  +{formatForecastKgWithOptionalM2(ev.primaryDisplayKg, ev.sourceM2)}
                </span>
              </div>
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
      </>
      ) : null}
    </div>
  );
}
