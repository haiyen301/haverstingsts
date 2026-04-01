"use client";

import { Check } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type MultiSelectOption = {
  value: string;
  label: string;
};

type MultiSelectProps = {
  options: MultiSelectOption[];
  values: string[];
  onChange: (nextValues: string[]) => void;
  placeholder: string;
  className?: string;
  rightIcon?: ReactNode;
  disabled?: boolean;
};

export function MultiSelect({
  options,
  values,
  onChange,
  placeholder,
  className,
  rightIcon,
  disabled = false,
}: MultiSelectProps) {
  const selected = values.length;
  const label =
    selected === 0
      ? placeholder
      : selected === 1
        ? options.find((x) => x.value === values[0])?.label ?? placeholder
        : `${selected} selected`;

  const toggleValue = (value: string) => {
    const exists = values.includes(value);
    if (exists) {
      onChange(values.filter((x) => x !== value));
      return;
    }
    onChange([...values, value]);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "inline-flex h-10 w-full items-center justify-between rounded-full border border-gray-300 px-3 text-xs text-gray-700 disabled:cursor-not-allowed disabled:opacity-60",
            className,
          )}
        >
          <span className="truncate">{label}</span>
          {rightIcon ? (
            <span className="inline-flex items-center gap-0.5 text-gray-800">{rightIcon}</span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[260px] p-2">
        <div className="mb-1 flex items-center justify-end">
          <button
            type="button"
            onClick={() => onChange([])}
            disabled={disabled || values.length === 0}
            className="rounded px-2 py-1 text-xs font-medium text-[#1F7A4C] hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Clear
          </button>
        </div>
        <div className="max-h-64 overflow-auto">
          {options.map((opt) => {
            const checked = values.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggleValue(opt.value)}
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-gray-100"
              >
                <span className="truncate pr-2">{opt.label}</span>
                <Check
                  className={cn(
                    "h-4 w-4 min-h-4 min-w-4 shrink-0 text-[#1F7A4C]",
                    checked ? "opacity-100" : "opacity-0",
                  )}
                />
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

