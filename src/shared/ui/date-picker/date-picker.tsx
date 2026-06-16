"use client";

import { useEffect, useMemo, useState } from "react";
import { format, isValid, parse, parseISO } from "date-fns";
import { CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { bgSurfaceFilter } from "@/shared/lib/surfaceFilter";
import { CALENDAR_MARKED_DAY_CLASS, Calendar } from "./calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

type DatePickerProps = {
  value?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  hasError?: boolean;
  onBlur?: () => void;
  /**
   * Calendar markers: local `yyyy-MM-dd` strings. Those days get a highlight class
   * (see `markedDateModifierClassName`) in the popover month grid.
   */
  markedDatesYmd?: string[];
  /** Predicate highlight — takes precedence over `markedDatesYmd` when provided. */
  isMarkedDate?: (date: Date) => boolean;
  /** When true, matching days cannot be selected from the calendar or typed in. */
  isDisabledDate?: (date: Date) => boolean;
  /** Tailwind / utility classes for days listed in `markedDatesYmd`. */
  markedDateModifierClassName?: string;
};

export function DatePicker({
  value,
  onChange,
  disabled,
  placeholder = "dd/M/yyyy",
  className,
  hasError,
  onBlur,
  markedDatesYmd,
  isMarkedDate,
  isDisabledDate,
  markedDateModifierClassName = CALENDAR_MARKED_DAY_CLASS,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);

  const selectedDate = useMemo(() => {
    if (!value) return undefined;
    const parsed = parseISO(value);
    return isValid(parsed) ? parsed : undefined;
  }, [value]);

  const today = new Date();
  const selectedYear = selectedDate?.getFullYear() ?? today.getFullYear();
  const startMonth = new Date(selectedYear - 10, 0);
  const endMonth = new Date(selectedYear + 10, 11);
  const [inputValue, setInputValue] = useState("");

  useEffect(() => {
    setInputValue(selectedDate ? format(selectedDate, "dd/M/yyyy") : "");
  }, [selectedDate]);

  const markedLocalDates = useMemo(() => {
    if (!markedDatesYmd?.length) return [];
    const out: Date[] = [];
    for (const raw of markedDatesYmd) {
      const ymd = String(raw ?? "").trim().slice(0, 10);
      const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) continue;
      out.push(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0));
    }
    return out;
  }, [markedDatesYmd]);

  const calendarModifiers = useMemo(() => {
    if (isMarkedDate) return { hasMarkedBalance: isMarkedDate };
    if (markedLocalDates.length > 0) return { hasMarkedBalance: markedLocalDates };
    return undefined;
  }, [isMarkedDate, markedLocalDates]);

  const calendarModifiersClassNames = useMemo(
    () =>
      (isMarkedDate || markedLocalDates.length > 0) && markedDateModifierClassName
        ? { hasMarkedBalance: markedDateModifierClassName }
        : undefined,
    [isMarkedDate, markedDateModifierClassName, markedLocalDates.length],
  );

  const calendarDisabled = useMemo(() => {
    if (disabled) return true;
    if (isDisabledDate) return isDisabledDate;
    return undefined;
  }, [disabled, isDisabledDate]);

  const commitManualDateInput = () => {
    const raw = inputValue.trim();
    if (!raw) {
      onChange("");
      onBlur?.();
      return;
    }

    const normalized = raw.replace(/[-.\s]+/g, "/");
    const strictPattern = /^([0-2]\d|3[01])\/([1-9]|1[0-2])\/([1-9]\d{3})$/;
    const match = normalized.match(strictPattern);
    if (!match) {
      setInputValue("");
      onChange("");
      onBlur?.();
      return;
    }

    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const parsedDate = parse(`${day}/${month}/${year}`, "d/M/yyyy", new Date());
    const isStrictlyValid =
      isValid(parsedDate) &&
      parsedDate.getDate() === day &&
      parsedDate.getMonth() + 1 === month &&
      parsedDate.getFullYear() === year;

    if (!isStrictlyValid) {
      setInputValue("");
      onChange("");
      onBlur?.();
      return;
    }

    if (isDisabledDate?.(parsedDate)) {
      setInputValue("");
      onChange("");
      onBlur?.();
      return;
    }

    onChange(format(parsedDate, "yyyy-MM-dd"));
    setInputValue(format(parsedDate, "dd/M/yyyy"));
    onBlur?.();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) onBlur?.();
      }}
    >
      <div
        className={cn(
          "grid h-10 w-full grid-cols-[1fr_auto] items-center overflow-hidden rounded-lg border border-border text-sm focus-within:ring-2 focus-within:ring-[#1F7A4C]",
          bgSurfaceFilter(Boolean(inputValue)),
          hasError ? "border-red-500" : "border-gray-300",
          disabled ? "bg-muted text-muted-foreground" : "",
          className,
        )}
      >
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onBlur={commitManualDateInput}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitManualDateInput();
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          className="h-full w-full bg-transparent px-3 text-left outline-none disabled:cursor-not-allowed"
          inputMode="numeric"
        />
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className="inline-flex h-full w-10 shrink-0 items-center justify-center border-l border-inherit text-gray-500 hover:bg-muted/70 disabled:opacity-50"
            aria-label="Open calendar"
          >
            <CalendarIcon className="h-4 w-4" />
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent className="w-auto overflow-hidden p-0 shadow-lg" align="end">
        <Calendar
          mode="single"
          selected={selectedDate}
          defaultMonth={selectedDate ?? today}
          captionLayout="dropdown"
          startMonth={startMonth}
          endMonth={endMonth}
          onSelect={(date) => {
            if (date && isDisabledDate?.(date)) return;
            onChange(date ? format(date, "yyyy-MM-dd") : "");
            setOpen(false);
          }}
          disabled={calendarDisabled}
          initialFocus
          modifiers={calendarModifiers}
          modifiersClassNames={calendarModifiersClassNames}
        />
        {selectedDate ? (
          <div className="border-t border-gray-200 p-2">
            <button
              type="button"
              className="w-full rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-50"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              disabled={disabled}
            >
              Clear
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
