"use client";

import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import "./calendar.css";

import { cn } from "@/lib/utils";

/** Modifier class for days with an existing setup / balance marker dot. */
export const CALENDAR_MARKED_DAY_CLASS = "sts-calendar-day-marked";

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("sts-calendar p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-4",
        month: "space-y-4",
        month_caption: "relative z-10 mx-auto flex h-8 w-fit items-center justify-center",
        caption: "relative flex items-center justify-center pt-1 min-h-8",
        caption_label: "hidden",
        dropdowns: "pointer-events-auto flex items-center gap-2",
        dropdown_root: "relative",
        dropdown:
          "h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
        chevron: "h-4 w-4 text-muted-foreground",
        nav: "pointer-events-none absolute inset-x-1 top-3 z-20 flex items-center justify-between",
        button_previous:
          "pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-foreground hover:bg-muted/80",
        button_next:
          "pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-foreground hover:bg-muted/80",
        weekdays: "flex",
        weekday: "w-9 rounded-md text-[0.8rem] font-medium text-muted-foreground",
        week: "mt-2 flex w-full",
        day: "rdp-day h-9 w-9 p-0 text-center text-sm",
        day_button: "rdp-day_button h-9 w-9 p-0 font-medium",
        selected: "rdp-selected",
        today: "rdp-today",
        outside: "rdp-outside",
        disabled: "rdp-disabled",
        range_start: "rdp-range_start",
        range_middle: "rdp-range_middle",
        range_end: "rdp-range_end",
        hidden: "invisible",
        ...classNames,
      }}
      {...props}
    />
  );
}

export { Calendar };
