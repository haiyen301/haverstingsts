"use client";

import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";

import { cn } from "@/lib/utils";

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-4",
        month: "space-y-4",
        month_caption: "relative z-10 mx-auto flex h-8 w-fit items-center justify-center",
        caption: "relative flex items-center justify-center pt-1 min-h-8",
        caption_label: "hidden",
        
        dropdowns: "pointer-events-auto flex items-center gap-2",
        dropdown_root: "relative",
        dropdown:
          "h-8 rounded-md border border-gray-200 bg-white px-2 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-[#1F7A4C]",
        chevron: "h-4 w-4 text-gray-600",
        nav: "pointer-events-none absolute inset-x-1 top-3 z-20 flex items-center justify-between",
        button_previous:
          "pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
        button_next:
          "pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
        weekdays: "flex",
        weekday: "w-9 rounded-md text-[0.8rem] font-normal text-gray-500",
        week: "mt-2 flex w-full",
        day: "h-9 w-9 p-0 text-center text-sm",
        day_button:
          "h-9 w-9 p-0 font-normal text-gray-900 hover:bg-gray-100",
        selected:
          "bg-[var(--primary-color)]/20",
        today: "bg-gray-100 text-gray-900",
        outside: "text-gray-400 opacity-50",
        disabled: "text-gray-300 opacity-50",
        hidden: "invisible",
        ...classNames,
      }}
      {...props}
    />
  );
}

export { Calendar };
