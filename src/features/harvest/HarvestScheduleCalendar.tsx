"use client";

import { memo, useCallback, useMemo, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { HarvestScheduleMonthGrid } from "./HarvestScheduleMonthGrid";
import { ScheduleMonthYearFilter } from "./ScheduleMonthYearFilter";
import { buildEntriesByYmd, formatMonthYearTitle } from "./harvestScheduleCalendarUtils";
import type { HarvestScheduleCalendarEntry } from "./harvestScheduleTypes";
import "./harvest-schedule-calendar.css";

export type { HarvestScheduleCalendarEntry };

type HarvestScheduleCalendarProps = {
  entries: HarvestScheduleCalendarEntry[];
  filterRangeStart: string;
  filterRangeEnd: string;
  filterMonth: number;
  filterYear: number;
  onFilterMonthYearChange: (month: number, year: number) => void;
  viewMonth: Date;
  onViewMonthChange: (month: Date) => void;
  selectedDayYmd: string | null;
  onSelectedDayYmdChange: (ymd: string | null) => void;
  detailHref: (id: string) => string;
  isLoading?: boolean;
  /** Disable prev/next, Today, and month/year controls while schedule data is loading. */
  navigationDisabled?: boolean;
  statusMessage?: string | null;
  statusIsError?: boolean;
  toolbarLeading?: ReactNode;
  className?: string;
};

export const HarvestScheduleCalendar = memo(function HarvestScheduleCalendar({
  entries,
  filterRangeStart,
  filterRangeEnd,
  filterMonth,
  filterYear,
  onFilterMonthYearChange,
  viewMonth,
  onViewMonthChange,
  selectedDayYmd,
  onSelectedDayYmdChange,
  detailHref,
  isLoading = false,
  navigationDisabled = false,
  statusMessage = null,
  statusIsError = false,
  toolbarLeading,
  className,
}: HarvestScheduleCalendarProps) {
  const t = useTranslations("HarvestSchedule");
  const locale = useLocale();

  const entriesByYmd = useMemo(() => buildEntriesByYmd(entries), [entries]);
  const monthTitle = formatMonthYearTitle(viewMonth, locale);

  const handleDaySelect = useCallback(
    (ymd: string) => {
      if (ymd < filterRangeStart || ymd > filterRangeEnd) return;
      onSelectedDayYmdChange(selectedDayYmd === ymd ? null : ymd);
    },
    [filterRangeEnd, filterRangeStart, onSelectedDayYmdChange, selectedDayYmd],
  );

  const shiftMonth = (delta: number) => {
    if (navigationDisabled) return;
    const next = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + delta, 1);
    onViewMonthChange(next);
    onFilterMonthYearChange(next.getMonth(), next.getFullYear());
  };

  const goToToday = () => {
    if (navigationDisabled) return;
    const today = new Date();
    onViewMonthChange(new Date(today.getFullYear(), today.getMonth(), 1));
    onFilterMonthYearChange(today.getMonth(), today.getFullYear());
  };

  const handleFilterChange = (month: number, year: number) => {
    if (navigationDisabled) return;
    onFilterMonthYearChange(month, year);
    onViewMonthChange(new Date(year, month, 1));
  };

  return (
    <section className={cn("sts-hsc-board flex min-h-0 flex-1 flex-col", className)}>
      <div className="sts-hsc-board-toolbar border-b border-border bg-card px-2 py-1.5 sm:px-4 sm:py-2">
        {toolbarLeading ? (
          <div className="sts-hsc-toolbar-filters">{toolbarLeading}</div>
        ) : null}

        <div className="sts-hsc-toolbar-nav-row">
          <div className="sts-hsc-toolbar-nav-group">
            <div className="sts-hsc-toolbar-pager">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                disabled={navigationDisabled}
                className="sts-hsc-nav-btn sts-hsc-nav-btn--prev shrink-0"
                aria-label={t("calendarPrevMonth")}
                aria-disabled={navigationDisabled}
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                disabled={navigationDisabled}
                className="sts-hsc-nav-btn sts-hsc-nav-btn--next shrink-0"
                aria-label={t("calendarNextMonth")}
                aria-disabled={navigationDisabled}
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            <ScheduleMonthYearFilter
              compact
              disabled={navigationDisabled}
              month={filterMonth}
              year={filterYear}
              onChange={handleFilterChange}
              className="sts-hsc-toolbar-month-filter"
            />
          </div>

          <button
            type="button"
            onClick={goToToday}
            disabled={navigationDisabled}
            className="sts-hsc-today-btn shrink-0"
            aria-disabled={navigationDisabled}
          >
            {t("calendarToday")}
          </button>

          <h2 className="sts-hsc-toolbar-month-title min-w-0 truncate font-heading text-sm font-bold capitalize text-foreground lg:text-lg">
            {monthTitle}
          </h2>
        </div>
      </div>

      <div className="sts-hsc-shell min-h-0 flex-1 overflow-hidden p-2 sm:p-3">
        {statusMessage ? (
          <div
            className={cn(
              "flex min-h-[12rem] flex-1 items-center justify-center p-8 text-sm",
              statusIsError ? "text-red-700" : "text-muted-foreground",
            )}
          >
            {statusMessage}
          </div>
        ) : (
          <HarvestScheduleMonthGrid
            className="min-h-0 flex-1"
            viewMonth={viewMonth}
            entriesByYmd={entriesByYmd}
            filterRangeStart={filterRangeStart}
            filterRangeEnd={filterRangeEnd}
            selectedDayYmd={selectedDayYmd}
            onDaySelect={handleDaySelect}
            detailHref={detailHref}
            locale={locale}
            isLoading={isLoading}
          />
        )}
      </div>
    </section>
  );
});
