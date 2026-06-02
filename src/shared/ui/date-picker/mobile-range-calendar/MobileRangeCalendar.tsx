"use client";

import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { isSameDay } from "date-fns";

import { cn } from "@/lib/utils";

import {
  MOBILE_RANGE_MONTH_GRIDS,
  type LocalDateRange,
  type MonthDayCell,
  type MonthGrid,
  getDayRangeState,
  monthKey,
  pickRangeDay,
} from "./utils";
import "./mobile-range-calendar.css";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;

type MobileRangeCalendarProps = {
  range?: LocalDateRange;
  onRangeChange: (range: LocalDateRange | undefined) => void;
  scrollToMonthKey?: string;
  className?: string;
};

type MonthBlockProps = {
  grid: MonthGrid;
  range?: LocalDateRange;
  today: Date;
  onDayClick: (day: Date) => void;
};

const MonthBlock = memo(function MonthBlock({ grid, range, today, onDayClick }: MonthBlockProps) {
  return (
    <section className="sts-mobile-range-month" aria-label={grid.title}>
      <h3 className="sts-mobile-range-month__title">{grid.title}</h3>
      <div className="sts-mobile-range-month__weeks">
        {grid.weeks.map((week, weekIndex) => (
          <div key={`${grid.key}-w-${weekIndex}`} className="sts-mobile-range-month__week">
            {week.map((cell, dayIndex) => (
              <DayCell
                key={cell?.ymd ?? `${grid.key}-e-${weekIndex}-${dayIndex}`}
                cell={cell}
                range={range}
                today={today}
                onDayClick={onDayClick}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
});

type DayCellProps = {
  cell: MonthDayCell | null;
  range?: LocalDateRange;
  today: Date;
  onDayClick: (day: Date) => void;
};

const DayCell = memo(function DayCell({ cell, range, today, onDayClick }: DayCellProps) {
  if (!cell) {
    return <div className="sts-mobile-range-day sts-mobile-range-day--empty" aria-hidden />;
  }

  const state = getDayRangeState(cell.date, range);
  const isToday = isSameDay(cell.date, today);

  return (
    <div
      className={cn(
        "sts-mobile-range-day",
        state !== "none" && `sts-mobile-range-day--${state}`,
        isToday && "sts-mobile-range-day--today",
      )}
    >
      <button
        type="button"
        className="sts-mobile-range-day__button"
        onClick={() => onDayClick(cell.date)}
        aria-label={cell.ymd}
        aria-pressed={state !== "none"}
      >
        {cell.label}
      </button>
    </div>
  );
});

export function MobileRangeCalendar({
  range,
  onRangeChange,
  scrollToMonthKey,
  className,
}: MobileRangeCalendarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const monthRefs = useRef<Map<string, HTMLElement>>(new Map());
  const today = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  }, []);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !scrollToMonthKey) return;

    const target = monthRefs.current.get(scrollToMonthKey);
    if (!target) return;

    target.scrollIntoView({ block: "start" });
  }, [scrollToMonthKey]);

  const handleDayClick = useCallback(
    (day: Date) => {
      onRangeChange(pickRangeDay(range, day));
    },
    [onRangeChange, range],
  );

  return (
    <div className={cn("sts-mobile-range-calendar", className)}>
      <div className="grid shrink-0 grid-cols-7 border-b border-border bg-background px-4 py-2 text-center text-xs font-medium text-muted-foreground">
        {WEEKDAY_LABELS.map((label, index) => (
          <span key={`${label}-${index}`} className="flex items-center justify-center">
            {label}
          </span>
        ))}
      </div>

      <div
        ref={scrollRef}
        className="sts-mobile-range-calendar__scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-2 [-webkit-overflow-scrolling:touch]"
      >
        {MOBILE_RANGE_MONTH_GRIDS.map((grid) => (
          <div
            key={grid.key}
            ref={(node) => {
              if (node) monthRefs.current.set(grid.key, node);
              else monthRefs.current.delete(grid.key);
            }}
          >
            <MonthBlock grid={grid} range={range} today={today} onDayClick={handleDayClick} />
          </div>
        ))}
      </div>
    </div>
  );
}

export { monthKey };
