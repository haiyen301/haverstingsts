"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import { X } from "lucide-react";

import { Calendar } from "@/shared/ui/date-picker/calendar";

type Props = {
  open: boolean;
  onClose: () => void;
  value: { start: Date; end: Date };
  onApply: (next: { start: Date; end: Date }) => void;
  t: (key: string) => string;
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function startOfWeekMon(d: Date): Date {
  const x = startOfDay(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x;
}

function mergeDateAndTime(datePart: Date, h: number, m: number): Date {
  const x = new Date(datePart);
  x.setHours(h, m, 0, 0);
  return x;
}

function extractHm(d: Date): { h: number; m: number } {
  return { h: d.getHours(), m: d.getMinutes() };
}

function timeSlots(): { key: string; label: string; h: number; m: number }[] {
  const out: { key: string; label: string; h: number; m: number }[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 15, 30, 45]) {
      const d = new Date(2000, 0, 1, h, m);
      const label = d.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      out.push({ key: `${h}-${m}`, label, h, m });
    }
  }
  return out;
}

export function TimelineTaskDateTimePanel({
  open,
  onClose,
  value,
  onApply,
  t,
}: Props) {
  const slots = useMemo(() => timeSlots(), []);
  const [range, setRange] = useState<DateRange | undefined>();
  const [startHm, setStartHm] = useState({ h: 9, m: 0 });
  const [endHm, setEndHm] = useState({ h: 17, m: 0 });

  useEffect(() => {
    if (!open) return;
    setRange({
      from: startOfDay(value.start),
      to: startOfDay(value.end),
    });
    setStartHm(extractHm(value.start));
    setEndHm(extractHm(value.end));
  }, [open, value.start, value.end]);

  const applyLocal = useCallback(() => {
    const from = range?.from ?? startOfDay(value.start);
    const to = range?.to ?? range?.from ?? startOfDay(value.end);
    const start = mergeDateAndTime(from, startHm.h, startHm.m);
    const end = mergeDateAndTime(to, endHm.h, endHm.m);
    onApply(start <= end ? { start, end } : { start: end, end: start });
    onClose();
  }, [range, value.start, value.end, startHm, endHm, onApply, onClose]);

  const today = useMemo(() => startOfDay(new Date()), []);
  const monthAnchor = range?.from ?? range?.to ?? today;
  const selectedYear = monthAnchor.getFullYear();
  const startMonth = new Date(selectedYear - 5, 0);
  const endMonth = new Date(selectedYear + 5, 11);

  const preset = (label: string, fn: () => void) => (
    <button
      key={label}
      type="button"
      onClick={fn}
      className="w-full rounded-md px-2 py-1.5 text-left text-xs text-gray-700 hover:bg-violet-50"
    >
      {label}
    </button>
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/30 p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[min(92vh,720px)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
          <span className="text-sm font-semibold text-gray-900">
            {t("pickDateTime")}
          </span>
          <button
            type="button"
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"
            onClick={onClose}
            aria-label={t("closePicker")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="w-full shrink-0 border-b border-gray-100 p-2 md:w-40 md:border-b-0 md:border-r">
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">
              {t("presets")}
            </p>
            <div className="flex flex-row flex-wrap gap-0.5 md:flex-col">
              {preset(t("presetToday"), () => {
                setRange({ from: today, to: today });
              })}
              {preset(t("presetTomorrow"), () => {
                const d = addDays(today, 1);
                setRange({ from: d, to: d });
              })}
              {preset(t("presetThisWeekend"), () => {
                const dow = today.getDay();
                const sat = addDays(today, (6 - dow + 7) % 7);
                const sun = addDays(sat, 1);
                setRange({ from: sat, to: sun });
              })}
              {preset(t("presetNextWeek"), () => {
                const mon = addDays(startOfWeekMon(today), 7);
                const sun = addDays(mon, 6);
                setRange({ from: mon, to: sun });
              })}
              {preset(t("presetTwoWeeks"), () => {
                setRange({ from: today, to: addDays(today, 13) });
              })}
              {preset(t("presetFourWeeks"), () => {
                setRange({ from: today, to: addDays(today, 27) });
              })}
            </div>
          </div>

          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto border-b border-gray-100 p-2 md:border-b-0 md:border-r">
            <Calendar
              mode="range"
              selected={range}
              onSelect={(r) => setRange(r)}
              defaultMonth={monthAnchor}
              captionLayout="dropdown"
              startMonth={startMonth}
              endMonth={endMonth}
              numberOfMonths={1}
            />
          </div>

          <div className="flex max-h-48 min-h-0 w-full shrink-0 md:max-h-none md:w-54 md:flex-col">
            <div className="flex min-h-0 flex-1 flex-col border-r border-gray-100 md:border-r-0 md:border-b">
              <p className="shrink-0 bg-gray-50 px-2 py-1 text-[10px] font-medium uppercase text-gray-500">
                {t("startTime")}
              </p>
              <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
                {slots.map((s) => (
                  <button
                    key={`s-${s.key}`}
                    type="button"
                    onClick={() => setStartHm({ h: s.h, m: s.m })}
                    className={`w-full rounded-md px-2 py-1 text-left text-xs ${
                      startHm.h === s.h && startHm.m === s.m
                        ? "bg-violet-600 text-white"
                        : "text-gray-700 hover:bg-gray-100"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <p className="shrink-0 bg-gray-50 px-2 py-1 text-[10px] font-medium uppercase text-gray-500">
                {t("endTime")}
              </p>
              <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
                {slots.map((s) => (
                  <button
                    key={`e-${s.key}`}
                    type="button"
                    onClick={() => setEndHm({ h: s.h, m: s.m })}
                    className={`w-full rounded-md px-2 py-1 text-left text-xs ${
                      endHm.h === s.h && endHm.m === s.m
                        ? "bg-violet-600 text-white"
                        : "text-gray-700 hover:bg-gray-100"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 px-3 py-2">
          <button
            type="button"
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            onClick={onClose}
          >
            {t("cancelPicker")}
          </button>
          <button
            type="button"
            className="rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-violet-700"
            onClick={applyLocal}
          >
            {t("applyDateTime")}
          </button>
        </div>
      </div>
    </div>
  );
}
