"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  Database,
  HelpCircle,
  RefreshCw,
  Search,
} from "lucide-react";
import { useRouter } from "next/navigation";

import RequireAuth from "@/features/auth/RequireAuth";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import {
  fetchHarvestRowsForForecasting,
  resolvePlanRowUom,
  rowsToMockHarvestRows,
} from "@/features/forecasting/mapHarvestApiToForecastRows";
import type { ForecastHarvestRow } from "@/features/forecasting/forecastingTypes";
import {
  DEFAULT_REGROWTH_REFERENCE_CONFIG,
  computeRegrowthDaysForHarvest,
  resolveRegrowthReferenceConfigFromRules,
  type RegrowthReferenceConfig,
} from "@/features/forecasting/forecastingRegrowth";
import {
  computeAllocatedAvailableByZoneAtDate,
  computeInventoryStyleFarmGrassDailySeries,
  computeInventoryStyleZoneDailySnapshots,
  computeRegrowthCreditedOnDate,
  sumFarmProductCapacityCapsFromZoneConfigAtDate,
  type ZoneInventoryDaySnapshot,
} from "@/features/forecasting/forecastAvailableAtDate";
import {
  forecastLogicalPlanRowId,
  forecastZoneKeyFromRow,
  forecastZoneKeyFromParts,
  findActiveZoneConfiguration,
  getRegrowthDateFromHarvest,
  mergeZoneCapacityMapsAtDate,
  sumConfiguredZoneCapKgForFarmProduct,
  zoneConfigIsActiveAtYmd,
  zoneConfigurationMaxKg,
} from "@/features/forecasting/inventoryRegrowthCalculator";
import { applyInventoryAvailableOverridesToZoneMap } from "@/features/forecasting/inventoryAvailableOverrides";
import {
  DEFAULT_FALLBACK_INVENTORY_KG_PER_M2,
  DEFAULT_FALLBACK_MAX_INVENTORY_KG,
  FORECAST_NOZONE_ZONE,
  applyLatestZoneMaxKgToForecastRows,
  forecastHarvestRowEffectiveM2,
  forecastHarvestRowInventoryKg,
  forecastHarvestRowUsesHarvestedAreaForMagnitude,
  harvestPlanEffectiveMagnitudeFromRaw,
  harvestPlanQuantityFromRaw,
  isForecastExcludedZone,
  planRowUsesHarvestedAreaForMagnitude,
  resolvePlanRowUomFromRaw,
  resolveZone1InventoryKgPerM2,
} from "@/features/forecasting/forecastingInventoryConversion";
import { computeRegrowthAllocationForFarmProductDate } from "@/features/forecasting/regrowthAllocation";
import {
  buildInventoryAvailableHintModel,
  InventoryAvailableHintPopover,
  type InventoryAvailableHintModel,
} from "@/features/forecasting/inventoryAvailableHint";
import {
  fetchRegrowthRules,
  fetchZoneConfigurations,
  type ZoneConfigurationRow,
} from "@/features/admin/api/adminApi";
import { pickGrassCatalogRows, zoneIdToLabelResolved } from "@/shared/lib/harvestReferenceData";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { useInventoryAvailableOverrideStore } from "@/shared/store/inventoryAvailableOverrideStore";
import { MultiSelect } from "@/shared/ui/multi-select";
import {
  parseCsvList,
  toCsvList,
  useSyncedFarmMultiSelect,
} from "@/shared/hooks/useSyncedFarmMultiSelect";

type SourceAuditRow = {
  planId: string;
  forecastRowIds: string[];
  project: string;
  customer: string;
  doSoNumber: string;
  farm: string;
  farmId: number;
  grass: string;
  productId: number;
  harvestType: string;
  harvestDate: string;
  harvestDateSource: string;
  regrowthDate: string;
  regrowthDays: number;
  dbZone: string;
  mappedZones: string[];
  rawQty: number;
  rawUom: string;
  m2ConversionRows: M2ConversionRow[];
  normalizedKg: number;
  creditedKg: number;
  notCountedKg: number;
  spreadKg: number;
  hasCappedFragment: boolean;
  notes: string[];
};

type M2ConversionRow = {
  forecastRowId: string;
  zoneLabel: string;
  rawM2: number;
  inputM2: number;
  kgPerM2: number;
  multipliedKg: number;
  normalizedKg: number;
  maxKg: number;
  configSizeM2: number;
  configSizeCapacityKg: number;
  configIds: string[];
  configCount: number;
  sourceNote: string;
  overMaxKg: number;
};

type ZoneAuditRow = {
  key: string;
  farm: string;
  grass: string;
  farmId: number;
  productId: number;
  zoneLabel: string;
  capKg: number;
  grossZonedKg: number;
  fromBlankZoneKg: number;
  creditedZonedKg: number;
  nozoneFillKg: number;
  creditedTotalKg: number;
  overflowKg: number;
};

type FarmProductAuditRow = {
  key: string;
  farm: string;
  grass: string;
  farmId: number;
  productId: number;
  capKg: number;
  totalGrossKg: number;
  creditedKg: number;
  overlimitKg: number;
  sourceCount: number;
};

type DailyZoneConfigConversionRow = {
  zoneLabel: string;
  inputM2: number;
  kgPerM2: number;
  multipliedKg: number;
  normalizedKg: number;
  maxKg: number;
  configSizeM2: number;
  configSizeCapacityKg: number;
  configIds: string[];
  configCount: number;
  sourceNotes: string[];
  overMaxKg: number;
};

type DevZoneTimelineRow = {
  zoneKey: string;
  farmName: string;
  turfgrass: string;
  zone: string;
  sizeM2: number;
  maxKg: number;
};

type DailyRegrowthTimelineRow = {
  date: string;
  grossKg: number;
  creditedKg: number;
  notCountedKg: number;
  cumulativeKg: number;
  sourceCount: number;
  harvestDates: string[];
  zoneConfigConversions: DailyZoneConfigConversionRow[];
  planIds: string[];
  zones: string[];
  barPercent: number;
};

type RegrowthScheduleEntry = {
  dateYmd: string;
  days: number;
  harvestType: string;
};

type DevForecastCalendarHarvestPlan = {
  planId: string;
  project: string;
  customer: string;
  rawQty: number;
  rawUom: string;
  kg: number;
  zones: string[];
  regrowthDates: string[];
  regrowthSchedule: RegrowthScheduleEntry[];
};

type DevForecastCalendarDay = {
  date: string;
  isToday: boolean;
  previousAvailable: number;
  harvestKg: number;
  harvestPlanCount: number;
  harvestPlanIds: string[];
  harvestPlans: DevForecastCalendarHarvestPlan[];
  regrowthKg: number;
  regrowthTimeline: DailyRegrowthTimelineRow | null;
  regrowthSources: SourceAuditRow[];
  regrowthFragmentCount: number;
  regrowthEngineCreditedKg: number;
  available: number;
  calculatedAvailable: number;
  overlimit: number;
  overrideCount: number;
  hint: InventoryAvailableHintModel;
};

type AvailableSourceAudit = {
  totalGrossKg: number;
  totalCreditedKg: number;
  totalOverlimitKg: number;
  sourceRows: SourceAuditRow[];
  zoneRows: ZoneAuditRow[];
  farmProductRows: FarmProductAuditRow[];
};

type FragmentCredit = {
  row: ForecastHarvestRow;
  qtyKg: number;
  creditKg: number;
  reason: "direct-zone" | "nozone-pool" | "no-zone-config";
};

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function diffDaysInclusive(start: Date, end: Date): number {
  const startMs = startOfLocalDay(start).getTime();
  const endMs = startOfLocalDay(end).getTime();
  return Math.max(1, Math.floor((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1);
}

function ymdFromDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseYmdLocal(value: string): Date | null {
  const m = String(value ?? "").trim().slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatShortDate(ymd: string | null | undefined): string {
  if (!ymd) return "";
  const m = String(ymd).trim().slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(ymd);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function levelBarColor(pct: number): string {
  if (pct > 70) return "hsl(152,55%,36%)";
  if (pct > 40) return "hsl(35,92%,52%)";
  return "hsl(0,72%,51%)";
}

function formatSignedKg(value: number, sign: "+" | "−" | ""): string {
  const n = Math.round(Math.abs(Number.isFinite(value) ? value : 0));
  if (n === 0) return "—";
  if (sign === "+") return `+${n.toLocaleString()} kg`;
  if (sign === "−") return `−${n.toLocaleString()} kg`;
  return `${n.toLocaleString()} kg`;
}

function ZoneBalanceStepCell({
  snapshot,
  kind,
}: {
  snapshot: ZoneInventoryDaySnapshot;
  kind: "previous" | "regrowth" | "harvest" | "system" | "manual" | "display";
}) {
  switch (kind) {
    case "previous":
      return (
        <div className="tabular-nums text-slate-700">
          {formatNumber(snapshot.previousKg)}
          {snapshot.isOpeningDay ? (
            <p className="mt-0.5 text-[10px] text-slate-400">open @ max</p>
          ) : null}
        </div>
      );
    case "regrowth":
      return (
        <div
          className={`tabular-nums ${
            snapshot.regrowthKg > 0 ? "font-medium text-emerald-700" : "text-slate-400"
          }`}
        >
          {formatSignedKg(snapshot.regrowthKg, "+")}
        </div>
      );
    case "harvest":
      return (
        <div
          className={`tabular-nums ${
            snapshot.harvestKg > 0 ? "font-medium text-amber-800" : "text-slate-400"
          }`}
        >
          {formatSignedKg(snapshot.harvestKg, "−")}
        </div>
      );
    case "system":
      return (
        <div>
          {snapshot.exactManualSetToday && snapshot.rollingBeforeManualSetKg != null ? (
            <p className="text-[10px] text-slate-500">
              {formatNumber(snapshot.previousKg)}
              {snapshot.regrowthKg > 0 ? ` + ${formatNumber(snapshot.regrowthKg)}` : ""}
              {snapshot.harvestKg > 0 ? ` − ${formatNumber(snapshot.harvestKg)}` : ""}
              {" = "}
              {formatNumber(snapshot.rollingBeforeManualSetKg)}
            </p>
          ) : null}
          <p className="font-semibold tabular-nums text-slate-900">
            {formatNumber(snapshot.calculatedKg)}
          </p>
          {snapshot.exactManualSetToday ? (
            <p className="mt-0.5 text-[10px] font-medium text-amber-800">
              manual set → chain {formatNumber(snapshot.calculatedKg)}
            </p>
          ) : (
            <p className="mt-0.5 text-[10px] text-slate-500">System</p>
          )}
        </div>
      );
    case "manual":
      if (!snapshot.isManualOverrideActive || snapshot.manualOverrideKg == null) {
        return <span className="text-slate-400">—</span>;
      }
      return (
        <div>
          <div className="flex items-center justify-center gap-1">
            <span className="font-medium tabular-nums text-amber-900">
              {formatNumber(snapshot.manualOverrideKg)}
            </span>
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">
              Manual
            </span>
          </div>
          <p className="mt-0.5 text-[10px] text-slate-500">
            {snapshot.exactManualSetToday
              ? "saved today"
              : snapshot.manualOverrideDate
                ? `since ${formatShortDate(snapshot.manualOverrideDate)}`
                : "configured"}
          </p>
          {!snapshot.exactManualSetToday ? (
            <p className="mt-0.5 text-[10px] text-slate-400">
              display fixed · system rolls on
            </p>
          ) : null}
        </div>
      );
    case "display":
      return (
        <div>
          <div className="flex items-center justify-center gap-1">
            <span className="font-semibold tabular-nums text-slate-900">
              {formatNumber(snapshot.effectiveKg)}
            </span>
            {snapshot.isManualOverrideActive ? (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">
                Manual
              </span>
            ) : null}
          </div>
          {snapshot.isManualOverrideActive ? (
            <p className="mt-0.5 text-[10px] text-slate-500">
              System {formatNumber(snapshot.calculatedKg)} kg
            </p>
          ) : null}
          <div className="mt-1.5 flex items-center gap-1 px-0.5">
            <div className="h-1.5 flex-1 rounded-full bg-slate-100">
              <div
                className="h-1.5 rounded-full"
                style={{
                  width: `${Math.min(100, snapshot.pct)}%`,
                  backgroundColor: levelBarColor(snapshot.pct),
                }}
              />
            </div>
            <span className="w-7 text-right text-[10px] tabular-nums text-slate-500">
              {snapshot.pct}%
            </span>
          </div>
        </div>
      );
  }
}

const ZONE_BALANCE_STEPS = [
  { key: "previous", label: "Previous" },
  { key: "regrowth", label: "+ Regrowth" },
  { key: "harvest", label: "− Harvest" },
  { key: "system", label: "= System" },
  { key: "manual", label: "Manual balance" },
  { key: "display", label: "Display" },
] as const;

function toDisplayDate(ymd: string): string {
  const d = parseYmdLocal(ymd);
  if (!d) return ymd || "-";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function formatWeekdayShort(ymd: string): string {
  const d = parseYmdLocal(ymd);
  if (!d) return "";
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

function toText(value: unknown): string {
  return String(value ?? "").trim();
}

function formatKg(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  return `${Math.round(n).toLocaleString()} kg`;
}

function formatPlanQty(value: number, uom: string): string {
  const unit = String(uom ?? "").trim();
  return `${formatNumber(value)}${unit ? ` ${unit}` : ""}`;
}

function formatNumber(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  return Math.round(n).toLocaleString();
}

function formatM2(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  return `${Math.round(n).toLocaleString()} m²`;
}

function formatDecimal(value: number, digits = 2): string {
  const n = Number.isFinite(value) ? value : 0;
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function formatKgPerM2(value: number): string {
  return `${formatDecimal(value, 3)} kg/m²`;
}

function toNum(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function rowInventoryKg(row: ForecastHarvestRow): number {
  return forecastHarvestRowInventoryKg(row);
}

function harvestYmdFromRow(row: ForecastHarvestRow): string | null {
  const ymd = String(row.harvestDate ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}

function isHarvestDateInYmdRange(
  row: ForecastHarvestRow,
  startYmd: string,
  endYmd: string,
): boolean {
  const harvestYmd = harvestYmdFromRow(row);
  if (!harvestYmd) return false;
  return harvestYmd >= startYmd && harvestYmd <= endYmd;
}

function sumAvailableByZone(availableByZone: Map<string, number>): number {
  return Array.from(availableByZone.values()).reduce((sum, kg) => sum + kg, 0);
}

function isM2Uom(value: string): boolean {
  const u = String(value ?? "").trim().toLowerCase().replace(/\s/g, "").replace(/²/g, "2");
  return (
    u === "m2" ||
    u === "sqm" ||
    u === "sq.m" ||
    u === "squaremeter" ||
    u === "squaremeters"
  );
}

function isNozoneLabel(value: string): boolean {
  const s = String(value ?? "").trim().toLowerCase().replace(/_/g, "-").replace(/\s+/g, " ");
  return !s || s === FORECAST_NOZONE_ZONE || s === "no-zone" || s === "no zone";
}

function zoneBucketKey(value: string): string {
  const s = String(value ?? "").trim().toLowerCase().replace(/_/g, "-").replace(/\s+/g, " ");
  return isNozoneLabel(s) ? FORECAST_NOZONE_ZONE : s;
}

type ZoneConfigBucket = {
  zoneRaw: string;
  sizeM2: number;
  kgPerM2: number;
  maxKg: number;
  sizeCapacityKg: number;
  configIds: string[];
  count: number;
};

function zoneConfigMaxKg(row: ZoneConfigurationRow): number {
  const maxKg = toNum(row.max_inventory_kg);
  if (maxKg > 0) return maxKg;
  const sizeM2 = toNum(row.size_m2);
  const kgPerM2 = toNum(row.inventory_kg_per_m2);
  const fromSize = sizeM2 * kgPerM2;
  return fromSize > 0 ? fromSize : DEFAULT_FALLBACK_MAX_INVENTORY_KG;
}

function buildZoneConfigBucketsForFarmGrass(
  zoneConfigs: ZoneConfigurationRow[],
  farmId: number,
  productId: number,
): Map<string, ZoneConfigBucket> {
  const out = new Map<string, ZoneConfigBucket>();
  for (const cfg of zoneConfigs) {
    if (Number(cfg.farm_id) !== farmId || Number(cfg.grass_id) !== productId) continue;
    const zoneRaw = String(cfg.zone ?? "").trim() || FORECAST_NOZONE_ZONE;
    const key = zoneBucketKey(zoneRaw);
    const sizeM2 = toNum(cfg.size_m2);
    const kgPerM2Raw = toNum(cfg.inventory_kg_per_m2);
    const kgPerM2 =
      kgPerM2Raw > 0 ? kgPerM2Raw : DEFAULT_FALLBACK_INVENTORY_KG_PER_M2;
    const maxKg = zoneConfigMaxKg(cfg);
    const sizeCapacityKg = sizeM2 * kgPerM2;
    const prev = out.get(key);
    if (!prev) {
      out.set(key, {
        zoneRaw,
        sizeM2,
        kgPerM2,
        maxKg,
        sizeCapacityKg,
        configIds: [String(cfg.id)],
        count: 1,
      });
      continue;
    }
    out.set(key, {
      zoneRaw: prev.zoneRaw,
      sizeM2: prev.sizeM2 + sizeM2,
      kgPerM2: prev.kgPerM2,
      maxKg: prev.maxKg + maxKg,
      sizeCapacityKg: prev.sizeCapacityKg + sizeCapacityKg,
      configIds: [...prev.configIds, String(cfg.id)],
      count: prev.count + 1,
    });
  }
  return out;
}

function averageKgPerM2(buckets: Map<string, ZoneConfigBucket>): number {
  if (buckets.size === 0) return DEFAULT_FALLBACK_INVENTORY_KG_PER_M2;
  let sum = 0;
  for (const bucket of buckets.values()) sum += bucket.kgPerM2;
  return sum / buckets.size;
}

function harvestTypeLabel(type: ForecastHarvestRow["harvestType"]): string {
  if (type === "sod_for_sprig") return "Sod to sprig";
  if (type === "sprig") return "Sprig";
  return "Sod";
}

function formatRegrowthConfigSummaryLines(cfg: RegrowthReferenceConfig): string[] {
  const lines = [
    `Sod: ${cfg.sodDays} days`,
    `Sod to sprig: ${cfg.sodForSprigDays} days`,
  ];
  for (const band of cfg.sprigBands) {
    lines.push(`Sprig ${band.label}: ${band.regrowthDays} days`);
  }
  return lines;
}

function formatHarvestToRegrowthSchedule(
  harvestDate: string,
  harvestDateSource: string,
  regrowthDays: number,
  harvestType: string,
  regrowthDate: string,
): string {
  return [
    `H ${toDisplayDate(harvestDate)} (${harvestDateSource})`,
    `${harvestType} +${regrowthDays}d (config)`,
    `→ RG ${toDisplayDate(regrowthDate)}`,
  ].join(" · ");
}

function uniqueSortedYmds(ymds: string[]): string[] {
  return Array.from(new Set(ymds.filter((ymd) => /^\d{4}-\d{2}-\d{2}$/.test(ymd)))).sort((a, b) =>
    a.localeCompare(b),
  );
}

function formatRegrowthSourceTooltip(source: SourceAuditRow): string {
  const parts = [
    `#${source.planId}`,
    source.project,
    `harvest ${toDisplayDate(source.harvestDate)} (${source.harvestDateSource})`,
    `${source.harvestType} +${source.regrowthDays}d`,
    `RG ${toDisplayDate(source.regrowthDate)}`,
    `credited ${formatKg(source.creditedKg)}`,
  ];
  if (source.m2ConversionRows.length > 0) {
    parts.push(
      source.m2ConversionRows
        .map(
          (line) =>
            `${line.zoneLabel}: ${formatM2(line.inputM2)}×${formatKgPerM2(line.kgPerM2)}=${formatKg(line.multipliedKg)} (${line.sourceNote})`,
        )
        .join("; "),
    );
  } else {
    parts.push(`plan ${formatPlanQty(source.rawQty, source.rawUom)}`);
  }
  if (source.notCountedKg > 0) {
    parts.push(`not counted ${formatKg(source.notCountedKg)}`);
  }
  return parts.filter(Boolean).join(" | ");
}

function RegrowthM2ConversionLines({ lines }: { lines: M2ConversionRow[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="mt-1 rounded border border-amber-200 bg-amber-50 px-1 py-0.5">
      <div className="text-[10px] font-medium text-amber-900">Zone config (m² × kg/m²)</div>
      {lines.map((line) => (
        <div key={line.forecastRowId} className="mt-0.5 text-[10px] text-amber-950">
          <div className="font-semibold">
            {line.zoneLabel}: {formatM2(line.inputM2)} × {formatKgPerM2(line.kgPerM2)} ={" "}
            {formatKg(line.multipliedKg)}
          </div>
          {line.rawM2 > 0 && Math.abs(line.rawM2 - line.inputM2) > 0.5 ? (
            <div className="text-amber-800">plan harvested area {formatM2(line.rawM2)}</div>
          ) : null}
          <div className="text-amber-800">
            {line.sourceNote}
            {line.configIds.length > 0 ? ` · config #${line.configIds.join(", #")}` : ""}
            {line.configSizeM2 > 0
              ? ` · size ${formatM2(line.configSizeM2)} cap ${formatKg(line.configSizeCapacityKg)}`
              : ""}
            · max {formatKg(line.maxKg)}
            {line.overMaxKg > 0 ? ` · over ${formatKg(line.overMaxKg)}` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}

function RegrowthSourceCalendarCard({ source }: { source: SourceAuditRow }) {
  return (
    <div className="rounded border border-emerald-200 bg-white/80 px-1.5 py-1">
      <div className="flex items-center justify-between gap-2 text-[10px] font-semibold text-emerald-900">
        <span className="tabular-nums">#{source.planId}</span>
        <span className="tabular-nums">{formatKg(source.creditedKg)}</span>
      </div>
      <div className="mt-0.5 truncate text-[10px] text-slate-600">
        {source.project || source.customer || "No project"}
      </div>
      <div className="mt-0.5 text-[10px] leading-snug text-slate-700">
        <span className="font-medium">Harvest day:</span> {toDisplayDate(source.harvestDate)}
        <span className="text-slate-500"> ({source.harvestDateSource})</span>
      </div>
      <div className="mt-0.5 text-[10px] leading-snug text-emerald-800">
        <span className="font-medium">Regrowth day:</span> {toDisplayDate(source.regrowthDate)} ·{" "}
        {source.harvestType} +{source.regrowthDays}d (admin config)
      </div>
      <RegrowthM2ConversionLines lines={source.m2ConversionRows} />
      {source.m2ConversionRows.length === 0 ? (
        <div className="mt-0.5 text-[10px] text-slate-600">
          Plan {formatPlanQty(source.rawQty, source.rawUom)} — inventory kg, no m² zone conversion
        </div>
      ) : null}
      {source.notCountedKg > 0 ? (
        <div className="mt-0.5 text-[10px] text-red-700">
          not counted {formatKg(source.notCountedKg)}
        </div>
      ) : null}
    </div>
  );
}

function rawPlanLabel(raw: Record<string, unknown> | undefined, fallback: string): string {
  const id = toText(raw?.id);
  return id || fallback;
}

function rawProjectLabel(raw: Record<string, unknown> | undefined, fallback: string | undefined): string {
  return (
    toText(raw?.project_name) ||
    toText(raw?.project) ||
    toText(raw?.project_id) ||
    toText(fallback)
  );
}

function rawCustomerLabel(raw: Record<string, unknown> | undefined, fallback: string | undefined): string {
  return toText(raw?.customer_name) || toText(raw?.customer) || toText(fallback);
}

function rawZoneLabel(raw: Record<string, unknown> | undefined): string {
  return toText(raw?.zone) || FORECAST_NOZONE_ZONE;
}

function isValidDbDate(value: unknown): boolean {
  const s = toText(value);
  return Boolean(s && s !== "0000-00-00");
}

function dbHarvestDateSource(raw: Record<string, unknown> | undefined): string {
  if (isValidDbDate(raw?.actual_harvest_date)) return "actual_harvest_date";
  if (isValidDbDate(raw?.estimated_harvest_date)) return "estimated_harvest_date";
  return "mapped harvestDate";
}

function buildM2ConversionRow(params: {
  row: ForecastHarvestRow;
  raw: Record<string, unknown> | undefined;
  zoneConfigs: ZoneConfigurationRow[];
  zoneLabel: (zone: string) => string;
}): M2ConversionRow | null {
  const { row, raw, zoneConfigs, zoneLabel } = params;
  const rawUom = raw ? resolvePlanRowUomFromRaw(raw) : String(row.uom ?? "");
  const usesM2Magnitude = raw
    ? planRowUsesHarvestedAreaForMagnitude(raw) || isM2Uom(rawUom)
    : forecastHarvestRowUsesHarvestedAreaForMagnitude(row) || isM2Uom(rawUom);
  if (!usesM2Magnitude) return null;

  const rawM2 = raw
    ? harvestPlanEffectiveMagnitudeFromRaw(raw)
    : forecastHarvestRowEffectiveM2(row);
  if (rawM2 <= 0) return null;

  const mappedZone = String(row.zone ?? "").trim() || FORECAST_NOZONE_ZONE;
  const mappedBucketKey = zoneBucketKey(mappedZone);
  const buckets = buildZoneConfigBucketsForFarmGrass(zoneConfigs, row.farmId, row.productId);
  const bucket = buckets.get(mappedBucketKey);
  const rawDbZone = rawZoneLabel(raw);
  const rawDbZoneIsBlank = isNozoneLabel(rawDbZone);
  const normalizedKg = rowInventoryKg(row);
  const zone1KgPerM2 =
    row.farmId > 0 && row.productId > 0
      ? resolveZone1InventoryKgPerM2({
          zoneConfigs,
          farmId: row.farmId,
          productId: row.productId,
          buckets,
        })
      : null;
  const kgPerM2 =
    bucket?.kgPerM2 ??
    (rawDbZoneIsBlank && zone1KgPerM2 != null && zone1KgPerM2 > 0
      ? zone1KgPerM2
      : DEFAULT_FALLBACK_INVENTORY_KG_PER_M2);
  const inputM2 =
    rawDbZoneIsBlank && normalizedKg > 0 && kgPerM2 > 0
      ? normalizedKg / kgPerM2
      : rawM2;
  const multipliedKg = inputM2 * kgPerM2;
  const maxKg =
    bucket?.maxKg ??
    (Number.isFinite(row.zoneMaxInventoryKg) && row.zoneMaxInventoryKg > 0
      ? row.zoneMaxInventoryKg
      : DEFAULT_FALLBACK_MAX_INVENTORY_KG);
  const sourceNote = bucket
    ? bucket.count > 1
      ? `${bucket.count} zone config rows combined`
      : `zone config #${bucket.configIds[0]}`
    : "fallback kg/m²";

  return {
    forecastRowId: row.id,
    zoneLabel: zoneLabel(mappedZone),
    rawM2,
    inputM2,
    kgPerM2,
    multipliedKg,
    normalizedKg,
    maxKg,
    configSizeM2: bucket?.sizeM2 ?? 0,
    configSizeCapacityKg: bucket?.sizeCapacityKg ?? 0,
    configIds: bucket?.configIds ?? [],
    configCount: bucket?.count ?? 0,
    sourceNote: rawDbZoneIsBlank
      ? `${sourceNote}; DB zone blank/nozone, kg allocated by zone headroom`
      : sourceNote,
    overMaxKg: Math.max(0, multipliedKg - maxKg),
  };
}

function distributeCreditAcrossFragments(
  fragments: ForecastHarvestRow[],
  totalCreditKg: number,
  reason: FragmentCredit["reason"],
): FragmentCredit[] {
  const positive = fragments
    .map((row) => ({ row, qtyKg: Math.max(0, rowInventoryKg(row)) }))
    .filter((item) => item.qtyKg > 0);
  if (positive.length === 0 || totalCreditKg <= 0) {
    return positive.map((item) => ({ ...item, creditKg: 0, reason }));
  }

  const totalQty = positive.reduce((sum, item) => sum + item.qtyKg, 0);
  let allocated = 0;
  return positive.map((item, index) => {
    const credit =
      index === positive.length - 1
        ? Math.max(0, totalCreditKg - allocated)
        : Math.min(item.qtyKg, totalCreditKg * (item.qtyKg / totalQty));
    allocated += credit;
    return { ...item, creditKg: credit, reason };
  });
}

function addSourceContribution(params: {
  sourceMap: Map<string, SourceAuditRow>;
  credit: FragmentCredit;
  rawByPlanId: Map<string, Record<string, unknown>>;
  regrowthConfig: RegrowthReferenceConfig;
  zoneConfigs: ZoneConfigurationRow[];
  zoneLabel: (zone: string) => string;
}) {
  const { sourceMap, credit, rawByPlanId, regrowthConfig, zoneConfigs, zoneLabel } = params;
  const row = credit.row;
  const planId = forecastLogicalPlanRowId(row.id);
  const raw = rawByPlanId.get(planId);
  const regrowthDate = getRegrowthDateFromHarvest(row, regrowthConfig);
  const regrowthYmd = regrowthDate ? ymdFromDate(regrowthDate) : "";
  const dbZone = rawZoneLabel(raw);
  const mappedZone = String(row.zone ?? "").trim() || FORECAST_NOZONE_ZONE;
  const spreadKg = Math.max(
    0,
    Number.isFinite(row.inventoryKgFromNozoneSpread)
      ? Number(row.inventoryKgFromNozoneSpread)
      : 0,
  );
  const rawQty = raw ? harvestPlanQuantityFromRaw(raw) : row.quantity;
  const rawUom = raw ? resolvePlanRowUom(raw) : String(row.uom ?? "");

  const existing = sourceMap.get(planId);
  const next: SourceAuditRow =
    existing ??
    {
      planId: rawPlanLabel(raw, planId),
      forecastRowIds: [],
      project: rawProjectLabel(raw, row.project),
      customer: rawCustomerLabel(raw, row.customer),
      doSoNumber: toText(raw?.do_so_number),
      farm: row.farm,
      farmId: row.farmId,
      grass: row.grassType,
      productId: row.productId,
      harvestType: harvestTypeLabel(row.harvestType),
      harvestDate: row.harvestDate,
      harvestDateSource: dbHarvestDateSource(raw),
      regrowthDate: regrowthYmd,
      regrowthDays: computeRegrowthDaysForHarvest(regrowthConfig, row),
      dbZone,
      mappedZones: [],
      rawQty,
      rawUom,
      m2ConversionRows: [],
      normalizedKg: 0,
      creditedKg: 0,
      notCountedKg: 0,
      spreadKg: 0,
      hasCappedFragment: false,
      notes: [],
    };

  next.forecastRowIds.push(row.id);
  if (!next.mappedZones.includes(mappedZone)) next.mappedZones.push(mappedZone);
  const conversionRow = buildM2ConversionRow({ row, raw, zoneConfigs, zoneLabel });
  if (
    conversionRow &&
    !next.m2ConversionRows.some((item) => item.forecastRowId === conversionRow.forecastRowId)
  ) {
    next.m2ConversionRows.push(conversionRow);
  }
  next.normalizedKg += credit.qtyKg;
  next.creditedKg += credit.creditKg;
  next.notCountedKg += Math.max(0, credit.qtyKg - credit.creditKg);
  next.spreadKg += spreadKg;
  next.hasCappedFragment = next.hasCappedFragment || row.inventoryIsCapped;
  if (credit.reason === "no-zone-config" && !next.notes.includes("No zone config: gross kg counted in nozone bucket")) {
    next.notes.push("No zone config: gross kg counted in nozone bucket");
  }
  if (credit.reason === "nozone-pool" && !next.notes.includes("Blank/nozone pool filled remaining zone headroom")) {
    next.notes.push("Blank/nozone pool filled remaining zone headroom");
  }
  if (spreadKg > 0 && !next.notes.includes("DB zone blank, mapped into configured zone before regrowth")) {
    next.notes.push("DB zone blank, mapped into configured zone before regrowth");
  }
  if (row.inventoryIsCapped && !next.notes.includes("Fragment exceeds configured capacity")) {
    next.notes.push("Fragment exceeds configured capacity");
  }

  sourceMap.set(planId, next);
}

/** Regrowth credit breakdown for a fixed set of rows (same RG day or cumulative audit slice). */
function buildRegrowthSourceAudit(params: {
  rows: ForecastHarvestRow[];
  rawByPlanId: Map<string, Record<string, unknown>>;
  regrowthConfig: RegrowthReferenceConfig;
  asOf: Date;
  zoneConfigs: ZoneConfigurationRow[];
  zoneLabel: (zone: string) => string;
}): AvailableSourceAudit {
  const { rows, rawByPlanId, regrowthConfig, asOf, zoneConfigs, zoneLabel } = params;
  const maxByZone = mergeZoneCapacityMapsAtDate(rows, zoneConfigs, asOf);
  const groups = new Map<string, ForecastHarvestRow[]>();

  for (const row of rows) {
    const key = `${row.farmId}|${row.productId}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const sourceMap = new Map<string, SourceAuditRow>();
  const zoneRows: ZoneAuditRow[] = [];
  const farmProductRows: FarmProductAuditRow[] = [];
  let totalGrossKg = 0;
  let totalCreditedKg = 0;
  let totalOverlimitKg = 0;

  for (const [groupKey, groupRows] of groups) {
    const first = groupRows[0];
    if (!first) continue;

    const capKg = sumConfiguredZoneCapKgForFarmProduct(maxByZone, first.farmId, first.productId);
    const allocation = computeRegrowthAllocationForFarmProductDate({
      farmId: first.farmId,
      productId: first.productId,
      maxByZone,
      fragments: groupRows.map((row) => ({
        zoneKey: forecastZoneKeyFromRow(row),
        zoneLabel: String(row.zone ?? "").trim() || FORECAST_NOZONE_ZONE,
        qty: rowInventoryKg(row),
        inventoryKgFromNozoneSpread: row.inventoryKgFromNozoneSpread,
      })),
    });
    const hasConfiguredZones = capKg > 0;
    const groupGross = allocation.totalGrossKg;
    const groupCredited = hasConfiguredZones ? allocation.totalCreditedMappedKg : groupGross;
    const groupOverlimit = hasConfiguredZones ? allocation.overflowUncreditedKg : 0;

    totalGrossKg += groupGross;
    totalCreditedKg += groupCredited;
    totalOverlimitKg += groupOverlimit;
    farmProductRows.push({
      key: groupKey,
      farm: first.farm,
      grass: first.grassType,
      farmId: first.farmId,
      productId: first.productId,
      capKg,
      totalGrossKg: groupGross,
      creditedKg: groupCredited,
      overlimitKg: groupOverlimit,
      sourceCount: new Set(groupRows.map((row) => forecastLogicalPlanRowId(row.id))).size,
    });

    if (!hasConfiguredZones) {
      for (const credit of distributeCreditAcrossFragments(groupRows, groupGross, "no-zone-config")) {
        addSourceContribution({
          sourceMap,
          credit,
          rawByPlanId,
          regrowthConfig,
          zoneConfigs,
          zoneLabel,
        });
      }
      continue;
    }

    for (const zoneBreakdown of allocation.zoneBreakdowns) {
      const zoneFragments = groupRows.filter((row) => forecastZoneKeyFromRow(row) === zoneBreakdown.zoneKey);
      const directCredits = distributeCreditAcrossFragments(
        zoneFragments,
        zoneBreakdown.creditedZonedKg,
        "direct-zone",
      );
      for (const credit of directCredits) {
        addSourceContribution({
          sourceMap,
          credit,
          rawByPlanId,
          regrowthConfig,
          zoneConfigs,
          zoneLabel,
        });
      }

      zoneRows.push({
        key: zoneBreakdown.zoneKey,
        farm: first.farm,
        grass: first.grassType,
        farmId: first.farmId,
        productId: first.productId,
        zoneLabel: zoneLabel(zoneBreakdown.zoneLabel),
        capKg: zoneBreakdown.capKg,
        grossZonedKg: zoneBreakdown.grossZonedKg,
        fromBlankZoneKg: zoneBreakdown.grossZonedFromNozoneSpreadKg,
        creditedZonedKg: zoneBreakdown.creditedZonedKg,
        nozoneFillKg: zoneBreakdown.nozoneFillKg,
        creditedTotalKg: zoneBreakdown.creditedTotalKg,
        overflowKg: zoneBreakdown.zoneOverflowKg,
      });
    }

    const nozonePoolRows = groupRows.filter((row) => isNozoneLabel(String(row.zone ?? "")));
    const nozoneFillKg = allocation.zoneBreakdowns.reduce((sum, row) => sum + row.nozoneFillKg, 0);
    for (const credit of distributeCreditAcrossFragments(nozonePoolRows, nozoneFillKg, "nozone-pool")) {
      addSourceContribution({
        sourceMap,
        credit,
        rawByPlanId,
        regrowthConfig,
        zoneConfigs,
        zoneLabel,
      });
    }
  }

  return {
    totalGrossKg,
    totalCreditedKg,
    totalOverlimitKg,
    sourceRows: Array.from(sourceMap.values()).sort((a, b) => {
      const credited = b.creditedKg - a.creditedKg;
      if (credited !== 0) return credited;
      const dateCmp = a.regrowthDate.localeCompare(b.regrowthDate);
      if (dateCmp !== 0) return dateCmp;
      return a.planId.localeCompare(b.planId);
    }),
    zoneRows: zoneRows.sort((a, b) => {
      const farm = a.farm.localeCompare(b.farm);
      if (farm !== 0) return farm;
      const grass = a.grass.localeCompare(b.grass);
      if (grass !== 0) return grass;
      return a.zoneLabel.localeCompare(b.zoneLabel);
    }),
    farmProductRows: farmProductRows.sort((a, b) => b.creditedKg - a.creditedKg),
  };
}

function buildAvailableSourceAudit(params: {
  rows: ForecastHarvestRow[];
  rawByPlanId: Map<string, Record<string, unknown>>;
  regrowthConfig: RegrowthReferenceConfig;
  forecastDate: Date;
  zoneConfigs: ZoneConfigurationRow[];
  zoneLabel: (zone: string) => string;
}): AvailableSourceAudit {
  const { rows, regrowthConfig, forecastDate, ...rest } = params;
  const eligibleRows = rows.filter((row) => {
    const regrowthDate = getRegrowthDateFromHarvest(row, regrowthConfig);
    return regrowthDate != null && regrowthDate <= forecastDate;
  });
  return buildRegrowthSourceAudit({ rows: eligibleRows, asOf: forecastDate, regrowthConfig, ...rest });
}

function aggregateDailyRegrowthTimeline(
  sourceRows: SourceAuditRow[],
  zoneLabel: (zone: string) => string,
): DailyRegrowthTimelineRow[] {
  const byDate = new Map<
    string,
    {
      date: string;
      grossKg: number;
      creditedKg: number;
      notCountedKg: number;
      sourceCount: number;
      harvestDates: Set<string>;
      conversions: Map<string, DailyZoneConfigConversionRow>;
      planIds: Set<string>;
      zones: Set<string>;
    }
  >();

  for (const row of sourceRows) {
    const date = row.regrowthDate;
    if (!date) continue;
    const cur =
      byDate.get(date) ??
      {
        date,
        grossKg: 0,
        creditedKg: 0,
        notCountedKg: 0,
        sourceCount: 0,
        harvestDates: new Set<string>(),
        conversions: new Map<string, DailyZoneConfigConversionRow>(),
        planIds: new Set<string>(),
        zones: new Set<string>(),
      };
    cur.grossKg += row.normalizedKg;
    cur.creditedKg += row.creditedKg;
    cur.notCountedKg += row.notCountedKg;
    cur.sourceCount += 1;
    cur.harvestDates.add(
      [
        row.harvestDate,
        row.harvestDateSource,
        String(row.regrowthDays),
        row.harvestType,
        row.regrowthDate,
      ].join("|"),
    );
    cur.planIds.add(row.planId);
    for (const zone of row.mappedZones) cur.zones.add(zoneLabel(zone));
    for (const line of row.m2ConversionRows) {
      const conversionKey = [
        line.zoneLabel,
        line.kgPerM2,
        line.configIds.join(","),
        line.sourceNote,
      ].join("|");
      const prev =
        cur.conversions.get(conversionKey) ??
        {
          zoneLabel: line.zoneLabel,
          inputM2: 0,
          kgPerM2: line.kgPerM2,
          multipliedKg: 0,
          normalizedKg: 0,
          maxKg: line.maxKg,
          configSizeM2: line.configSizeM2,
          configSizeCapacityKg: line.configSizeCapacityKg,
          configIds: [],
          configCount: 0,
          sourceNotes: [],
          overMaxKg: 0,
        };
      prev.inputM2 += line.inputM2;
      prev.multipliedKg += line.multipliedKg;
      prev.normalizedKg += line.normalizedKg;
      prev.maxKg = Math.max(prev.maxKg, line.maxKg);
      prev.configSizeM2 = Math.max(prev.configSizeM2, line.configSizeM2);
      prev.configSizeCapacityKg = Math.max(
        prev.configSizeCapacityKg,
        line.configSizeCapacityKg,
      );
      prev.configIds = Array.from(new Set([...prev.configIds, ...line.configIds]));
      prev.configCount = Math.max(prev.configCount, line.configCount);
      if (!prev.sourceNotes.includes(line.sourceNote)) {
        prev.sourceNotes.push(line.sourceNote);
      }
      prev.overMaxKg = Math.max(0, prev.multipliedKg - prev.maxKg);
      cur.conversions.set(conversionKey, prev);
    }
    byDate.set(date, cur);
  }

  const sorted = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  const maxCreditedKg = sorted.reduce((max, row) => Math.max(max, row.creditedKg), 0);
  let cumulativeKg = 0;
  return sorted.map((row) => {
    cumulativeKg += row.creditedKg;
    return {
      date: row.date,
      grossKg: row.grossKg,
      creditedKg: row.creditedKg,
      notCountedKg: row.notCountedKg,
      cumulativeKg,
      sourceCount: row.sourceCount,
      harvestDates: Array.from(row.harvestDates)
        .sort((a, b) => a.localeCompare(b))
        .map((item) => {
          const [harvestDate, source, days, harvestType, regrowthDate] = item.split("|");
          if (days && harvestType && regrowthDate) {
            return formatHarvestToRegrowthSchedule(
              harvestDate ?? "",
              source ?? "harvestDate",
              Number.parseInt(days, 10) || 0,
              harvestType,
              regrowthDate,
            );
          }
          return `${toDisplayDate(harvestDate ?? "")} (${source ?? "harvestDate"})`;
        }),
      zoneConfigConversions: Array.from(row.conversions.values()).sort((a, b) =>
        a.zoneLabel.localeCompare(b.zoneLabel),
      ),
      planIds: Array.from(row.planIds).sort((a, b) => a.localeCompare(b)),
      zones: Array.from(row.zones).sort((a, b) => a.localeCompare(b)),
      barPercent:
        maxCreditedKg > 0 && row.creditedKg > 0
          ? Math.max(2, Math.min(100, (row.creditedKg / maxCreditedKg) * 100))
          : 0,
    };
  });
}

function SummaryTile({
  label,
  value,
  sub,
  tone = "slate",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "slate" | "green" | "amber" | "red";
}) {
  const toneClass = {
    slate: "border-slate-200 bg-white text-slate-900",
    green: "border-emerald-200 bg-emerald-50 text-emerald-950",
    amber: "border-amber-200 bg-amber-50 text-amber-950",
    red: "border-red-200 bg-red-50 text-red-950",
  }[tone];
  return (
    <div className={`rounded-lg border p-4 ${toneClass}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      {sub ? <p className="mt-1 text-xs text-slate-600">{sub}</p> : null}
    </div>
  );
}

export function DevForecastingAvailableSourceClient() {
  const router = useRouter();
  const farmZones = useHarvestingDataStore((s) => s.farmZones);
  const farmsRaw = useHarvestingDataStore((s) => s.farms);
  const grasses = useHarvestingDataStore((s) => s.grasses);
  const fetchAllHarvestingReferenceData = useHarvestingDataStore(
    (s) => s.fetchAllHarvestingReferenceData,
  );
  const referenceBootstrapDone = useHarvestingDataStore((s) => s.bootstrapDone);
  const harvestListGrassFilter = useHarvestingDataStore((s) => s.harvestListGrassFilter);
  const setHarvestListGrassFilter = useHarvestingDataStore((s) => s.setHarvestListGrassFilter);
  const overridesByZone = useInventoryAvailableOverrideStore((s) => s.overridesByZone);
  const fetchOverrides = useInventoryAvailableOverrideStore((s) => s.fetchOverrides);
  const { selectedFarmIds, selectedFarmIdSet, setSelectedFarmIds, farmOptions } =
    useSyncedFarmMultiSelect();

  const [forecastDate, setForecastDate] = useState(() => ymdFromDate(startOfLocalDay(new Date())));
  const [forecastEndDate, setForecastEndDate] = useState(() =>
    ymdFromDate(addMonths(startOfLocalDay(new Date()), 6)),
  );
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [rows, setRows] = useState<ForecastHarvestRow[]>([]);
  const [zoneConfigs, setZoneConfigs] = useState<ZoneConfigurationRow[]>([]);
  const [regrowthConfig, setRegrowthConfig] = useState<RegrowthReferenceConfig>(
    DEFAULT_REGROWTH_REFERENCE_CONFIG,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const selectedGrassIds = useMemo(
    () => parseCsvList(harvestListGrassFilter),
    [harvestListGrassFilter],
  );
  const selectedGrassIdSet = useMemo(() => new Set(selectedGrassIds), [selectedGrassIds]);
  const setSelectedGrassIds = useCallback(
    (ids: string[]) => setHarvestListGrassFilter(toCsvList(ids)),
    [setHarvestListGrassFilter],
  );

  const zoneLabel = useCallback(
    (zoneId: string) => zoneIdToLabelResolved(zoneId, farmZones, "No zone"),
    [farmZones],
  );

  const forecastDateObj = useMemo(
    () => parseYmdLocal(forecastDate) ?? startOfLocalDay(new Date()),
    [forecastDate],
  );
  const horizonEndDateObj = useMemo(
    () => parseYmdLocal(forecastEndDate) ?? addMonths(forecastDateObj, 6),
    [forecastDateObj, forecastEndDate],
  );
  const horizonEndYmd = useMemo(() => ymdFromDate(horizonEndDateObj), [horizonEndDateObj]);
  const forecastStartYmd = useMemo(() => ymdFromDate(forecastDateObj), [forecastDateObj]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const today = startOfLocalDay(new Date());
      const from = ymdFromDate(addMonths(today, -24));
      const to = ymdFromDate(addMonths(today, 30));
      const farms = useHarvestingDataStore.getState().farms;
      const [harvestRes, nextZoneConfigs, rules] = await Promise.all([
        fetchHarvestRowsForForecasting({
          actual_harvest_date_from: from,
          actual_harvest_date_to: to,
          perPage: 500,
          maxPages: 400,
          farms,
        }),
        fetchZoneConfigurations(),
        fetchRegrowthRules(),
      ]);
      const mapped = rowsToMockHarvestRows(harvestRes.rows, today, nextZoneConfigs);
      setRawRows(harvestRes.rows);
      setRows(mapped);
      setZoneConfigs(nextZoneConfigs);
      setRegrowthConfig(resolveRegrowthReferenceConfigFromRules(rules));
      setError(harvestRes.error ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load forecasting source rows.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAllHarvestingReferenceData();
  }, [fetchAllHarvestingReferenceData]);

  useEffect(() => {
    void fetchOverrides();
  }, [fetchOverrides]);

  useEffect(() => {
    if (!referenceBootstrapDone) return;
    void loadData();
  }, [loadData, referenceBootstrapDone]);

  const rawByPlanId = useMemo(() => {
    const out = new Map<string, Record<string, unknown>>();
    for (const row of rawRows) {
      const id = toText(row.id);
      if (id) out.set(id, row);
    }
    return out;
  }, [rawRows]);

  const grassFilterOptions = useMemo(() => {
    const picked = pickGrassCatalogRows({
      catalog: grasses as unknown[],
      mode: "sales_window",
      refYmds: [],
      pinnedGrassIds: selectedGrassIds,
    });
    return picked
      .map((grass) => {
        if (!grass || typeof grass !== "object") return null;
        const row = grass as Record<string, unknown>;
        const value = toText(row.id);
        const label = toText(row.title) || toText(row.name) || value;
        return value ? { value, label } : null;
      })
      .filter((row): row is { value: string; label: string } => row !== null)
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [grasses, selectedGrassIds]);

  const rowsWithLiveZoneCaps = useMemo(
    () => applyLatestZoneMaxKgToForecastRows(rows, zoneConfigs),
    [rows, zoneConfigs],
  );

  const filteredRows = useMemo(
    () =>
      rowsWithLiveZoneCaps.filter((row) => {
        if (selectedFarmIds.length > 0 && !selectedFarmIdSet.has(String(row.farmId))) return false;
        if (selectedGrassIds.length > 0 && !selectedGrassIdSet.has(String(row.productId))) return false;
        return true;
      }),
    [
      rowsWithLiveZoneCaps,
      selectedFarmIds,
      selectedFarmIdSet,
      selectedGrassIds,
      selectedGrassIdSet,
    ],
  );

  /** Only harvest rows whose DB harvest date falls within the selected From–To range. */
  const rowsInDateRange = useMemo(
    () =>
      filteredRows.filter((row) =>
        isHarvestDateInYmdRange(row, forecastStartYmd, horizonEndYmd),
      ),
    [filteredRows, forecastStartYmd, horizonEndYmd],
  );

  const audit = useMemo(
    () =>
      buildAvailableSourceAudit({
        rows: filteredRows,
        rawByPlanId,
        regrowthConfig,
        forecastDate: horizonEndDateObj,
        zoneConfigs,
        zoneLabel,
      }),
    [filteredRows, rawByPlanId, regrowthConfig, horizonEndDateObj, zoneConfigs, zoneLabel],
  );

  /** Per RG day: harvest rows whose regrowth lands on that day (not limited by harvest From–To). */
  const regrowthAuditByDate = useMemo(() => {
    const byYmd = new Map<string, ForecastHarvestRow[]>();
    for (const row of filteredRows) {
      const regrowthDate = getRegrowthDateFromHarvest(row, regrowthConfig);
      if (!regrowthDate) continue;
      const ymd = ymdFromDate(regrowthDate);
      if (ymd < forecastStartYmd || ymd > horizonEndYmd) continue;
      const list = byYmd.get(ymd) ?? [];
      list.push(row);
      byYmd.set(ymd, list);
    }
    const out = new Map<string, AvailableSourceAudit>();
    for (const [ymd, dayRows] of byYmd) {
      const asOf = parseYmdLocal(ymd);
      if (!asOf) continue;
      out.set(
        ymd,
        buildRegrowthSourceAudit({
          rows: dayRows,
          rawByPlanId,
          regrowthConfig,
          asOf,
          zoneConfigs,
          zoneLabel,
        }),
      );
    }
    return out;
  }, [
    filteredRows,
    rawByPlanId,
    regrowthConfig,
    forecastStartYmd,
    horizonEndYmd,
    zoneConfigs,
    zoneLabel,
  ]);

  const regrowthSourcesByDate = useMemo(() => {
    const out = new Map<string, SourceAuditRow[]>();
    for (const [ymd, dayAudit] of regrowthAuditByDate) {
      out.set(ymd, dayAudit.sourceRows);
    }
    return out;
  }, [regrowthAuditByDate]);

  const farmProductFilter = useCallback(
    (farmId: number, productId: number) => {
      if (selectedFarmIds.length > 0 && !selectedFarmIdSet.has(String(farmId))) return false;
      if (selectedGrassIds.length > 0 && !selectedGrassIdSet.has(String(productId))) return false;
      return true;
    },
    [selectedFarmIds, selectedFarmIdSet, selectedGrassIds, selectedGrassIdSet],
  );

  /** Daily available: same basis as /inventory, summed by farm + grass. */
  const rollingDailyAvailable = useMemo(
    () =>
      computeInventoryStyleFarmGrassDailySeries(
        filteredRows,
        zoneConfigs,
        regrowthConfig,
        overridesByZone,
        forecastDateObj,
        horizonEndDateObj,
        farmProductFilter,
      ),
    [
      filteredRows,
      zoneConfigs,
      regrowthConfig,
      overridesByZone,
      forecastDateObj,
      horizonEndDateObj,
      farmProductFilter,
    ],
  );

  const calculated = useMemo(
    () =>
      computeAllocatedAvailableByZoneAtDate(
        rowsInDateRange,
        regrowthConfig,
        horizonEndDateObj,
        zoneConfigs,
      ),
    [rowsInDateRange, regrowthConfig, horizonEndDateObj, zoneConfigs],
  );

  const capacityByZone = useMemo(
    () => mergeZoneCapacityMapsAtDate(rowsInDateRange, zoneConfigs, horizonEndDateObj),
    [rowsInDateRange, zoneConfigs, horizonEndDateObj],
  );

  const overrideResult = useMemo(
    () =>
      applyInventoryAvailableOverridesToZoneMap({
        availableByZone: calculated.availableByZone,
        maxByZone: capacityByZone,
        overridesByZone,
        asOf: horizonEndDateObj,
        overrideRecoveryDays: regrowthConfig.overrideRecoveryDays,
      }),
    [calculated.availableByZone, capacityByZone, overridesByZone, horizonEndDateObj, regrowthConfig],
  );

  const calculatedTotal = useMemo(() => {
    const lastDay = rollingDailyAvailable[rollingDailyAvailable.length - 1];
    return lastDay ? Math.max(0, Math.round(lastDay.availableKg)) : 0;
  }, [rollingDailyAvailable]);

  const rollingOverlimitKg = useMemo(
    () =>
      rollingDailyAvailable.reduce((sum, day) => sum + Math.max(0, day.overlimitKg), 0),
    [rollingDailyAvailable],
  );
  const displayedTotal = useMemo(() => calculatedTotal, [calculatedTotal]);
  const capacityTotal = useMemo(
    () =>
      Math.round(
        sumFarmProductCapacityCapsFromZoneConfigAtDate(
          zoneConfigs,
          horizonEndDateObj,
          farmProductFilter,
        ),
      ),
    [zoneConfigs, horizonEndDateObj, farmProductFilter],
  );
  const rawAvailableAtHorizon = useMemo(() => {
    const lastDay = rollingDailyAvailable[rollingDailyAvailable.length - 1];
    return lastDay ? Math.max(0, Math.round(lastDay.rawAvailableKg)) : 0;
  }, [rollingDailyAvailable]);
  const auditDiff = Math.abs(calculatedTotal - rawAvailableAtHorizon);

  const filteredSourceRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return audit.sourceRows;
    return audit.sourceRows.filter((row) => {
      const haystack = [
        row.planId,
        row.project,
        row.customer,
        row.doSoNumber,
        row.farm,
        row.grass,
        row.dbZone,
        row.mappedZones.join(" "),
        row.forecastRowIds.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [audit.sourceRows, search]);

  const dailyRegrowthTimeline = useMemo<DailyRegrowthTimelineRow[]>(() => {
    const allSources: SourceAuditRow[] = [];
    for (const dayAudit of regrowthAuditByDate.values()) {
      allSources.push(...dayAudit.sourceRows);
    }
    return aggregateDailyRegrowthTimeline(allSources, zoneLabel);
  }, [regrowthAuditByDate, zoneLabel]);

  const zoneTimelineRows = useMemo<DevZoneTimelineRow[]>(() => {
    const seenKeys = new Set<string>();
    const rows: DevZoneTimelineRow[] = [];
    for (const config of zoneConfigs) {
      if (!zoneConfigIsActiveAtYmd(config, horizonEndYmd)) continue;
      if (isForecastExcludedZone(config.zone)) continue;
      const farmId = Number(config.farm_id) || 0;
      const grassId = Number(config.grass_id) || 0;
      if (!farmProductFilter(farmId, grassId)) continue;
      const zoneKey = forecastZoneKeyFromParts(
        config.farm_id,
        String(config.zone ?? ""),
        config.grass_id,
      );
      if (seenKeys.has(zoneKey)) continue;
      const active = findActiveZoneConfiguration(zoneConfigs, {
        farmId,
        zone: String(config.zone ?? ""),
        productId: grassId,
        ymd: horizonEndYmd,
      });
      if (!active) continue;
      seenKeys.add(zoneKey);
      rows.push({
        zoneKey,
        farmName: String(active.farm_name ?? "").trim(),
        turfgrass: String(active.turfgrass ?? "").trim(),
        zone: String(active.zone ?? "").trim(),
        sizeM2: toNum(active.size_m2),
        maxKg: zoneConfigurationMaxKg(active),
      });
    }
    return rows.sort((a, b) => {
      const farm = a.farmName.localeCompare(b.farmName);
      if (farm !== 0) return farm;
      const grass = a.turfgrass.localeCompare(b.turfgrass);
      if (grass !== 0) return grass;
      return a.zone.localeCompare(b.zone);
    });
  }, [zoneConfigs, horizonEndYmd, farmProductFilter]);

  const zoneDailySnapshots = useMemo(
    () =>
      computeInventoryStyleZoneDailySnapshots(
        filteredRows,
        zoneConfigs,
        regrowthConfig,
        overridesByZone,
        forecastDateObj,
        horizonEndDateObj,
        { farmProductFilter, applyRecovery: false },
      ),
    [
      filteredRows,
      zoneConfigs,
      regrowthConfig,
      overridesByZone,
      forecastDateObj,
      horizonEndDateObj,
      farmProductFilter,
    ],
  );

  const overrideRows = useMemo(
    () =>
      Array.from(overrideResult.appliedByZone.entries()).map(([zoneKey, applied]) => ({
        zoneKey,
        zone: zoneLabel(applied.override.zone),
        farm: applied.override.farmName,
        grass: applied.override.turfgrass,
        date: applied.override.date,
        savedAvailableKg: applied.override.availableKg,
        calculatedKg: applied.calculatedKg,
        effectiveKg: applied.effectiveKg,
        remainingDeltaKg: applied.remainingDeltaKg,
      })),
    [overrideResult.appliedByZone, zoneLabel],
  );

  const forecastCalendarDays = useMemo<DevForecastCalendarDay[]>(() => {
    const today = startOfLocalDay(new Date());
    const todayYmd = ymdFromDate(today);
    const start = forecastDateObj;
    const calendarEnd = horizonEndDateObj < start ? start : horizonEndDateObj;
    const startYmd = ymdFromDate(start);
    const endYmd = ymdFromDate(calendarEnd);
    const totalDays = diffDaysInclusive(start, calendarEnd);
    const harvestByDate = new Map<
      string,
      {
        kg: number;
        plans: Map<
          string,
          Omit<DevForecastCalendarHarvestPlan, "zones" | "regrowthDates" | "regrowthSchedule"> & {
            zones: Set<string>;
            regrowthDates: Set<string>;
            regrowthSchedule: RegrowthScheduleEntry[];
          }
        >;
      }
    >();

    for (const row of rowsInDateRange) {
      const harvestYmd = harvestYmdFromRow(row);
      if (!harvestYmd || harvestYmd < startYmd || harvestYmd > endYmd) continue;
      const kg = rowInventoryKg(row);
      const planKey = forecastLogicalPlanRowId(row.id);
      const raw = rawByPlanId.get(planKey);
      const rawQty = raw
        ? harvestPlanEffectiveMagnitudeFromRaw(raw)
        : forecastHarvestRowEffectiveM2(row) || row.quantity;
      const rawUom = raw ? resolvePlanRowUom(raw) : String(row.uom ?? "");
      const regrowthDate = getRegrowthDateFromHarvest(row, regrowthConfig);
      const cur = harvestByDate.get(harvestYmd) ?? { kg: 0, plans: new Map() };
      cur.kg += Number.isFinite(kg) ? Math.max(0, kg) : 0;
      const plan =
        cur.plans.get(planKey) ??
        {
          planId: rawPlanLabel(raw, planKey),
          project: rawProjectLabel(raw, row.project),
          customer: rawCustomerLabel(raw, row.customer),
          rawQty,
          rawUom,
          kg: 0,
          zones: new Set<string>(),
          regrowthDates: new Set<string>(),
          regrowthSchedule: [],
        };
      plan.kg += Number.isFinite(kg) ? Math.max(0, kg) : 0;
      plan.zones.add(zoneLabel(String(row.zone ?? "").trim() || FORECAST_NOZONE_ZONE));
      if (regrowthDate) {
        const rgYmd = ymdFromDate(regrowthDate);
        plan.regrowthDates.add(rgYmd);
        const days = computeRegrowthDaysForHarvest(regrowthConfig, row);
        const harvestType = harvestTypeLabel(row.harvestType);
        if (!plan.regrowthSchedule.some((entry: RegrowthScheduleEntry) => entry.dateYmd === rgYmd)) {
          plan.regrowthSchedule.push({ dateYmd: rgYmd, days, harvestType });
        }
      }
      cur.plans.set(planKey, plan);
      harvestByDate.set(harvestYmd, cur);
    }

    const rollingByDate = new Map(
      rollingDailyAvailable.map((day) => [day.date, day] as const),
    );
    const regrowthTimelineByDate = new Map(
      dailyRegrowthTimeline.map((row) => [row.date, row] as const),
    );

    const days: DevForecastCalendarDay[] = [];
    for (let i = 0; i < totalDays; i++) {
      const date = addDays(start, i);
      const dateStr = ymdFromDate(date);
      const rolling = rollingByDate.get(dateStr);
      const harvest = harvestByDate.get(dateStr);
      const harvestPlans =
        harvest
          ? Array.from(harvest.plans.values())
              .map((plan) => ({
                ...plan,
                zones: Array.from(plan.zones).sort((a, b) => a.localeCompare(b)),
                regrowthDates: Array.from(plan.regrowthDates).sort((a, b) => a.localeCompare(b)),
                regrowthSchedule: [...plan.regrowthSchedule].sort((a, b) =>
                  a.dateYmd.localeCompare(b.dateYmd),
                ),
                kg: Math.max(0, Math.round(plan.kg)),
              }))
              .sort((a, b) => a.planId.localeCompare(b.planId))
          : [];

      const regrowthTimeline = regrowthTimelineByDate.get(dateStr) ?? null;
      const regrowthSources = regrowthSourcesByDate.get(dateStr) ?? [];
      const regrowthFragmentCount = filteredRows.filter((row) => {
        const regrowthDate = getRegrowthDateFromHarvest(row, regrowthConfig);
        return regrowthDate != null && ymdFromDate(regrowthDate) === dateStr;
      }).length;
      const regrowthEngineCreditedKg = Math.round(
        computeRegrowthCreditedOnDate(filteredRows, regrowthConfig, date, zoneConfigs).creditedKg,
      );
      const available = Math.max(0, Math.round(rolling?.availableKg ?? 0));
      const hint = buildInventoryAvailableHintModel({
        available,
        previousAvailable: Math.max(0, Math.round(rolling?.previousAvailableKg ?? 0)),
        regrowthKg: Math.max(
          0,
          Math.round(rolling?.regrowthKg ?? regrowthTimeline?.creditedKg ?? 0),
        ),
        harvestKg: Math.max(0, Math.round(rolling?.harvestKg ?? 0)),
        calculatedAvailable: Math.max(
          0,
          Math.round(rolling?.rawAvailableKg ?? rolling?.availableKg ?? 0),
        ),
        dateYmd: dateStr,
        overridesByZone,
        filter: {
          selectedFarmIds,
          selectedFarmIdSet,
          selectedGrassIds,
          selectedGrassIdSet,
          zoneLabel,
        },
      });
      days.push({
        date: dateStr,
        isToday: dateStr === todayYmd,
        previousAvailable: Math.max(0, Math.round(rolling?.previousAvailableKg ?? 0)),
        harvestKg: Math.max(0, Math.round(rolling?.harvestKg ?? 0)),
        harvestPlanCount: harvestPlans.length,
        harvestPlanIds: harvestPlans.map((plan) => plan.planId),
        harvestPlans,
        regrowthKg: Math.max(
          0,
          Math.round(rolling?.regrowthKg ?? regrowthTimeline?.creditedKg ?? 0),
        ),
        regrowthTimeline,
        regrowthSources,
        regrowthFragmentCount,
        regrowthEngineCreditedKg,
        available,
        calculatedAvailable: Math.max(0, Math.round(rolling?.rawAvailableKg ?? rolling?.availableKg ?? 0)),
        overlimit: Math.max(0, Math.round(rolling?.overlimitKg ?? 0)),
        overrideCount: hint.balanceOverrides.length,
        hint,
      });
    }

    return days;
  }, [
    dailyRegrowthTimeline,
    filteredRows,
    regrowthSourcesByDate,
    rowsInDateRange,
    forecastDateObj,
    horizonEndDateObj,
    rawByPlanId,
    regrowthConfig,
    rollingDailyAvailable,
    zoneConfigs,
    zoneLabel,
    overridesByZone,
    selectedFarmIds,
    selectedFarmIdSet,
    selectedGrassIds,
    selectedGrassIdSet,
  ]);

  return (
    <RequireAuth>
      <DashboardLayout>
        <main className="min-h-screen bg-slate-50">
          <div className="mx-auto w-full max-w-7xl space-y-6 p-4 lg:p-8">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Development only
                </p>
                <h1 className="mt-1 text-2xl font-semibold text-slate-950">
                  Forecasting available source audit
                </h1>
                <p className="mt-1 max-w-3xl text-sm text-slate-600">
                  Daily available opens at zone-config capacity (farm + grass), then rolls with
                  harvest plans and inventory balance updates.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => router.push("/dev/forecasting/formula")}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Formula explainer
                </button>
                <button
                  type="button"
                  onClick={() => router.push("/forecasting")}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Forecasting
                </button>
                <button
                  type="button"
                  onClick={() => void loadData()}
                  disabled={loading}
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                  Reload
                </button>
              </div>
            </div>

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="grid gap-3 lg:grid-cols-[180px_180px_1fr_1fr_260px]">
                <label className="space-y-1">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                    <CalendarDays className="h-3.5 w-3.5" />
                    From
                  </span>
                  <input
                    type="date"
                    value={forecastDate}
                    max={forecastEndDate || undefined}
                    onChange={(e) => {
                      const next = e.target.value;
                      setForecastDate(next);
                      if (next && forecastEndDate && next > forecastEndDate) {
                        setForecastEndDate(next);
                      }
                    }}
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                  />
                </label>

                <label className="space-y-1">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                    <CalendarDays className="h-3.5 w-3.5" />
                    To
                  </span>
                  <input
                    type="date"
                    value={forecastEndDate}
                    min={forecastDate || undefined}
                    onChange={(e) => {
                      const next = e.target.value;
                      setForecastEndDate(next);
                      if (next && forecastDate && next < forecastDate) {
                        setForecastDate(next);
                      }
                    }}
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-medium text-slate-600">Farm filter</span>
                  <MultiSelect
                    options={farmOptions.map((option) => ({ value: option.id, label: option.label }))}
                    values={selectedFarmIds}
                    onChange={setSelectedFarmIds}
                    placeholder="All farms"
                    showAllOption
                    selectionSummary="compact"
                    className="rounded-lg"
                    formatSelectedCount={(count) => `${count} farms`}
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-medium text-slate-600">Grass filter</span>
                  <MultiSelect
                    options={grassFilterOptions}
                    values={selectedGrassIds}
                    onChange={setSelectedGrassIds}
                    placeholder="All grasses"
                    showAllOption
                    selectionSummary="compact"
                    className="rounded-lg"
                    formatSelectedCount={(count) => `${count} grasses`}
                  />
                </label>

                <label className="space-y-1">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                    <Search className="h-3.5 w-3.5" />
                    Search source rows
                  </span>
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="plan, project, farm..."
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                  />
                </label>
              </div>
            </section>

            {error ? (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}

            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <SummaryTile
                label="Displayed available"
                value={formatKg(displayedTotal)}
                sub={`Farm+grass total at ${toDisplayDate(horizonEndYmd)} · zone config + inventory update`}
                tone="green"
              />
              <SummaryTile
                label="Calculated from plan"
                value={formatKg(calculatedTotal)}
                sub={`Opening = zone cap · then regrowth − harvest · ${toDisplayDate(horizonEndYmd)}`}
              />
              <SummaryTile
                label="Raw regrowth gross"
                value={formatKg(audit.totalGrossKg)}
                sub={`${audit.sourceRows.length.toLocaleString()} credited source rows in range`}
              />
              <SummaryTile
                label="Over capacity"
                value={formatKg(rollingOverlimitKg)}
                sub="Regrowth kg not counted into available"
                tone={rollingOverlimitKg > 0 ? "red" : "slate"}
              />
              <SummaryTile
                label="Configured capacity"
                value={formatKg(capacityTotal)}
                sub="Σ zone max per farm+grass (excl. nozone)"
                tone="amber"
              />
            </section>

            {auditDiff > 1 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                Plan regrowth total differs from displayed available by {formatKg(auditDiff)} — likely
                inventory balance override or zone cap on {toDisplayDate(horizonEndYmd)}.
              </div>
            ) : null}

            <section className="rounded-lg border border-slate-200 bg-white">
              <div className="flex flex-col gap-1 border-b border-slate-200 p-4">
                <h2 className="text-lg font-semibold text-slate-950">
                  Daily harvest / available calendar
                </h2>
                <p className="text-sm text-slate-600">
                  Scroll horizontally by day from {toDisplayDate(forecastStartYmd)} to{" "}
                  {toDisplayDate(horizonEndYmd)}. First day opens at Σ zone-config max per
                  farm+grass, then regrowth − harvest each day. Regrown cells list the original
                  harvest day (often before calendar From — e.g. Sod +120d), m² × kg/m² from zone
                  config, and plan breakdown for that RG day. Hover{" "}
                  <HelpCircle className="inline h-3.5 w-3.5 align-text-bottom" /> on Available for
                  the calculation or saved stock count.
                </p>
                <div className="mt-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-950">
                  <p className="font-semibold text-violet-900">Regrowth config (admin rules)</p>
                  <ul className="mt-1 list-inside list-disc space-y-0.5">
                    {formatRegrowthConfigSummaryLines(regrowthConfig).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="overflow-x-auto p-4">
                <table className="min-w-max border-separate border-spacing-0 rounded-lg border border-slate-200 text-xs">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-20 w-[132px] min-w-[132px] border-b border-r border-slate-200 bg-slate-100 px-3 py-2 text-left font-semibold text-slate-600">
                        Day
                      </th>
                      {forecastCalendarDays.map((day) => (
                        <th
                          key={`calendar-day-${day.date}`}
                          className={`w-[200px] min-w-[200px] border-b border-r border-slate-200 px-2 py-2 text-center font-medium ${
                            day.isToday
                              ? "bg-emerald-50 text-emerald-800"
                              : "bg-slate-50 text-slate-900"
                          }`}
                        >
                          <div className="tabular-nums">{toDisplayDate(day.date)}</div>
                          <div className="mt-0.5 text-[10px] font-normal text-slate-500">
                            {formatWeekdayShort(day.date)}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th className="sticky left-0 z-10 w-[132px] min-w-[132px] border-b border-r border-slate-200 bg-white px-3 py-3 text-left font-semibold text-slate-600">
                        Harvest date
                      </th>
                      {forecastCalendarDays.map((day) => (
                        <td
                          key={`calendar-harvest-${day.date}`}
                          title={day.harvestPlans
                            .map((plan) =>
                              [
                                `#${plan.planId}`,
                                plan.project,
                                formatPlanQty(plan.rawQty, plan.rawUom),
                                formatKg(plan.kg),
                                plan.regrowthSchedule.length > 0
                                  ? plan.regrowthSchedule
                                      .map(
                                        (entry) =>
                                          `+${entry.days}d (${entry.harvestType}) → RG ${toDisplayDate(entry.dateYmd)}`,
                                      )
                                      .join("; ")
                                  : plan.regrowthDates.length > 0
                                    ? `regrowth ${plan.regrowthDates.map(toDisplayDate).join(", ")}`
                                    : "",
                              ]
                                .filter(Boolean)
                                .join(" | "),
                            )
                            .join("\n")}
                          className={`w-[200px] min-w-[200px] border-b border-r border-slate-200 px-2 py-3 text-center align-top ${
                            day.harvestPlanCount > 0 ? "bg-amber-50" : "bg-white"
                          }`}
                        >
                          {day.harvestPlanCount > 0 ? (
                            <>
                              <div className="font-semibold tabular-nums text-amber-800">
                                {formatKg(day.harvestKg)}
                              </div>
                              <div className="mt-2 space-y-1 text-left">
                                {day.harvestPlans.map((plan) => (
                                  <div
                                    key={`calendar-plan-${day.date}-${plan.planId}`}
                                    className="rounded border border-amber-200 bg-white/80 px-1.5 py-1"
                                  >
                                    <div className="flex items-center justify-between gap-2 text-[10px] font-semibold text-amber-900">
                                      <span className="tabular-nums">#{plan.planId}</span>
                                      <span className="truncate">
                                        {formatPlanQty(plan.rawQty, plan.rawUom)}
                                      </span>
                                    </div>
                                    <div className="mt-0.5 truncate text-[10px] text-slate-600">
                                      {plan.project || plan.customer || "No project"}
                                    </div>
                                    {plan.regrowthSchedule.length > 0
                                      ? plan.regrowthSchedule.map((entry) => (
                                          <div
                                            key={`calendar-plan-rg-${day.date}-${plan.planId}-${entry.dateYmd}`}
                                            className="mt-0.5 text-[10px] leading-snug text-emerald-700"
                                          >
                                            +{entry.days}d ({entry.harvestType}) → RG{" "}
                                            {toDisplayDate(entry.dateYmd)}
                                          </div>
                                        ))
                                      : plan.regrowthDates.length > 0 ? (
                                          <div className="mt-0.5 truncate text-[10px] text-emerald-700">
                                            RG {plan.regrowthDates.map(toDisplayDate).join(", ")}
                                          </div>
                                        ) : null}
                                  </div>
                                ))}
                              </div>
                            </>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <th className="sticky left-0 z-10 w-[132px] min-w-[132px] border-b border-r border-slate-200 bg-white px-3 py-3 text-left font-semibold text-slate-600">
                        Regrown
                      </th>
                      {forecastCalendarDays.map((day) => {
                        const harvestCreditYmds = uniqueSortedYmds(
                          day.regrowthSources.map((row) => row.harvestDate),
                        );
                        const regrowthCreditYmds = uniqueSortedYmds(
                          day.regrowthSources.map((row) => row.regrowthDate),
                        );
                        const hasRegrowthCell =
                          day.regrowthKg > 0 ||
                          day.regrowthTimeline != null ||
                          day.regrowthSources.length > 0;

                        return (
                          <td
                            key={`calendar-regrowth-${day.date}`}
                            title={day.regrowthSources
                              .map((row) => formatRegrowthSourceTooltip(row))
                              .join("\n")}
                            className={`w-[200px] min-w-[200px] border-b border-r border-slate-200 px-2 py-3 text-center align-top ${
                              day.regrowthKg > 0 ? "bg-emerald-50/60" : "bg-white"
                            }`}
                          >
                            {hasRegrowthCell ? (
                              <>
                                <div className="font-semibold tabular-nums text-emerald-700">
                                  {formatKg(day.regrowthKg)}
                                </div>
                                <div className="mt-0.5 text-[10px] text-emerald-800">
                                  credited on RG {toDisplayDate(day.date)}
                                </div>
                                <div className="mt-2 space-y-1 text-left">
                                  {harvestCreditYmds.length > 0 ? (
                                    <div className="rounded border border-slate-200 bg-slate-50 px-1.5 py-1">
                                      <div className="text-[10px] font-medium text-slate-500">
                                        Harvest days (source of today&apos;s regrowth)
                                      </div>
                                      {harvestCreditYmds.map((ymd) => (
                                        <div
                                          key={`${day.date}-harvest-ymd-${ymd}`}
                                          className="text-[10px] tabular-nums text-slate-700"
                                        >
                                          {toDisplayDate(ymd)}
                                          {formatWeekdayShort(ymd)
                                            ? ` (${formatWeekdayShort(ymd)})`
                                            : ""}
                                        </div>
                                      ))}
                                      {regrowthCreditYmds.length > 0 ? (
                                        <div className="mt-1 text-[10px] text-emerald-700">
                                          → RG{" "}
                                          {regrowthCreditYmds.map(toDisplayDate).join(", ")}
                                        </div>
                                      ) : null}
                                    </div>
                                  ) : day.regrowthTimeline ? (
                                    <div className="rounded border border-slate-200 bg-slate-50 px-1.5 py-1">
                                      <div className="text-[10px] font-medium text-slate-500">
                                        Harvest → regrowth ({day.regrowthTimeline.sourceCount}{" "}
                                        rows)
                                      </div>
                                      {day.regrowthTimeline.harvestDates.map((dateLabel) => (
                                        <div
                                          key={`${day.date}-harvest-${dateLabel}`}
                                          className="truncate text-[10px] tabular-nums text-slate-700"
                                        >
                                          {dateLabel}
                                        </div>
                                      ))}
                                    </div>
                                  ) : null}

                                  {day.regrowthSources.length > 0
                                    ? day.regrowthSources.map((source) => (
                                        <RegrowthSourceCalendarCard
                                          key={`calendar-regrowth-plan-${day.date}-${source.planId}-${source.forecastRowIds[0] ?? ""}`}
                                          source={source}
                                        />
                                      ))
                                    : day.regrowthKg > 0 ? (
                                        <div className="rounded border border-amber-300 bg-amber-50 px-1.5 py-1 text-[10px] text-amber-950">
                                          <p>
                                            Rolling +{formatKg(day.regrowthKg)} on this RG day.
                                            Engine check: {formatKg(day.regrowthEngineCreditedKg)}
                                            {day.regrowthFragmentCount > 0
                                              ? ` · ${day.regrowthFragmentCount} harvest fragment(s) land RG here but no plan card (check farm/grass filter).`
                                              : " · no harvest rows with RG on this day in loaded data."}
                                          </p>
                                        </div>
                                      ) : null}

                                  {day.regrowthSources.length === 0 &&
                                  day.regrowthTimeline &&
                                  day.regrowthTimeline.zoneConfigConversions.length > 0 ? (
                                    <div className="rounded border border-amber-200 bg-amber-50 px-1.5 py-1">
                                      <div className="text-[10px] font-medium text-amber-900">
                                        Zone config (day total)
                                      </div>
                                      {day.regrowthTimeline.zoneConfigConversions.map((line) => (
                                        <div
                                          key={`${day.date}-zone-${line.zoneLabel}-${line.configIds.join("-")}`}
                                          className="mt-0.5 text-[10px] text-amber-950"
                                        >
                                          <div className="font-semibold">
                                            {line.zoneLabel}: {formatM2(line.inputM2)} ×{" "}
                                            {formatKgPerM2(line.kgPerM2)} ={" "}
                                            {formatKg(line.multipliedKg)}
                                          </div>
                                          <div className="text-amber-800">
                                            max {formatKg(line.maxKg)}
                                            {line.overMaxKg > 0
                                              ? ` · over ${formatKg(line.overMaxKg)}`
                                              : ""}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  ) : null}

                                  {day.regrowthTimeline ? (
                                    <div className="text-[10px] text-slate-500">
                                      gross {formatKg(day.regrowthTimeline.grossKg)}
                                      {day.regrowthTimeline.notCountedKg > 0
                                        ? ` · not counted ${formatKg(day.regrowthTimeline.notCountedKg)}`
                                        : ""}
                                      {day.regrowthTimeline.zones.length > 0
                                        ? ` · zones: ${day.regrowthTimeline.zones.join(", ")}`
                                        : ""}
                                    </div>
                                  ) : null}
                                </div>
                              </>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    <tr>
                      <th className="sticky left-0 z-10 w-[132px] min-w-[132px] border-r border-slate-200 bg-white px-3 py-3 text-left font-semibold text-slate-600">
                        Available (credited)
                      </th>
                      {forecastCalendarDays.map((day) => (
                        <td
                          key={`calendar-available-${day.date}`}
                          className={`w-[200px] min-w-[200px] border-r border-slate-200 px-2 py-3 text-center align-top ${
                            day.overrideCount > 0
                              ? "bg-amber-50/70"
                              : day.overlimit > 0
                                ? "bg-amber-50/60"
                                : day.available === 0
                                  ? "bg-white"
                                  : "bg-emerald-50/40"
                          }`}
                        >
                          <div className="flex items-center justify-center gap-1">
                            <div
                              className={`font-semibold tabular-nums ${
                                day.overlimit > 0
                                  ? "text-amber-800"
                                  : day.available === 0
                                    ? "text-slate-500"
                                    : "text-emerald-700"
                              }`}
                            >
                              {formatKg(day.available)}
                            </div>
                            <InventoryAvailableHintPopover model={day.hint} showFormula />
                          </div>
                          {day.overlimit > 0 ? (
                            <div className="mt-1 text-[10px] font-medium text-amber-800">
                              over cap +{formatNumber(day.overlimit)} kg
                            </div>
                          ) : null}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white">
              <div className="flex flex-col gap-1 border-b border-slate-200 p-4">
                <h2 className="text-lg font-semibold text-slate-950">
                  Daily zone balance timeline
                </h2>
                <p className="text-sm text-slate-600">
                  Mỗi zone: <span className="font-medium">Previous + regrowth − harvest = System</span>.
                  Khi có cấu hình balance manual, ngày lưu sẽ{" "}
                  <span className="font-medium">set lại chain System</span>; các ngày sau System vẫn
                  cộng trừ tiếp nhưng <span className="font-medium">Display</span> giữ giá trị manual
                  (giống /inventory). Scroll ngang theo ngày từ {toDisplayDate(forecastStartYmd)} đến{" "}
                  {toDisplayDate(horizonEndYmd)}.
                </p>
              </div>
              <div className="space-y-6 p-4">
                {zoneTimelineRows.length === 0 ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                    No zone configuration rows for this farm/grass selection.
                  </div>
                ) : (
                  zoneTimelineRows.map((zoneRow) => (
                    <div
                      key={zoneRow.zoneKey}
                      className="overflow-x-auto rounded-lg border border-slate-200"
                    >
                      <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-sm font-semibold text-slate-900">
                          {zoneRow.farmName || "—"} · {zoneRow.turfgrass || "—"} ·{" "}
                          {zoneLabel(zoneRow.zone)}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {formatNumber(zoneRow.sizeM2)} m² · max {formatNumber(zoneRow.maxKg)} kg
                        </p>
                      </div>
                      <table className="min-w-max border-separate border-spacing-0 text-xs">
                        <thead>
                          <tr>
                            <th className="sticky left-0 z-20 w-[108px] min-w-[108px] border-b border-r border-slate-200 bg-slate-100 px-2 py-2 text-left font-semibold text-slate-600">
                              Step
                            </th>
                            {forecastCalendarDays.map((day) => (
                              <th
                                key={`zone-step-day-${zoneRow.zoneKey}-${day.date}`}
                                className={`w-[148px] min-w-[148px] border-b border-r border-slate-200 px-2 py-2 text-center font-medium ${
                                  day.isToday
                                    ? "bg-emerald-50 text-emerald-800"
                                    : "bg-slate-50 text-slate-900"
                                }`}
                              >
                                <div className="tabular-nums">{toDisplayDate(day.date)}</div>
                                <div className="mt-0.5 text-[10px] font-normal text-slate-500">
                                  {formatWeekdayShort(day.date)}
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {ZONE_BALANCE_STEPS.map((step) => (
                            <tr key={`${zoneRow.zoneKey}-${step.key}`}>
                              <th className="sticky left-0 z-10 w-[108px] min-w-[108px] border-r border-slate-200 bg-white px-2 py-2.5 text-left font-semibold text-slate-600">
                                {step.label}
                              </th>
                              {forecastCalendarDays.map((day) => {
                                const snapshot =
                                  zoneDailySnapshots.get(day.date)?.get(zoneRow.zoneKey) ?? null;
                                if (!snapshot) {
                                  return (
                                    <td
                                      key={`zone-step-${zoneRow.zoneKey}-${step.key}-${day.date}`}
                                      className="w-[148px] min-w-[148px] border-r border-slate-200 px-2 py-2.5 text-center text-slate-400"
                                    >
                                      —
                                    </td>
                                  );
                                }
                                const toneClass =
                                  step.key === "manual" && snapshot.isManualOverrideActive
                                    ? "bg-amber-50/80"
                                    : step.key === "display" && snapshot.isManualOverrideActive
                                      ? "bg-amber-50/60"
                                      : step.key === "system"
                                        ? "bg-slate-50/80"
                                        : step.key === "regrowth" && snapshot.regrowthKg > 0
                                          ? "bg-emerald-50/50"
                                          : step.key === "harvest" && snapshot.harvestKg > 0
                                            ? "bg-amber-50/50"
                                            : "bg-white";
                                return (
                                  <td
                                    key={`zone-step-${zoneRow.zoneKey}-${step.key}-${day.date}`}
                                    className={`w-[148px] min-w-[148px] border-r border-slate-200 px-2 py-2.5 text-center align-top ${toneClass}`}
                                  >
                                    <ZoneBalanceStepCell snapshot={snapshot} kind={step.key} />
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))
                )}
              </div>
            </section>

        

         
          </div>
        </main>
      </DashboardLayout>
    </RequireAuth>
  );
}
