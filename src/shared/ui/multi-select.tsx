"use client";

import { Check, Search, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  FILTER_BG_FILLED_CLASS,
  FILTER_BORDER_FILLED_CLASS,
  FILTER_COLOR_EMPTY_CLASS,
  FILTER_COLOR_FILLED_CLASS,
} from "@/shared/lib/surfaceFilter";
import { TruncatedText } from "@/shared/ui/truncated-text";

function MultiSelectOptionLabel({
  option,
  trigger = false,
}: {
  option: MultiSelectOption;
  trigger?: boolean;
}) {
  if (!option.subLabel) {
    return (
      <TruncatedText
        text={option.label}
        className={cn("min-w-0 flex-1 pr-2", trigger && "text-sm")}
      />
    );
  }

  return (
    <span className="min-w-0 flex-1 pr-2 text-left">
      <span
        className={cn(
          "block font-medium leading-snug text-foreground",
          trigger ? "truncate text-sm" : "text-sm",
        )}
      >
        {option.label}
      </span>
      <span
        className={cn(
          "mt-0.5 block leading-snug text-muted-foreground whitespace-normal wrap-break-word",
          trigger ? "line-clamp-2 text-[11px]" : "text-[11px]",
        )}
      >
        {option.subLabel}
      </span>
    </span>
  );
}

export type MultiSelectOption = {
  value: string;
  label: string;
  /** Smaller secondary line shown below `label` in the dropdown and closed trigger. */
  subLabel?: string;
};

type SelectionSummaryMode = "count" | "compact" | "full";

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
   * How selected values appear in the closed trigger.
   * - `count`: "N selected"
   * - `compact`: all labels when few selected; first N labels + `+M` when above threshold
   * - `full`: comma-separated labels (may wrap — use sparingly)
   */
  selectionSummary?: SelectionSummaryMode;
  /**
   * @deprecated Prefer `selectionSummary="full"`.
   * When `true` and more than one value is selected, the trigger shows every selected label
   * (comma-separated) instead of “N selected”.
   */
  showFullSelectedLabels?: boolean;
  /** Show removable chips for current selections at the top of the dropdown. Default `true`. */
  showSelectedChipsInPopover?: boolean;
  formatSelectedCount?: (count: number) => string;
  formatMoreCount?: (count: number) => string;
  /**
   * In `compact` mode, show all selected labels (comma-separated) when count is at or below
   * this number. Above the threshold, show the first N labels with a `+M` badge.
   */
  compactNameThreshold?: number;
  /**
   * When above `compactNameThreshold`, how many labels to show before the `+M` badge
   * on the closed trigger (and in the many-selected dropdown summary).
   */
  compactBadgeNamePreview?: number;
  /** Max removable chips shown in the dropdown; above this, show a compact summary instead. */
  maxSelectedChipsPreview?: number;
  formatManySelectedHint?: (count: number) => string;
  /** Show an "All" option at the top of the dropdown; selecting it clears the filter. */
  showAllOption?: boolean;
  /** Label for the "All" option; defaults to `placeholder` when `showAllOption` is true. */
  allOptionLabel?: string;
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
  selectionSummary,
  showFullSelectedLabels = false,
  showSelectedChipsInPopover = true,
  formatSelectedCount,
  formatMoreCount,
  compactNameThreshold = 6,
  compactBadgeNamePreview = 3,
  maxSelectedChipsPreview = 6,
  formatManySelectedHint,
  showAllOption = false,
  allOptionLabel,
}: MultiSelectProps) {
  const [keyword, setKeyword] = useState("");
  const [open, setOpen] = useState(false);
  const selected = values.length;
  const max = multi ? (maxSelections ?? Infinity) : 1;
  const summaryMode: SelectionSummaryMode =
    selectionSummary ?? (showFullSelectedLabels ? "full" : "count");

  const selectedOptions = useMemo(
    () => values.map((v) => options.find((x) => x.value === v)).filter(Boolean) as MultiSelectOption[],
    [options, values],
  );

  const selectedLabels = useMemo(
    () => selectedOptions.map((opt) => opt.label),
    [selectedOptions],
  );

  const selectedPrimaryOption = selected === 1 ? selectedOptions[0] : undefined;

  const fullMultiLabel = useMemo(() => {
    if (selected <= 1) return selectedLabels[0] ?? "";
    return selectedLabels.length
      ? selectedLabels.join(", ")
      : formatSelectedCount?.(selected) ?? `${selected} selected`;
  }, [formatSelectedCount, selected, selectedLabels]);

  const compactLabel = useMemo(() => {
    if (selected === 0) return placeholder;
    if (selected === 1) return selectedLabels[0] ?? placeholder;
    const first = selectedLabels[0] ?? "";
    const more = selected - 1;
    const moreText = formatMoreCount?.(more) ?? `+${more} more`;
    return first ? `${first} ${moreText}` : formatSelectedCount?.(selected) ?? `${selected} selected`;
  }, [formatMoreCount, formatSelectedCount, placeholder, selected, selectedLabels]);

  const countLabel = useMemo(() => {
    if (selected === 0) return placeholder;
    if (selected === 1) return selectedLabels[0] ?? placeholder;
    return formatSelectedCount?.(selected) ?? `${selected} selected`;
  }, [formatSelectedCount, placeholder, selected, selectedLabels]);

  const label =
    summaryMode === "full"
      ? selected === 0
        ? placeholder
        : fullMultiLabel
      : summaryMode === "compact"
        ? compactLabel
        : countLabel;

  const normalizedKeyword = keyword.trim().toLowerCase();
  const filteredOptions = useMemo(() => {
    if (!normalizedKeyword) return options;
    return options.filter((opt) => {
      const haystack = `${opt.label} ${opt.subLabel ?? ""} ${opt.value}`.toLowerCase();
      return haystack.includes(normalizedKeyword);
    });
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

  const showCompactAllNames =
    summaryMode === "compact" &&
    selected > 1 &&
    selected <= compactNameThreshold;
  const showCountBadge =
    summaryMode === "compact" && selected > compactNameThreshold;
  const showChipPreview =
    multi &&
    showSelectedChipsInPopover &&
    values.length > 0 &&
    values.length <= maxSelectedChipsPreview;
  const showManySelectedSummary =
    multi &&
    showSelectedChipsInPopover &&
    values.length > maxSelectedChipsPreview;

  const expandTrigger = summaryMode === "full" && selected > 1;
  const triggerTitle =
    selected > 1 && summaryMode !== "full"
      ? fullMultiLabel
      : selectedPrimaryOption?.subLabel
        ? `${selectedPrimaryOption.label} ${selectedPrimaryOption.subLabel}`
        : undefined;
  const showStackedTrigger = selected === 1 && Boolean(selectedPrimaryOption?.subLabel);

  const compactBadgePreviewLabels = useMemo(() => {
    const count = Math.min(compactBadgeNamePreview, selectedLabels.length);
    return selectedLabels.slice(0, count);
  }, [compactBadgeNamePreview, selectedLabels]);
  const compactBadgeRestCount = Math.max(0, selected - compactBadgePreviewLabels.length);
  const filterTextClass =
    selected === 0 ? FILTER_COLOR_EMPTY_CLASS : FILTER_COLOR_FILLED_CLASS;
  const allLabel = allOptionLabel ?? placeholder;
  const allSelected = values.length === 0;

  const selectAll = () => {
    onChange([]);
    if (max === 1) {
      setOpen(false);
    }
  };

  return (
    <Popover modal={false} open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={triggerTitle}
          className={cn(
            "inline-flex w-full items-center justify-between gap-2 rounded-full border px-3 text-xs disabled:cursor-not-allowed disabled:opacity-60",
            selected === 0 ? "border-gray-300" : cn(FILTER_BG_FILLED_CLASS, FILTER_BORDER_FILLED_CLASS),
            expandTrigger
              ? "min-h-9 items-start py-2 leading-snug"
              : showStackedTrigger
                ? "min-h-9 items-start py-2 leading-snug"
                : "h-10 items-center",
            className,
            (expandTrigger || showStackedTrigger) && "h-auto min-h-9 overflow-visible",
          )}
        >
          {expandTrigger ? (
            <span
              className={cn(
                "min-w-0 flex-1 text-left whitespace-normal wrap-break-word",
                filterTextClass,
              )}
            >
              {label}
            </span>
          ) : showStackedTrigger && selectedPrimaryOption ? (
            <MultiSelectOptionLabel option={selectedPrimaryOption} trigger />
          ) : showCountBadge ? (
            <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-left">
              <TruncatedText
                text={compactBadgePreviewLabels.join(", ") || label}
                className={cn("min-w-0 flex-1", filterTextClass)}
              />
              {compactBadgeRestCount > 0 ? (
                <span className="inline-flex shrink-0 items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium tabular-nums text-primary">
                  +{compactBadgeRestCount}
                </span>
              ) : null}
            </span>
          ) : showCompactAllNames ? (
            <TruncatedText
              text={selectedLabels.join(", ")}
              className={cn("min-w-0 flex-1 text-left", filterTextClass)}
            />
          ) : selected === 0 ? (
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-left",
                FILTER_COLOR_EMPTY_CLASS,
              )}
            >
              {label}
            </span>
          ) : (
            <TruncatedText
              text={label}
              className={cn("min-w-0 flex-1 text-left", FILTER_COLOR_FILLED_CLASS)}
            />
          )}
          {rightIcon ? (
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-0.5",
                filterTextClass,
                expandTrigger && "self-start pt-0.5",
                showStackedTrigger && "self-start pt-0.5",
              )}
            >
              {rightIcon}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn(
          "w-(--radix-popover-trigger-width) p-2",
          options.some((opt) => opt.subLabel)
            ? "max-w-[min(560px,calc(100vw-1.5rem))]"
            : "max-w-[min(420px,calc(100vw-1.5rem))]",
        )}
      >
        {showChipPreview ? (
          <div className="mb-2 space-y-1.5">
            <div className="flex items-center justify-between px-0.5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {formatSelectedCount?.(values.length) ?? `${values.length} selected`}
              </p>
              <button
                type="button"
                onClick={() => onChange([])}
                disabled={disabled}
                className="text-[11px] font-medium text-primary hover:underline disabled:opacity-40"
              >
                Clear all
              </button>
            </div>
          </div>
        ) : null}
        {showManySelectedSummary ? (
          <div className="mb-2 flex items-start justify-between gap-3 px-0.5">
            <p className="min-w-0 text-[11px] text-muted-foreground">
              {formatManySelectedHint?.(values.length) ??
                "Search below to uncheck."}
            </p>
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={disabled}
              className="shrink-0 text-xs font-medium text-primary hover:underline disabled:opacity-40"
            >
              Clear all
            </button>
          </div>
        ) : null}
        <div className="mb-2 flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="Search..."
              className="h-8 w-full rounded-md border border-gray-300 bg-white pl-2 pr-2 text-xs text-gray-700 placeholder:text-placeholder-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#1F7A4C]"
            />
            <Search className="pointer-events-none absolute right-1 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          </div>
          {(!showChipPreview && !showManySelectedSummary) ? (
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={disabled || values.length === 0}
              className="rounded px-2 py-1 text-xs font-medium text-foreground hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Clear
            </button>
          ) : null}
        </div>
        <div className="max-h-64 overflow-auto">
          {showAllOption ? (
            <>
              <button
                type="button"
                onClick={selectAll}
                disabled={disabled}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-gray-100 disabled:opacity-40",
                  allSelected && "bg-primary/5",
                )}
              >
                <TruncatedText text={allLabel} className="min-w-0 flex-1 pr-2" />
                <Check
                  className={cn(
                    "h-4 w-4 min-h-4 min-w-4 shrink-0 text-foreground",
                    allSelected ? "opacity-100" : "opacity-0",
                  )}
                />
              </button>
              {filteredOptions.length > 0 ? (
                <div className="my-1 border-t border-gray-200" />
              ) : null}
            </>
          ) : null}
          {!showAllOption && filteredOptions.length === 0 ? (
            <p className="px-2 py-2 text-xs text-gray-500">No options found.</p>
          ) : null}
          {showAllOption && filteredOptions.length === 0 && normalizedKeyword ? (
            <p className="px-2 py-2 text-xs text-gray-500">No options found.</p>
          ) : null}
          {filteredOptions.map((opt) => {
            const checked = values.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggleValue(opt.value)}
                className={cn(
                  "flex w-full items-start justify-between rounded-md px-2 py-1.5 text-left hover:bg-gray-100",
                  checked && "bg-primary/5",
                )}
              >
                <MultiSelectOptionLabel option={opt} />
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
