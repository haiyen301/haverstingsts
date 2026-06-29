"use client";

import { useMemo, useRef, useState } from "react";
import { format, isValid, parseISO } from "date-fns";
import { CalendarDays, ChevronDown } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  bgSurfaceFilter,
  FILTER_COLOR_EMPTY_CLASS,
  FILTER_COLOR_FILLED_CLASS,
} from "@/shared/lib/surfaceFilter";
import {
  type KpiDatePreset,
  type KpiDeliveryDateFilter,
  KPI_DATE_PRESET_DASHBOARD,
  KPI_DATE_PRESET_FORECAST,
  kpiDateRangeFromFilter,
} from "@/shared/lib/dashboardKpiProjectFilters";
import { DateRangePickerInlinePanel, DateRangeMobileSheet } from "@/shared/ui/date-picker";
import { useMediaQuery } from "@/shared/hooks/useMediaQuery";
import { useAppTranslations } from "@/shared/i18n/useAppTranslations";

export {
  KPI_DATE_PRESET_DASHBOARD,
  KPI_DATE_PRESET_FERTILIZER,
  KPI_DATE_PRESET_FORECAST,
  KPI_DATE_PRESET_FUEL,
  KPI_DATE_PRESET_HARVEST,
  KPI_DATE_PRESET_SCHEDULE,
} from "@/shared/lib/dashboardKpiProjectFilters";

function formatCustomRangeLabel(from?: string, to?: string): string {
  const fmt = (ymd: string) => {
    const parsed = parseISO(ymd.slice(0, 10));
    return isValid(parsed) ? format(parsed, "MMM d, yyyy") : ymd;
  };
  const f = String(from ?? "").trim();
  const t = String(to ?? "").trim();
  if (f && t) return `${fmt(f)} – ${fmt(t)}`;
  if (f) return fmt(f);
  return "";
}

type DashboardKpiDateFilterProps = {
  value: KpiDeliveryDateFilter;
  onChange: (next: KpiDeliveryDateFilter) => void;
  /** Preset options shown in the menu (order preserved). Defaults to dashboard KPI list. */
  presets?: readonly KpiDatePreset[];
  /** Preset treated as “no filter” for trigger highlight; defaults to `lastMonth` on dashboard presets. */
  baselinePreset?: KpiDatePreset;
  /** Optional per-preset label overrides (e.g. fleet fuel “This week” for `lastWeek`). */
  presetLabelMap?: Partial<Record<KpiDatePreset, string>>;
  className?: string;
};

export function DashboardKpiDateFilter({
  value,
  onChange,
  presets = KPI_DATE_PRESET_DASHBOARD,
  baselinePreset,
  presetLabelMap,
  className,
}: DashboardKpiDateFilterProps) {
  const t = useAppTranslations();
  const isMobileViewport = useMediaQuery("(max-width: 639px)");
  const [open, setOpen] = useState(false);
  const [mobileCustomOpen, setMobileCustomOpen] = useState(false);
  const [customPickerActive, setCustomPickerActive] = useState(false);
  const [customDraft, setCustomDraft] = useState<{ from?: string; to?: string }>({});
  const revertFilterRef = useRef<KpiDeliveryDateFilter>(value);

  const presetOptions = useMemo(() => {
    const seen = new Set<KpiDatePreset>();
    const ordered: KpiDatePreset[] = [];
    for (const preset of presets) {
      if (seen.has(preset)) continue;
      seen.add(preset);
      ordered.push(preset);
    }
    return ordered;
  }, [presets]);

  const resolvedBaselinePreset = useMemo((): KpiDatePreset => {
    if (baselinePreset && presetOptions.includes(baselinePreset)) {
      return baselinePreset;
    }
    const nonCustom = presetOptions.filter((p) => p !== "custom");
    if (nonCustom.includes("lastMonth")) return "lastMonth";
    if (nonCustom.includes("next3Months")) return "next3Months";
    return nonCustom[nonCustom.length - 1] ?? "lastMonth";
  }, [baselinePreset, presetOptions]);

  const resolvePresetLabel = (preset: KpiDatePreset): string => {
    const override = presetLabelMap?.[preset];
    if (override) return override;

    switch (preset) {
      case "all":
        return t("Dashboard.dateRangeLabel");
      case "today":
        return t("Dashboard.datePresetToday");
      case "yesterday":
        return t("Dashboard.datePresetYesterday");
      case "lastWeek":
        return t("Dashboard.periodWeek");
      case "lastMonth":
        return t("Dashboard.periodMonth");
      case "lastQuarter":
        return t("Dashboard.periodQuarter");
      case "lastYear":
        return t("Dashboard.periodYear");
      case "thisWeek":
        return t("Dashboard.periodThisWeek");
      case "nextWeek":
        return t("Dashboard.periodNextWeek");
      case "nextMonth":
        return t("Dashboard.periodNextMonth");
      case "nextQuarter":
        return t("Dashboard.periodNextQuarter");
      case "next1Month":
        return t("Dashboard.forecastNextMonth");
      case "next3Months":
        return t("Dashboard.forecastNextNMonths", { months: 3 });
      case "next6Months":
        return t("Dashboard.forecastNextNMonths", { months: 6 });
      case "next12Months":
        return t("Dashboard.forecastNextNMonths", { months: 12 });
      case "custom":
        return t("Dashboard.datePresetCustom");
      default:
        return t("Dashboard.dateRangeLabel");
    }
  };

  const committedRange = useMemo(() => kpiDateRangeFromFilter(value), [value]);

  const triggerPrimaryLabel = presetOptions.includes(value.preset)
    ? resolvePresetLabel(value.preset)
    : resolvePresetLabel(resolvedBaselinePreset);

  const popupRangeLabel = useMemo(() => {
    if (customPickerActive && (customDraft.from || customDraft.to)) {
      return formatCustomRangeLabel(
        customDraft.from ?? committedRange.start,
        customDraft.to ?? customDraft.from ?? committedRange.end,
      );
    }
    return formatCustomRangeLabel(committedRange.start, committedRange.end);
  }, [
    customPickerActive,
    customDraft.from,
    customDraft.to,
    committedRange.start,
    committedRange.end,
  ]);

  const hasActiveFilter =
    value.preset !== resolvedBaselinePreset ||
    Boolean(value.customFrom || value.customTo);

  const seedCustomDraft = (filter: KpiDeliveryDateFilter) => {
    const seedRange = kpiDateRangeFromFilter({
      preset: "custom",
      customFrom: filter.customFrom,
      customTo: filter.customTo,
    });
    setCustomDraft({
      from: filter.customFrom ?? seedRange.start,
      to: filter.customTo ?? seedRange.end,
    });
  };

  const openCustomPicker = () => {
    revertFilterRef.current = value;
    seedCustomDraft(value);
    if (isMobileViewport) {
      setOpen(false);
      setMobileCustomOpen(true);
      return;
    }
    setCustomPickerActive(true);
    setOpen(true);
  };

  const closeMobileCustomPicker = () => {
    const revert = revertFilterRef.current;
    setCustomDraft({
      from: revert.customFrom,
      to: revert.customTo,
    });
    setCustomPickerActive(false);
    setMobileCustomOpen(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      revertFilterRef.current = value;
      if (isMobileViewport) {
        setCustomPickerActive(false);
        setMobileCustomOpen(false);
        setOpen(true);
        return;
      }
      if (value.preset === "custom") {
        seedCustomDraft(value);
        setCustomPickerActive(true);
      } else {
        setCustomPickerActive(false);
      }
      setOpen(true);
      return;
    }

    if (customPickerActive && !isMobileViewport) {
      const revert = revertFilterRef.current;
      setCustomDraft({
        from: revert.customFrom,
        to: revert.customTo,
      });
    }
    setCustomPickerActive(false);
    setOpen(false);
  };

  const handlePresetPick = (preset: KpiDatePreset) => {
    if (preset === "custom") {
      openCustomPicker();
      return;
    }
    setCustomPickerActive(false);
    onChange({ preset });
    setOpen(false);
  };

  const handleCustomApply = () => {
    if (!customDraft.from || !customDraft.to) return;
    onChange({
      preset: "custom",
      customFrom: customDraft.from,
      customTo: customDraft.to,
    });
    setCustomPickerActive(false);
    setMobileCustomOpen(false);
    setOpen(false);
  };

  const handleCustomCancel = () => {
    if (isMobileViewport) {
      closeMobileCustomPicker();
      return;
    }
    const revert = revertFilterRef.current;
    setCustomDraft({
      from: revert.customFrom,
      to: revert.customTo,
    });
    setCustomPickerActive(false);
    setOpen(false);
  };

  const handleCustomClear = () => {
    onChange({ preset: resolvedBaselinePreset });
    setCustomDraft({});
    setCustomPickerActive(false);
    setMobileCustomOpen(false);
    setOpen(false);
  };

  const showDesktopCustomPanel = !isMobileViewport && customPickerActive;

  const presetSidebar = (
    <div className="flex flex-col p-1">
      {presetOptions.map((preset) => {
        const isSelected =
          (customPickerActive && preset === "custom") ||
          (!customPickerActive && value.preset === preset);
        return (
          <button
            key={preset}
            type="button"
            onClick={() => handlePresetPick(preset)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
              isSelected && "bg-muted font-medium text-foreground",
            )}
          >
            <span
              className={cn(
                "h-4 w-4 shrink-0 rounded-full border border-input",
                isSelected && "border-primary bg-primary",
              )}
              aria-hidden
            />
            {resolvePresetLabel(preset)}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className={className}>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex min-h-10 min-w-[180px] max-w-[300px] items-center justify-between gap-2 rounded-md border border-input px-3 py-2 text-sm hover:bg-btnhover/40",
              bgSurfaceFilter(hasActiveFilter),
            )}
          >
            <span className="inline-flex min-w-0 items-center gap-2">
              <CalendarDays
                className={cn(
                  "h-3.5 w-3.5 shrink-0",
                  hasActiveFilter ? FILTER_COLOR_FILLED_CLASS : FILTER_COLOR_EMPTY_CLASS,
                )}
              />
              <span
                className={cn(
                  "max-w-full truncate",
                  hasActiveFilter ? FILTER_COLOR_FILLED_CLASS : FILTER_COLOR_EMPTY_CLASS,
                )}
              >
                {triggerPrimaryLabel}
              </span>
            </span>
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                hasActiveFilter ? FILTER_COLOR_FILLED_CLASS : FILTER_COLOR_EMPTY_CLASS,
              )}
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className={cn(
            "p-0",
            showDesktopCustomPanel
              ? "w-[min(calc(100vw-1.5rem),640px)] max-w-[calc(100vw-1.5rem)] overflow-hidden -ml-2.5"
              : "w-52",
          )}
          align={showDesktopCustomPanel ? "end" : "start"}
          side="bottom"
          sideOffset={6}
          collisionPadding={20}
          avoidCollisions
        >
          {!isMobileViewport ? (
            showDesktopCustomPanel ? (
              <div className="flex max-h-[min(calc(100vh-4rem),640px)] w-full min-w-0 flex-col overflow-hidden sm:flex-row">
                <div className="max-h-40 shrink-0 overflow-y-auto border-b border-border sm:max-h-none sm:w-35 md:w-40 sm:shrink-0 sm:border-b-0 sm:border-r">
                  {presetSidebar}
                </div>
                <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                  <DateRangePickerInlinePanel
                    embedded
                    compact
                    value={customDraft}
                    onDraftChange={setCustomDraft}
                    onApply={handleCustomApply}
                    onCancel={handleCustomCancel}
                    onClear={handleCustomClear}
                    clearLabel={t("Dashboard.clearDate")}
                    applyLabel={t("Dashboard.dateRangeUpdate")}
                    cancelLabel={t("Common.cancel")}
                    selectingEndHint={t("Dashboard.dateRangeSelectingEnd")}
                    className="min-h-0 flex-1"
                  />
                </div>
              </div>
            ) : (
              <div className="flex flex-col">
                {popupRangeLabel ? (
                  <div className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
                    {popupRangeLabel}
                  </div>
                ) : null}
                {presetSidebar}
              </div>
            )
          ) : (
            <div className="flex flex-col">
              {popupRangeLabel ? (
                <div className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
                  {popupRangeLabel}
                </div>
              ) : null}
              {presetSidebar}
            </div>
          )}
        </PopoverContent>
      </Popover>
      <DateRangeMobileSheet
        open={mobileCustomOpen}
        value={customDraft}
        onDraftChange={setCustomDraft}
        onApply={handleCustomApply}
        onCancel={closeMobileCustomPicker}
        selectRangeLabel={t("Dashboard.dateRangeSelectTitle")}
        doneLabel={t("Dashboard.dateRangeDone")}
        closeLabel={t("Common.close")}
        clearLabel={t("Dashboard.clearDate")}
        onClear={handleCustomClear}
        selectingEndHint={t("Dashboard.dateRangeSelectingEnd")}
      />
    </div>
  );
}
