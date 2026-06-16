"use client";

import { useEffect, useMemo, useState } from "react";
import { addMonths, format, isValid, startOfMonth } from "date-fns";
import type { DateRange } from "react-day-picker";

import { cn } from "@/lib/utils";
import { CALENDAR_MARKED_DAY_CLASS, Calendar } from "./calendar";
import "./date-range-inline-compact.css";

type DateRangeValue = { from?: string; to?: string };

type DateRangePickerInlinePanelProps = {
  value?: DateRangeValue;
  onDraftChange: (value: DateRangeValue) => void;
  onApply: () => void;
  onCancel: () => void;
  applyLabel: string;
  cancelLabel: string;
  clearLabel?: string;
  onClear?: () => void;
  selectingEndHint: string;
  className?: string;
  /** Strip outer chrome when nested inside another popover/card. */
  embedded?: boolean;
  /** Tighter calendar sizing for nested popovers (~640px+ viewports). */
  compact?: boolean;
  isMarkedDate?: (date: Date) => boolean;
  markedDateModifierClassName?: string;
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

function toDateRange(value?: DateRangeValue): DateRange | undefined {
  const from = parseLocalYmd(value?.from);
  const to = parseLocalYmd(value?.to);
  if (!from && !to) return undefined;
  return { from, to };
}

function normalizeRange(from: Date, to: Date): DateRange {
  if (to < from) return { from: to, to: from };
  return { from, to };
}

function initPaneMonths(range?: DateRange): { left: Date; right: Date } {
  const anchor = range?.from ?? range?.to ?? new Date();
  const left = startOfMonth(anchor);
  let right = range?.to
    ? startOfMonth(range.to)
    : startOfMonth(addMonths(left, 1));
  if (right.getTime() <= left.getTime()) {
    right = startOfMonth(addMonths(left, 1));
  }
  return { left, right };
}

function formatRangeInput(range?: DateRange): { from: string; to: string } {
  const fmt = (d?: Date) => (d && isValid(d) ? format(d, "MMM d, yyyy") : "");
  return {
    from: fmt(range?.from),
    to: fmt(range?.to),
  };
}

export function DateRangePickerInlinePanel({
  value,
  onDraftChange,
  onApply,
  onCancel,
  applyLabel,
  cancelLabel,
  clearLabel,
  onClear,
  selectingEndHint: _selectingEndHint,
  className,
  embedded = false,
  compact = false,
  isMarkedDate,
  markedDateModifierClassName = CALENDAR_MARKED_DAY_CLASS,
}: DateRangePickerInlinePanelProps) {
  const committedRange = useMemo(() => toDateRange(value), [value?.from, value?.to]);
  const [draftRange, setDraftRange] = useState<DateRange | undefined>(committedRange);
  const [leftMonth, setLeftMonth] = useState(() => initPaneMonths(committedRange).left);
  const [rightMonth, setRightMonth] = useState(() => initPaneMonths(committedRange).right);

  useEffect(() => {
    setDraftRange(committedRange);
    const panes = initPaneMonths(committedRange);
    setLeftMonth(panes.left);
    setRightMonth(panes.right);
  }, [committedRange]);

  const calendarModifiers = useMemo(() => {
    if (!isMarkedDate) return undefined;
    return { hasSetup: isMarkedDate };
  }, [isMarkedDate]);

  const calendarModifiersClassNames = useMemo(() => {
    if (!isMarkedDate || !markedDateModifierClassName) return undefined;
    return { hasSetup: markedDateModifierClassName };
  }, [isMarkedDate, markedDateModifierClassName]);

  const today = new Date();
  const yearBounds = useMemo(() => {
    const anchorYear =
      leftMonth.getFullYear() ||
      rightMonth.getFullYear() ||
      today.getFullYear();
    return {
      startMonth: new Date(anchorYear - 10, 0),
      endMonth: new Date(anchorYear + 10, 11),
    };
  }, [leftMonth, rightMonth, today]);

  const pushDraft = (range: DateRange | undefined) => {
    setDraftRange(range);
    onDraftChange({
      from: range?.from ? toYmd(range.from) : undefined,
      to: range?.to ? toYmd(range.to) : undefined,
    });
  };

  const handleSelect = (range: DateRange | undefined, selectedDay: Date) => {
    if (draftRange?.from && draftRange?.to) {
      pushDraft({ from: selectedDay, to: undefined });
      setLeftMonth(startOfMonth(selectedDay));
      return;
    }

    if (!range?.from) {
      pushDraft(undefined);
      return;
    }

    if (range.from && range.to) {
      pushDraft(normalizeRange(range.from, range.to));
      return;
    }

    if (draftRange?.from && !draftRange?.to) {
      pushDraft(normalizeRange(draftRange.from, range.from));
      return;
    }

    pushDraft({ from: range.from, to: undefined });
    setLeftMonth(startOfMonth(range.from));
  };

  const rangeInputs = formatRangeInput(draftRange);
  const canApply = Boolean(draftRange?.from && draftRange?.to);
  const showClear = Boolean(
    onClear &&
      clearLabel &&
      (draftRange?.from || draftRange?.to || value?.from || value?.to),
  );

  const compactCalendarClassNames = compact
    ? {
        weekday: "rounded-md text-[0.7rem] font-medium text-muted-foreground sm:text-[0.75rem]",
        week: "",
        day: "rdp-day p-0 text-center text-xs sm:text-sm",
        day_button: "rdp-day_button p-0 text-xs font-medium sm:text-sm",
      }
    : {};

  const sharedCalendarProps = {
    mode: "range" as const,
    selected: draftRange,
    startMonth: yearBounds.startMonth,
    endMonth: yearBounds.endMonth,
    onSelect: handleSelect,
    modifiers: calendarModifiers,
    modifiersClassNames: calendarModifiersClassNames,
    showOutsideDays: false,
  };

  return (
    <div
      className={cn(
        embedded
          ? "flex min-h-0 flex-col overflow-hidden bg-card"
          : "overflow-hidden rounded-xl border border-border bg-card shadow-lg",
        compact && "sts-date-range-inline-compact",
        className,
      )}
    >
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div
          className={cn(
            "flex w-full min-w-0 max-w-full flex-col divide-y divide-border sm:flex-row sm:divide-x sm:divide-y-0",
          )}
        >
        <div className="min-w-0 flex-1 basis-0">
        <Calendar
          {...sharedCalendarProps}
          month={leftMonth}
          onMonthChange={(month) => setLeftMonth(startOfMonth(month))}
          captionLayout="dropdown"
          classNames={{
            months: "flex flex-col",
            month: "space-y-2",
            ...compactCalendarClassNames,
          }}
          className={cn(compact ? "w-full max-w-full p-2" : "p-3")}
          aria-label="Start date calendar"
        />
        </div>
        <div className="min-w-0 flex-1 basis-0">
        <Calendar
          {...sharedCalendarProps}
          month={rightMonth}
          onMonthChange={(month) => setRightMonth(startOfMonth(month))}
          captionLayout="dropdown"
          classNames={{
            months: "flex flex-col",
            month: compact ? "space-y-2" : "space-y-3",
            ...compactCalendarClassNames,
          }}
          className={cn(compact ? "w-full max-w-full p-2" : "p-3")}
          aria-label="End date calendar"
        />
        </div>
        </div>
      </div>

      <div
        className={cn(
          "flex shrink-0 flex-col gap-2 border-t border-border bg-muted/20 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-4 sm:py-3",
        )}
      >
        <div className="flex min-w-0 items-center gap-2 text-foreground">
          <span
            className={cn(
              "inline-flex h-9 min-w-30 items-center rounded-md border border-input bg-background px-2.5 font-medium tabular-nums",
              compact ? "text-xs sm:min-w-34 sm:px-3 sm:text-sm" : "px-3 text-sm",
              !rangeInputs.from && "text-muted-foreground",
            )}
          >
            {rangeInputs.from || "\u00a0"}
          </span>
          <span className="shrink-0 text-muted-foreground">–</span>
          <span
            className={cn(
              "inline-flex h-9 min-w-30 items-center rounded-md border border-input bg-background px-2.5 font-medium tabular-nums",
              compact ? "text-xs sm:min-w-34 sm:px-3 sm:text-sm" : "px-3 text-sm",
              !rangeInputs.to && "text-muted-foreground",
            )}
          >
            {rangeInputs.to || "\u00a0"}
          </span>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 sm:justify-start">
          {showClear ? (
            <button
              type="button"
              onClick={onClear}
              className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground hover:bg-muted/60 sm:px-4"
            >
              {clearLabel}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground hover:bg-muted/60 sm:px-4"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={!canApply}
            className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:pointer-events-none disabled:opacity-50 sm:px-4"
          >
            {applyLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
