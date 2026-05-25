"use client";

import { useMemo, useState } from "react";
import { addMonths, format, isValid, startOfMonth } from "date-fns";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { cn } from "@/lib/utils";
import { CALENDAR_MARKED_DAY_CLASS, Calendar } from "./calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

type DateRangePickerProps = {
  value?: { from?: string; to?: string };
  onChange: (value: { from?: string; to?: string }) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  hasError?: boolean;
  onBlur?: () => void;
  /** When true, days matching `isMarkedDate` get a highlight in the calendar grid. */
  isMarkedDate?: (date: Date) => boolean;
  markedDateModifierClassName?: string;
  /** Inventory full (đủ kho) — second marker layer on the calendar. */
  isFullInventoryDate?: (date: Date) => boolean;
  fullInventoryDateModifierClassName?: string;
  /** Inventory limited — second marker layer on the calendar. */
  isLimitedInventoryDate?: (date: Date) => boolean;
  limitedInventoryDateModifierClassName?: string;
  /** Shown while the user is picking the end date (popover open, start fixed). */
  selectingEndHint?: string;
  clearLabel?: string;
};

function parseLocalYmd(value: string | undefined): Date | undefined {
  const ymd = String(value ?? "").trim().slice(0, 10);
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return undefined;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return isValid(date) ? date : undefined;
}

function toYmd(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function toDateRange(value?: { from?: string; to?: string }): DateRange | undefined {
  const from = parseLocalYmd(value?.from);
  const to = parseLocalYmd(value?.to);
  if (!from && !to) return undefined;
  return { from, to };
}

function normalizeRange(from: Date, to: Date): DateRange {
  if (to < from) return { from: to, to: from };
  return { from, to };
}

function formatLabel(range?: DateRange, selectingEndHint?: string): string {
  if (!range?.from && !range?.to) return "";
  if (range.from && !range.to) {
    return selectingEndHint
      ? `${format(range.from, "MMM dd, yyyy")} — ${selectingEndHint}`
      : `${format(range.from, "MMM dd, yyyy")} — …`;
  }
  if (!range.from && range.to) return format(range.to, "MMM dd, yyyy");
  return `${format(range.from as Date, "MMM dd, yyyy")} - ${format(
    range.to as Date,
    "MMM dd, yyyy",
  )}`;
}

function initPaneMonths(range?: DateRange): { left: Date; right: Date } {
  const anchor = range?.from ?? range?.to ?? new Date();
  const left = startOfMonth(anchor);
  const right = range?.to
    ? startOfMonth(range.to)
    : startOfMonth(addMonths(left, 1));
  return { left, right };
}

export function DateRangePicker({
  value,
  onChange,
  disabled,
  placeholder = "Pick a date range",
  className,
  hasError,
  onBlur,
  isMarkedDate,
  markedDateModifierClassName = CALENDAR_MARKED_DAY_CLASS,
  isFullInventoryDate,
  fullInventoryDateModifierClassName = "bg-emerald-50 font-medium text-emerald-900 ring-1 ring-emerald-200/80",
  isLimitedInventoryDate,
  limitedInventoryDateModifierClassName = "bg-amber-50 font-medium text-amber-900 ring-1 ring-amber-200/80",
  selectingEndHint = "select end date",
  clearLabel = "Clear",
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [draftRange, setDraftRange] = useState<DateRange | undefined>();
  const [leftMonth, setLeftMonth] = useState(() => startOfMonth(new Date()));
  const [rightMonth, setRightMonth] = useState(() => startOfMonth(addMonths(new Date(), 1)));

  const committedRange = useMemo(() => toDateRange(value), [value?.from, value?.to]);

  const today = new Date();
  const calendarRange = open ? draftRange : committedRange;
  const awaitingEndDate = Boolean(open && draftRange?.from && !draftRange?.to);
  const leftMonthLocked = awaitingEndDate && draftRange?.from;
  const leftDisplayMonth = leftMonthLocked
    ? startOfMonth(draftRange!.from!)
    : leftMonth;

  const calendarModifiers = useMemo(() => {
    const mods: Record<string, (date: Date) => boolean> = {};
    if (isMarkedDate) mods.hasSetup = isMarkedDate;
    if (isFullInventoryDate) mods.hasFullInventory = isFullInventoryDate;
    if (isLimitedInventoryDate) mods.hasLimitedInventory = isLimitedInventoryDate;
    return Object.keys(mods).length > 0 ? mods : undefined;
  }, [isMarkedDate, isFullInventoryDate, isLimitedInventoryDate]);

  const calendarModifiersClassNames = useMemo(() => {
    const names: Record<string, string> = {};
    if (isMarkedDate && markedDateModifierClassName) names.hasSetup = markedDateModifierClassName;
    if (isFullInventoryDate && fullInventoryDateModifierClassName) {
      names.hasFullInventory = fullInventoryDateModifierClassName;
    }
    if (isLimitedInventoryDate && limitedInventoryDateModifierClassName) {
      names.hasLimitedInventory = limitedInventoryDateModifierClassName;
    }
    return Object.keys(names).length > 0 ? names : undefined;
  }, [
    isMarkedDate,
    markedDateModifierClassName,
    isFullInventoryDate,
    fullInventoryDateModifierClassName,
    isLimitedInventoryDate,
    limitedInventoryDateModifierClassName,
  ]);

  const yearBounds = useMemo(() => {
    const anchorYear =
      leftDisplayMonth.getFullYear() ||
      rightMonth.getFullYear() ||
      today.getFullYear();
    return {
      startMonth: new Date(anchorYear - 10, 0),
      endMonth: new Date(anchorYear + 10, 11),
    };
  }, [leftDisplayMonth, rightMonth, today]);

  const commitRange = (range: DateRange) => {
    if (!range.from || !range.to) return;
    onChange({
      from: toYmd(range.from),
      to: toYmd(range.to),
    });
  };

  const handleSelect = (range: DateRange | undefined) => {
    if (!range?.from) {
      setDraftRange(undefined);
      return;
    }

    if (range.from && range.to) {
      const complete = normalizeRange(range.from, range.to);
      setDraftRange(complete);
      commitRange(complete);
      return;
    }

    if (draftRange?.from && !draftRange?.to) {
      const complete = normalizeRange(draftRange.from, range.from);
      setDraftRange(complete);
      commitRange(complete);
      return;
    }

    setDraftRange({ from: range.from, to: undefined });
    setLeftMonth(startOfMonth(range.from));
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      const range = toDateRange(value);
      setDraftRange(range);
      const panes = initPaneMonths(range);
      setLeftMonth(panes.left);
      setRightMonth(panes.right);
    } else {
      if (draftRange?.from && !draftRange?.to) {
        setDraftRange(toDateRange(value));
      }
      onBlur?.();
    }
    setOpen(nextOpen);
  };

  const triggerLabel = open
    ? formatLabel(draftRange, selectingEndHint)
    : formatLabel(committedRange);

  const leftCalendarClassNames = {
    months: "flex flex-col",
    month: "space-y-3",
    ...(leftMonthLocked
      ? {
          caption_label: "text-sm font-medium text-gray-900",
          dropdowns: "hidden",
        }
      : {}),
  };

  const rightCalendarClassNames = {
    months: "flex flex-col",
    month: "space-y-3",
  };

  const sharedCalendarProps = {
    mode: "range" as const,
    selected: calendarRange,
    startMonth: yearBounds.startMonth,
    endMonth: yearBounds.endMonth,
    onSelect: handleSelect,
    disabled,
    modifiers: calendarModifiers,
    modifiersClassNames: calendarModifiersClassNames,
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex h-10 w-full items-center justify-between rounded-lg border bg-white px-3 py-2 text-left text-sm focus:ring-2 focus:ring-[#1F7A4C] focus:outline-none disabled:bg-gray-100 disabled:text-gray-500",
            hasError ? "border-red-500" : "border-gray-300",
            className,
          )}
        >
          {triggerLabel ? (
            <span
              className={cn(
                "truncate",
                awaitingEndDate ? "text-muted-foreground" : "text-[var(--primary-color)]",
              )}
            >
              {triggerLabel}
            </span>
          ) : (
            <span className="text-gray-400">{placeholder}</span>
          )}
          <CalendarIcon className="h-4 w-4 shrink-0 text-gray-500" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex flex-col sm:flex-row sm:divide-x sm:divide-gray-200">
          <Calendar
            {...sharedCalendarProps}
            month={leftDisplayMonth}
            onMonthChange={(month) => {
              if (!leftMonthLocked) setLeftMonth(startOfMonth(month));
            }}
            captionLayout={leftMonthLocked ? "label" : "dropdown"}
            hideNavigation={Boolean(leftMonthLocked)}
            classNames={leftCalendarClassNames}
            className="p-3"
            aria-label="Start date calendar"
          />
          <Calendar
            {...sharedCalendarProps}
            month={rightMonth}
            onMonthChange={(month) => setRightMonth(startOfMonth(month))}
            captionLayout="dropdown"
            classNames={rightCalendarClassNames}
            className="p-3"
            aria-label="End date calendar"
          />
        </div>
        {awaitingEndDate ? (
          <div className="border-t border-gray-200 px-3 py-2 text-xs text-muted-foreground">
            {selectingEndHint}
          </div>
        ) : null}
        {committedRange?.from || committedRange?.to ? (
          <div className="border-t border-gray-200 p-2">
            <button
              type="button"
              className="w-full rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-50"
              onClick={() => {
                setDraftRange(undefined);
                onChange({});
                setOpen(false);
              }}
              disabled={disabled}
            >
              {clearLabel}
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
