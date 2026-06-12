"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HelpCircle } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  normalizeInventoryBalanceDateYmd,
  type InventoryAvailableOverrideEntry,
} from "@/shared/store/inventoryAvailableOverrideStore";

export type InventoryBalanceOverrideDisplay = {
  zoneKey: string;
  zone: string;
  farm: string;
  grass: string;
  availableKg: number;
  /** System-calculated kg when the manual balance was saved. */
  calculatedKg: number;
  savedDate: string;
};

export type InventoryAvailableHintModel = {
  available: number;
  previousAvailable: number;
  regrowthKg: number;
  harvestKg: number;
  calculatedAvailable: number;
  /** Calendar day (YYYY-MM-DD) for formula labels. */
  dateYmd?: string;
  /** Manual balance saved exactly on this date. */
  balanceOverrides: InventoryBalanceOverrideDisplay[];
};

function formatNumber(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  return Math.round(n).toLocaleString();
}

function ymdAddDays(ymd: string, delta: number): string {
  const match = String(ymd).trim().slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return ymd;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setDate(date.getDate() + delta);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDayMonth(ymd: string): string {
  const match = String(ymd).trim().slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return ymd;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function rolledAvailableKg(model: InventoryAvailableHintModel): number {
  return Math.max(
    0,
    Math.round(model.previousAvailable + model.regrowthKg - model.harvestKg),
  );
}

/**
 * Swap each overridden zone's system kg for manual kg inside the rolled total.
 * Call only with overrides saved on the same `dateYmd` (see collectBalanceOverridesForExactDate).
 */
export function applyBalanceReplacementsToRolledTotal(
  rolledKg: number,
  overrides: InventoryBalanceOverrideDisplay[],
): number {
  let total = rolledKg;
  for (const row of overrides) {
    total = total - row.calculatedKg + row.availableKg;
  }
  return Math.max(0, Math.round(total));
}

function mapOverrideEntryToDisplay(
  entry: InventoryAvailableOverrideEntry,
  zoneLabel: (zoneId: string) => string,
  nameFallback?: {
    grassNameById?: Map<number, string>;
    farmNameById?: Map<number, string>;
  },
): InventoryBalanceOverrideDisplay {
  const farmFromEntry = String(entry.farmName ?? "").trim();
  const grassFromEntry = String(entry.turfgrass ?? "").trim();
  return {
    zoneKey: entry.zoneKey,
    zone: zoneLabel(entry.zone),
    farm:
      farmFromEntry ||
      String(nameFallback?.farmNameById?.get(entry.farmId) ?? "").trim(),
    grass:
      grassFromEntry ||
      String(nameFallback?.grassNameById?.get(entry.grassId) ?? "").trim(),
    availableKg: Math.max(0, Math.round(Number(entry.availableKg) || 0)),
    calculatedKg: Math.max(0, Math.round(Number(entry.calculatedKg) || 0)),
    savedDate: normalizeInventoryBalanceDateYmd(entry.date),
  };
}

function passesFarmGrassFilter(
  entry: InventoryAvailableOverrideEntry,
  params: {
    selectedFarmIds: string[];
    selectedFarmIdSet: Set<string>;
    selectedGrassIds: string[];
    selectedGrassIdSet: Set<string>;
  },
): boolean {
  if (
    params.selectedFarmIds.length > 0 &&
    !params.selectedFarmIdSet.has(String(entry.farmId))
  ) {
    return false;
  }
  if (
    params.selectedGrassIds.length > 0 &&
    !params.selectedGrassIdSet.has(String(entry.grassId))
  ) {
    return false;
  }
  return true;
}

export function collectBalanceOverridesForExactDate(
  overridesByZone: Record<string, InventoryAvailableOverrideEntry>,
  dateYmd: string,
  params: {
    selectedFarmIds: string[];
    selectedFarmIdSet: Set<string>;
    selectedGrassIds: string[];
    selectedGrassIdSet: Set<string>;
    zoneLabel: (zoneId: string) => string;
    grassNameById?: Map<number, string>;
    farmNameById?: Map<number, string>;
  },
): InventoryBalanceOverrideDisplay[] {
  const ymd = normalizeInventoryBalanceDateYmd(dateYmd);
  const out: InventoryBalanceOverrideDisplay[] = [];
  for (const entry of Object.values(overridesByZone)) {
    const entryYmd = normalizeInventoryBalanceDateYmd(entry.date);
    if (!entryYmd || entryYmd !== ymd) continue;
    if (!passesFarmGrassFilter(entry, params)) continue;
    out.push(
      mapOverrideEntryToDisplay(entry, params.zoneLabel, {
        grassNameById: params.grassNameById,
        farmNameById: params.farmNameById,
      }),
    );
  }
  return out.sort(
    (a, b) =>
      a.farm.localeCompare(b.farm) ||
      a.grass.localeCompare(b.grass) ||
      a.zone.localeCompare(b.zone),
  );
}

export function buildInventoryAvailableHintModel(params: {
  available: number;
  previousAvailable: number;
  regrowthKg: number;
  harvestKg: number;
  calculatedAvailable: number;
  dateYmd: string;
  overridesByZone: Record<string, InventoryAvailableOverrideEntry>;
  filter: {
    selectedFarmIds: string[];
    selectedFarmIdSet: Set<string>;
    selectedGrassIds: string[];
    selectedGrassIdSet: Set<string>;
    zoneLabel: (zoneId: string) => string;
    grassNameById?: Map<number, string>;
    farmNameById?: Map<number, string>;
  };
}): InventoryAvailableHintModel {
  const balanceOverrides = collectBalanceOverridesForExactDate(
    params.overridesByZone,
    params.dateYmd,
    params.filter,
  );

  return {
    available: params.available,
    previousAvailable: params.previousAvailable,
    regrowthKg: params.regrowthKg,
    harvestKg: params.harvestKg,
    calculatedAvailable: params.calculatedAvailable,
    dateYmd: params.dateYmd,
    balanceOverrides,
  };
}

export function inventoryAvailableHintIsEmpty(model: InventoryAvailableHintModel): boolean {
  const hasBalanceOnDate = model.balanceOverrides.length > 0;
  const hasZoneTotalNote =
    model.calculatedAvailable !== model.available && !hasBalanceOnDate;
  return !hasBalanceOnDate && !hasZoneTotalNote;
}

export function formatInventoryBalanceOverrideLine(row: InventoryBalanceOverrideDisplay): string {
  const parts = [row.farm, row.grass, row.zone].filter(Boolean);
  const label = parts.join(" · ");
  if (row.calculatedKg > 0 && row.calculatedKg !== row.availableKg) {
    const delta = row.availableKg - row.calculatedKg;
    const sign = delta >= 0 ? "+" : "−";
    return `${label}: system ${formatNumber(row.calculatedKg)} kg → manual ${formatNumber(row.availableKg)} kg (${sign}${formatNumber(Math.abs(delta))} kg)`;
  }
  return `${label}: manual balance ${formatNumber(row.availableKg)} kg`;
}

export function filterBalanceOverridesForSeries(
  rows: InventoryBalanceOverrideDisplay[],
  seriesKey: string,
  breakdownMode: "grass" | "farm",
): InventoryBalanceOverrideDisplay[] {
  const norm = (value: string) => value.trim().toLowerCase();
  const target = norm(seriesKey);
  if (!target) return [];
  return rows.filter((row) => {
    const candidate = breakdownMode === "farm" ? row.farm : row.grass;
    return norm(candidate) === target;
  });
}

function BalanceOverrideLines({
  rows,
  variant = "default",
}: {
  rows: InventoryBalanceOverrideDisplay[];
  variant?: "default" | "chart";
}) {
  if (rows.length === 0) return null;

  if (variant === "chart") {
    return (
      <div className="space-y-1 border-t border-border pt-2">
        {rows.map((row) => (
          <p
            key={`${row.zoneKey}-${row.savedDate}`}
            className="text-[11px] leading-snug tabular-nums text-amber-800"
          >
            {formatInventoryBalanceOverrideLine(row)}
          </p>
        ))}
      </div>
    );
  }

  return (
    <>
      {rows.map((row) => (
        <p
          key={`${row.zoneKey}-${row.savedDate}`}
          className="tabular-nums text-amber-800"
        >
          {formatInventoryBalanceOverrideLine(row)}
        </p>
      ))}
    </>
  );
}

export function InventoryAvailableBalanceSummary({
  model,
  className,
  variant = "default",
}: {
  model: InventoryAvailableHintModel;
  className?: string;
  variant?: "default" | "chart";
}) {
  if (model.balanceOverrides.length === 0) {
    return null;
  }

  return (
    <div className={className ?? "space-y-0.5"}>
      <BalanceOverrideLines rows={model.balanceOverrides} variant={variant} />
    </div>
  );
}

export function InventoryAvailableFormulaSummary({
  model,
  className,
}: {
  model: InventoryAvailableHintModel;
  className?: string;
}) {
  const prev = Math.round(model.previousAvailable);
  const regrowth = Math.round(model.regrowthKg);
  const harvest = Math.round(model.harvestKg);
  const rolled = rolledAvailableKg(model);
  const hasOverride = model.balanceOverrides.length > 0;
  const displayResult = hasOverride
    ? applyBalanceReplacementsToRolledTotal(rolled, model.balanceOverrides)
    : rolled;

  const prevDateLabel = model.dateYmd
    ? formatDayMonth(ymdAddDays(model.dateYmd, -1))
    : "previous day";
  const dayLabel = model.dateYmd ? formatDayMonth(model.dateYmd) : "this day";

  return (
    <div className={className ?? "space-y-2"}>
      <p className="font-semibold text-slate-900">Available (credited) roll</p>
      <div className="space-y-1 tabular-nums text-slate-700">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-slate-600">End of {prevDateLabel}</span>
          <span>{formatNumber(prev)} kg</span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-slate-600">+ Regrowth credited {dayLabel}</span>
          <span className={regrowth > 0 ? "text-emerald-700" : "text-slate-500"}>
            +{formatNumber(regrowth)} kg
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-slate-600">− Harvest {dayLabel}</span>
          <span className={harvest > 0 ? "text-red-700" : "text-slate-500"}>
            −{formatNumber(harvest)} kg
          </span>
        </div>
      </div>
      <div className="space-y-1 border-t border-slate-200 pt-2 tabular-nums">
        <p className="text-slate-700">
          {formatNumber(prev)} + {formatNumber(regrowth)} − {formatNumber(harvest)} ={" "}
          {formatNumber(rolled)} kg
        </p>
        {hasOverride ? (
          <>
            <p className="font-medium text-amber-900">
              Manual balance saved on {dayLabel} only — swap system zone value in roll total;
              other days roll normally.
            </p>
            <div className="space-y-0.5 text-amber-800">
              <p>
                Roll total {formatNumber(rolled)} kg, then swap overridden zone(s):
              </p>
              {model.balanceOverrides.map((row) => (
                <p key={`${row.zoneKey}-${row.savedDate}`}>
                  {row.farm} · {row.grass} · {row.zone}: {formatNumber(row.calculatedKg)} kg →{" "}
                  {formatNumber(row.availableKg)} kg
                </p>
              ))}
            </div>
            <p className="font-semibold text-emerald-800">
              = Available (credited) {formatNumber(displayResult)} kg
            </p>
          </>
        ) : (
          <p className="font-semibold text-emerald-800">
            = Available (credited) {formatNumber(displayResult)} kg
          </p>
        )}
      </div>
    </div>
  );
}

export function InventoryAvailableHintBody({
  model,
  className,
}: {
  model: InventoryAvailableHintModel;
  className?: string;
}) {
  const hasBalanceOnDate = model.balanceOverrides.length > 0;
  const hasZoneTotalNote =
    model.calculatedAvailable !== model.available && !hasBalanceOnDate;

  if (!hasZoneTotalNote) return null;

  return (
    <div className={className}>
      <div className="space-y-1 border-t border-slate-200 pt-2">
        <p className="font-semibold text-slate-900">Zone roll total</p>
        <p className="tabular-nums text-slate-700">
          {formatNumber(model.calculatedAvailable)} kg (sum of per-zone rolls before aggregate
          display)
        </p>
      </div>
    </div>
  );
}

export function InventoryAvailableHintPopover({
  model,
  showFormula = false,
  ariaLabel = "Balance details",
  triggerClassName,
  contentClassName,
}: {
  model: InventoryAvailableHintModel;
  /** When true, always show the ? icon with the daily roll formula. */
  showFormula?: boolean;
  ariaLabel?: string;
  triggerClassName?: string;
  contentClassName?: string;
}) {
  if (!showFormula && inventoryAvailableHintIsEmpty(model)) return null;

  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const openPanel = useCallback(() => {
    clearCloseTimer();
    setOpen(true);
  }, [clearCloseTimer]);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 120);
  }, [clearCloseTimer]);

  useEffect(() => () => clearCloseTimer(), [clearCloseTimer]);

  return (
    <Popover modal={false} open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={
            triggerClassName ??
            "inline-flex shrink-0 rounded-full p-0 text-slate-500 transition-colors hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1"
          }
          aria-label={ariaLabel}
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
        side="top"
        align="center"
        sideOffset={6}
        collisionPadding={12}
        className={
          contentClassName ??
          "w-80 border-amber-200 p-3 text-left text-[11px] leading-snug text-slate-800 shadow-lg"
        }
        onOpenAutoFocus={(e) => e.preventDefault()}
        onMouseEnter={openPanel}
        onMouseLeave={scheduleClose}
      >
        {showFormula ? <InventoryAvailableFormulaSummary model={model} className="mb-2" /> : null}
        <InventoryAvailableBalanceSummary
          model={model}
          className={showFormula ? "mb-2 space-y-0.5 border-t border-slate-200 pt-2" : "mb-2 space-y-0.5"}
        />
        <InventoryAvailableHintBody model={model} />
      </PopoverContent>
    </Popover>
  );
}
