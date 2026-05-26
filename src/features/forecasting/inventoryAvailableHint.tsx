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
  savedDate: string;
};

export type InventoryAvailableHintModel = {
  available: number;
  previousAvailable: number;
  regrowthKg: number;
  harvestKg: number;
  calculatedAvailable: number;
  /** Manual balance saved exactly on this date. */
  balanceOverrides: InventoryBalanceOverrideDisplay[];
};

function formatNumber(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  return Math.round(n).toLocaleString();
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
  return `Balance: ${parts.join(" - ")} - ${formatNumber(row.availableKg)} kg`;
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
      <div className="space-y-1">
        <p className="font-semibold text-slate-900">Zone roll total</p>
        <p className="tabular-nums text-slate-700">
          {formatNumber(model.calculatedAvailable)} kg (before aggregate display)
        </p>
      </div>
    </div>
  );
}

export function InventoryAvailableHintPopover({
  model,
  ariaLabel = "Balance details",
  triggerClassName,
  contentClassName,
}: {
  model: InventoryAvailableHintModel;
  ariaLabel?: string;
  triggerClassName?: string;
  contentClassName?: string;
}) {
  if (inventoryAvailableHintIsEmpty(model)) return null;

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
        <InventoryAvailableBalanceSummary model={model} className="mb-2 space-y-0.5" />
        <InventoryAvailableHintBody model={model} />
      </PopoverContent>
    </Popover>
  );
}
