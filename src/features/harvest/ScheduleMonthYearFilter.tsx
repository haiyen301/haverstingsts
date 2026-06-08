"use client";

import { useMemo } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import {
  bgSurfaceFilter,
  FILTER_COLOR_EMPTY_CLASS,
  FILTER_COLOR_FILLED_CLASS,
} from "@/shared/lib/surfaceFilter";
import "./schedule-month-year-filter.css";

const YEAR_SPAN_PAST = 3;
const YEAR_SPAN_FUTURE = 4;

type ScheduleMonthYearFilterProps = {
  month: number;
  year: number;
  onChange: (month: number, year: number) => void;
  /** Shorter month labels and tighter layout (calendar toolbar). */
  compact?: boolean;
  disabled?: boolean;
  className?: string;
};

export function ScheduleMonthYearFilter({
  month,
  year,
  onChange,
  compact = false,
  disabled = false,
  className,
}: ScheduleMonthYearFilterProps) {
  const t = useTranslations("HarvestSchedule");
  const locale = useLocale();
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const isDefaultPeriod = month === currentMonth && year === currentYear;

  const monthOptions = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => ({
        value: i,
        label: new Date(2024, i, 1).toLocaleDateString(locale, {
          month: compact ? "short" : "long",
        }),
      })),
    [compact, locale],
  );

  const yearOptions = useMemo(() => {
    const from = currentYear - YEAR_SPAN_PAST;
    const to = currentYear + YEAR_SPAN_FUTURE;
    const years: number[] = [];
    for (let y = from; y <= to; y += 1) years.push(y);
    return years;
  }, [currentYear]);

  const surfaceClass = bgSurfaceFilter(!isDefaultPeriod);
  const filterTextClass = isDefaultPeriod
    ? FILTER_COLOR_EMPTY_CLASS
    : FILTER_COLOR_FILLED_CLASS;

  const selectClass = cn(
    "min-w-0 cursor-pointer appearance-none rounded-md border-0 bg-transparent py-0 font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring",
    compact ? "h-8 pl-1 pr-5 text-xs" : "h-9 pl-2 pr-7 text-sm",
  );

  return (
    <div
      className={cn(
        "sts-schedule-month-year-filter inline-flex items-center gap-0.5 rounded-md border border-input",
        compact ? "min-h-8 gap-0" : "min-h-10 gap-1 text-sm",
        surfaceClass,
        !isDefaultPeriod ? "hover:opacity-95" : "hover:bg-btnhover/40",
        compact && "sts-schedule-month-year-filter--compact",
        disabled && "sts-schedule-month-year-filter--disabled",
        className,
      )}
      aria-disabled={disabled}
    >
      <span
        className={cn(
          "sts-schedule-month-year-filter__icon inline-flex shrink-0 items-center",
          filterTextClass,
          compact ? "hidden pl-0" : "pl-3",
        )}
      >
        <CalendarDays className="h-3.5 w-3.5" aria-hidden />
      </span>
      <div className="sts-schedule-month-year-filter__month relative w-max">
        <select
          className={cn(selectClass, compact && "w-auto max-w-none")}
          value={month}
          disabled={disabled}
          aria-label={t("filterMonthLabel")}
          onChange={(e) => onChange(Number(e.target.value), year)}
        >
          {monthOptions.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <ChevronDown
          className={cn(
            "pointer-events-none absolute top-1/2 -translate-y-1/2",
            filterTextClass,
            compact ? "right-0.5 h-3 w-3" : "right-1.5 h-3.5 w-3.5",
          )}
          aria-hidden
        />
      </div>
      <div className="sts-schedule-month-year-filter__year relative w-max shrink-0 pr-1">
        <select
          className={cn(selectClass, compact ? "w-auto pr-5" : "pr-7")}
          value={year}
          disabled={disabled}
          aria-label={t("filterYearLabel")}
          onChange={(e) => onChange(month, Number(e.target.value))}
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <ChevronDown
          className={cn(
            "pointer-events-none absolute top-1/2 -translate-y-1/2",
            filterTextClass,
            compact ? "right-1 h-3 w-3" : "right-3 h-3.5 w-3.5",
          )}
          aria-hidden
        />
      </div>
    </div>
  );
}
