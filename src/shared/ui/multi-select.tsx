"use client";

import { Check, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

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
  /** Set to `false` for single-select behavior. */
  multi?: boolean;
  /** When set to `1`, behaves like a single-select (picking a new option replaces the previous). */
  maxSelections?: number;
  /**
   * When `true` and more than one value is selected, the trigger shows every selected label
   * (comma-separated) instead of “N selected”. Default `false`.
   */
  showFullSelectedLabels?: boolean;
};

export function MultiSelect({
  options,
  values,
  onChange,
  placeholder,
  className,
  rightIcon,
  disabled = false,
  multi = true,
  maxSelections,
  showFullSelectedLabels = false,
}: MultiSelectProps) {
  const [keyword, setKeyword] = useState("");
  const [open, setOpen] = useState(false);
  const selected = values.length;
  const max = multi ? (maxSelections ?? Infinity) : 1;
  const fullMultiLabel = useMemo(() => {
    if (selected <= 1) return "";
    const parts: string[] = [];
    for (const v of values) {
      const found = options.find((x) => x.value === v)?.label;
      if (found) parts.push(found);
    }
    return parts.length ? parts.join(", ") : `${selected} selected`;
  }, [options, selected, values]);
  const label =
    selected === 0
      ? placeholder
      : selected === 1
        ? options.find((x) => x.value === values[0])?.label ?? placeholder
        : showFullSelectedLabels
          ? fullMultiLabel
          : `${selected} selected`;
  const normalizedKeyword = keyword.trim().toLowerCase();
  const filteredOptions = useMemo(() => {
    if (!normalizedKeyword) return options;
    return options.filter((opt) => opt.label.toLowerCase().includes(normalizedKeyword));
  }, [options, normalizedKeyword]);

  const toggleValue = (value: string) => {
    const exists = values.includes(value);
    if (exists) {
      onChange(values.filter((x) => x !== value));
      return;
    }
    if (max === 1) {
      onChange([value]);
      setOpen(false);
      return;
    }
    if (values.length >= max) {
      return;
    }
    onChange([...values, value]);
  };

  const expandTrigger = showFullSelectedLabels && selected > 1;

  return (
    <Popover modal={false} open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "inline-flex w-full items-center justify-between gap-2 rounded-full border border-gray-300 px-3 text-xs text-gray-700 disabled:cursor-not-allowed disabled:opacity-60",
            expandTrigger
              ? "min-h-9 items-start py-2 leading-snug"
              : "h-10 items-center",
            className,
            expandTrigger && "h-auto min-h-9 overflow-visible",
          )}
        >
          <span
            className={cn(
              "min-w-0 flex-1 text-left",
              expandTrigger ? "whitespace-normal wrap-break-word" : "truncate",
            )}
          >
            {label}
          </span>
          {rightIcon ? (
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-0.5 text-gray-800",
                expandTrigger && "self-start pt-0.5",
              )}
            >
              {rightIcon}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[300px] p-2">
        <div className="mb-2 flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="Search..."
              className="h-8 w-full rounded-md border border-gray-300 bg-white pl-2 pr-2 text-xs text-gray-700 placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#1F7A4C]"
            />
            <Search className="pointer-events-none absolute right-1 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          </div>
          <button
            type="button"
            onClick={() => onChange([])}
            disabled={disabled || values.length === 0}
            className="rounded px-2 py-1 text-xs font-medium text-foreground hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Clear
          </button>
        </div>
        <div className="max-h-64 overflow-auto">
          {filteredOptions.length === 0 ? (
            <p className="px-2 py-2 text-xs text-gray-500">No options found.</p>
          ) : null}
          {filteredOptions.map((opt) => {
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
                    "h-4 w-4 min-h-4 min-w-4 shrink-0 text-foreground",
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
