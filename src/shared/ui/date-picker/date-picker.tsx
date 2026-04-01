"use client";

import { useMemo, useState } from "react";
import { format, isValid, parseISO } from "date-fns";
import { CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Calendar } from "./calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

type DatePickerProps = {
  value?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  hasError?: boolean;
  onBlur?: () => void;
};

export function DatePicker({
  value,
  onChange,
  disabled,
  placeholder = "Pick a date",
  className,
  hasError,
  onBlur,
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
          {selectedDate ? (
            <span>
              {format(selectedDate, "MMM dd, yyyy")}
            </span>
          ) : (
            <span className="text-gray-400">{placeholder}</span>
          )}
          <CalendarIcon className="h-4 w-4 text-gray-500" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selectedDate}
          defaultMonth={selectedDate ?? today}
          captionLayout="dropdown"
          startMonth={startMonth}
          endMonth={endMonth}
          onSelect={(date) => {
            onChange(date ? format(date, "yyyy-MM-dd") : "");
            setOpen(false);
          }}
          disabled={disabled}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
