"use client";

import { useMemo, useState } from "react";
import { format, isValid, parseISO } from "date-fns";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { cn } from "@/lib/utils";
import { Calendar } from "./calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

type DateRangePickerProps = {
  value?: { from?: string; to?: string };
  onChange: (value: { from?: string; to?: string }) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  hasError?: boolean;
  onBlur?: () => void;
};

function formatLabel(range?: DateRange): string {
  if (!range?.from && !range?.to) return "";
  if (range?.from && !range?.to) return format(range.from, "MMM dd, yyyy");
  if (!range?.from && range?.to) return format(range.to, "MMM dd, yyyy");
  return `${format(range.from as Date, "MMM dd, yyyy")} - ${format(
    range.to as Date,
    "MMM dd, yyyy",
  )}`;
}

export function DateRangePicker({
  value,
  onChange,
  disabled,
  placeholder = "Pick a date range",
  className,
  hasError,
  onBlur,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);

  const selectedRange = useMemo<DateRange | undefined>(() => {
    const from = value?.from ? parseISO(value.from) : undefined;
    const to = value?.to ? parseISO(value.to) : undefined;
    return {
      from: from && isValid(from) ? from : undefined,
      to: to && isValid(to) ? to : undefined,
    };
  }, [value?.from, value?.to]);

  const today = new Date();
  const selectedYear =
    selectedRange?.from?.getFullYear() ??
    selectedRange?.to?.getFullYear() ??
    today.getFullYear();
  const startMonth = new Date(selectedYear - 10, 0);
  const endMonth = new Date(selectedYear + 10, 11);

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) onBlur?.();
      }}
    >
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
          {selectedRange?.from || selectedRange?.to ? (
            <span className="text-[var(--primary-color)]">{formatLabel(selectedRange)}</span>
          ) : (
            <span className="text-gray-400">{placeholder}</span>
          )}
          <CalendarIcon className="h-4 w-4 text-gray-500" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={selectedRange}
          defaultMonth={selectedRange?.from ?? today}
          captionLayout="dropdown"
          startMonth={startMonth}
          endMonth={endMonth}
          onSelect={(range) => {
            onChange({
              from: range?.from ? format(range.from, "yyyy-MM-dd") : undefined,
              to: range?.to ? format(range.to, "yyyy-MM-dd") : undefined,
            });
          }}
          disabled={disabled}
          numberOfMonths={2}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
