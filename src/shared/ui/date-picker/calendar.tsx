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
        months: "relative flex flex-col gap-4 sm:flex-row",
        month: "space-y-4",
        month_caption:
          "relative z-10 mx-auto flex w-full items-center justify-center sts-calendar-caption",
        caption: "relative flex items-center justify-center sts-calendar-caption",
        caption_label: "sts-calendar-caption-label",
        dropdowns: "pointer-events-auto flex items-center gap-2 sts-calendar-caption",
        dropdown_root: "relative inline-flex items-center sts-calendar-dropdown-root",
        dropdown: "sts-calendar-dropdown-select",
        chevron: "h-4 w-4 shrink-0 text-muted-foreground",
        nav: "pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between sts-calendar-caption px-0.5",
        button_previous:
          "pointer-events-auto inline-flex shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground hover:bg-muted/80 sts-calendar-nav-button",
        button_next:
          "pointer-events-auto inline-flex shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground hover:bg-muted/80 sts-calendar-nav-button",
        month_grid: "w-full border-collapse",
        weekdays: "",
        weekday: "rounded-md text-[0.8rem] font-medium text-muted-foreground",
        week: "",
        day: "rdp-day p-0 text-center text-sm",
        day_button: "rdp-day_button p-0 font-medium",
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
