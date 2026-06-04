"use client";

import { memo, useMemo } from "react";
import { format, isToday } from "date-fns";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { HarvestScheduleDayEntriesDialog } from "./HarvestScheduleDayEntriesDialog";
import { HarvestScheduleDayEntryChip } from "./HarvestScheduleDayEntryChip";
import {
  buildMonthGridRows,
  buildWeekdayLabels,
  resolveDayCellDateBadgeKind,
} from "./harvestScheduleCalendarUtils";
import type { HarvestScheduleCalendarEntry } from "./harvestScheduleTypes";

const MAX_ENTRIES_VISIBLE = 1;

type HarvestScheduleMonthGridProps = {
  viewMonth: Date;
  entriesByYmd: Map<string, HarvestScheduleCalendarEntry[]>;
  filterRangeStart: string;
  filterRangeEnd: string;
  selectedDayYmd: string | null;
  onDaySelect: (ymd: string) => void;
  detailHref: (id: string) => string;
  locale: string;
  isLoading?: boolean;
  className?: string;
};

type DayCellProps = {
  ymd: string;
  date: Date;
  inCurrentMonth: boolean;
  entries: HarvestScheduleCalendarEntry[];
  inFilterWindow: boolean;
  isSelected: boolean;
  onSelect: (ymd: string) => void;
  detailHref: (id: string) => string;
  locale: string;
  weekend: boolean;
};

const HarvestDayCell = memo(function HarvestDayCell({
  ymd,
  date,
  inCurrentMonth,
  entries,
  inFilterWindow,
  isSelected,
  onSelect,
  detailHref,
  locale,
  weekend,
}: DayCellProps) {
  const t = useTranslations("HarvestSchedule");
  const today = isToday(date);
  const visible = entries.slice(0, MAX_ENTRIES_VISIBLE);
  const hiddenCount = Math.max(0, entries.length - visible.length);
  const dayDateBadgeKind = useMemo(
    () => resolveDayCellDateBadgeKind(ymd, entries),
    [ymd, entries],
  );

  return (
    <div
      role="gridcell"
      className={cn(
        "sts-hsc-cell",
        weekend && "sts-hsc-cell--weekend",
        !inCurrentMonth && "sts-hsc-cell--outside",
        inFilterWindow && "sts-hsc-cell--in-window",
        entries.length > 0 && "sts-hsc-cell--harvest",
        isSelected && "sts-hsc-cell--selected",
        today && "sts-hsc-cell--today",
      )}
    >
      {dayDateBadgeKind ? (
        <span
          className={cn(
            "sts-hsc-cell-day-badge",
            dayDateBadgeKind === "actual" && "sts-hsc-cell-day-badge--actual",
            dayDateBadgeKind === "estimated" && "sts-hsc-cell-day-badge--estimated",
          )}
          title={
            dayDateBadgeKind === "actual"
              ? t("harvestDate")
              : t("dayDateBadgeEstimate")
          }
          aria-label={
            dayDateBadgeKind === "actual"
              ? t("harvestDate")
              : t("dayDateBadgeEstimate")
          }
        >
          {dayDateBadgeKind === "actual"
            ? t("dayDateBadgeActualShort")
            : t("dayDateBadgeEstimateShort")}
        </span>
      ) : null}
      {entries.length > 0 ? (
        <HarvestScheduleDayEntriesDialog
          date={date}
          entries={entries}
          detailHref={detailHref}
          locale={locale}
          desktopMoreHiddenCount={hiddenCount}
        />
      ) : null}
      <div className="sts-hsc-cell-day-header">
        <button
          type="button"
          disabled={!inFilterWindow}
          onClick={() => onSelect(ymd)}
          className="sts-hsc-cell-day-btn"
          aria-label={format(date, "MMMM d, yyyy")}
          aria-pressed={isSelected}
        >
          {date.getDate()}
        </button>
      </div>
      {entries.length > 0 ? (
        <div className="sts-hsc-cell-events">
          <div className="sts-hsc-cell-events-desktop">
            {visible.map((entry) => (
              <div key={`${ymd}-${entry.id}`} className="sts-hsc-cell-entry-slot">
                <HarvestScheduleDayEntryChip
                  entry={entry}
                  href={detailHref(entry.id)}
                  locale={locale}
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
});

export const HarvestScheduleMonthGrid = memo(function HarvestScheduleMonthGrid({
  viewMonth,
  entriesByYmd,
  filterRangeStart,
  filterRangeEnd,
  selectedDayYmd,
  onDaySelect,
  detailHref,
  locale,
  isLoading = false,
  className,
}: HarvestScheduleMonthGridProps) {
  const rows = useMemo(() => buildMonthGridRows(viewMonth), [viewMonth]);
  const weekdayLabels = useMemo(() => buildWeekdayLabels(locale), [locale]);

  const filterStart = filterRangeStart.trim().slice(0, 10);
  const filterEnd = filterRangeEnd.trim().slice(0, 10);

  return (
    <div
      className={cn("sts-hsc-month-grid", isLoading && "sts-hsc-month-grid--loading", className)}
      role="grid"
      aria-busy={isLoading}
    >
      <div className="sts-hsc-grid-head" role="row">
        <div className="sts-hsc-week-col" role="columnheader" aria-hidden />
        {weekdayLabels.map((label, index) => (
          <div
            key={label}
            className={cn(
              "sts-hsc-weekday",
              (index === 0 || index === 6) && "sts-hsc-weekday--weekend",
            )}
            role="columnheader"
          >
            {label}
          </div>
        ))}
      </div>

      <div className="sts-hsc-grid-body">
        {rows.map((row) => (
          <div key={row.week} className="sts-hsc-grid-row" role="row">
            <div className="sts-hsc-week-col sts-hsc-week-num" role="rowheader">
              {row.week}
            </div>
            {row.cells.map((cell) => {
              const dayOfWeek = cell.date.getDay();
              return (
                <HarvestDayCell
                  key={cell.ymd}
                  ymd={cell.ymd}
                  date={cell.date}
                  inCurrentMonth={cell.inCurrentMonth}
                  entries={entriesByYmd.get(cell.ymd) ?? []}
                  inFilterWindow={cell.ymd >= filterStart && cell.ymd <= filterEnd}
                  isSelected={selectedDayYmd === cell.ymd}
                  onSelect={onDaySelect}
                  detailHref={detailHref}
                  locale={locale}
                  weekend={dayOfWeek === 0 || dayOfWeek === 6}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
});
