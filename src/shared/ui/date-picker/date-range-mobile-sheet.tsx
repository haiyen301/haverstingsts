"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { startOfMonth } from "date-fns";
import { Pencil, X } from "lucide-react";

import {
  MobileRangeCalendar,
  monthKey,
} from "./mobile-range-calendar/MobileRangeCalendar";
import {
  clampScrollMonthKey,
  formatRangeHeader,
  toLocalDateRange,
  toYmd,
  type DateRangeValue,
  type LocalDateRange,
} from "./mobile-range-calendar/utils";

type DateRangeMobileSheetProps = {
  open: boolean;
  value?: DateRangeValue;
  onDraftChange: (value: DateRangeValue) => void;
  onApply: () => void;
  onCancel: () => void;
  selectRangeLabel: string;
  doneLabel: string;
  closeLabel: string;
  clearLabel: string;
  /** When set, Clear resets the committed filter (e.g. back to “all”) instead of only clearing the draft. */
  onClear?: () => void;
  selectingEndHint: string;
};

function toDraftValue(range: LocalDateRange | undefined): DateRangeValue {
  return {
    from: range?.from ? toYmd(range.from) : undefined,
    to: range?.to ? toYmd(range.to) : undefined,
  };
}

export function DateRangeMobileSheet({
  open,
  value,
  onDraftChange,
  onApply,
  onCancel,
  selectRangeLabel,
  doneLabel,
  closeLabel,
  clearLabel,
  onClear,
  selectingEndHint,
}: DateRangeMobileSheetProps) {
  const committedRange = useMemo(() => toLocalDateRange(value), [value?.from, value?.to]);
  const [draftRange, setDraftRange] = useState<LocalDateRange | undefined>(committedRange);
  const [scrollToMonthKey, setScrollToMonthKey] = useState<string | undefined>();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    setDraftRange(committedRange);
  }, [committedRange, open]);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const anchor = committedRange?.from ?? committedRange?.to ?? new Date();
    setScrollToMonthKey(clampScrollMonthKey(monthKey(startOfMonth(anchor))));
  }, [open, committedRange?.from, committedRange?.to]);

  const handleRangeChange = (next: LocalDateRange | undefined) => {
    setDraftRange(next);
    onDraftChange(toDraftValue(next));
  };

  const awaitingEndDate = Boolean(draftRange?.from && !draftRange?.to);
  const canApply = Boolean(draftRange?.from && draftRange?.to);
  const canClearDraft = Boolean(draftRange?.from || draftRange?.to);
  const canClearCommitted = Boolean(value?.from || value?.to);
  const showClear = onClear ? canClearDraft || canClearCommitted : canClearDraft;
  const rangeHeader = formatRangeHeader(draftRange);

  const handleClear = () => {
    if (onClear) {
      onClear();
      return;
    }
    handleRangeChange(undefined);
  };

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-120 sm:hidden">
      <button
        type="button"
        className="absolute inset-0 bg-black/50 animate-in fade-in duration-200"
        aria-label={closeLabel}
        onClick={onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="absolute inset-y-0 right-0 flex w-full max-w-full flex-col bg-background shadow-2xl animate-in slide-in-from-right duration-300"
      >
        <div className="shrink-0 bg-primary px-4 pb-4 pt-[max(0.75rem,env(safe-area-inset-top))] text-primary-foreground">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-primary-foreground/90 hover:bg-primary-foreground/10"
              aria-label={closeLabel}
            >
              <X className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={onApply}
              disabled={!canApply}
              className="text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {doneLabel}
            </button>
          </div>
          <p className="mt-4 text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-primary-foreground/80">
            {selectRangeLabel}
          </p>
          <div className="mt-2 flex items-center justify-center gap-2">
            <p className="text-center text-2xl font-semibold tabular-nums">{rangeHeader}</p>
            <Pencil className="h-4 w-4 shrink-0 text-primary-foreground/70" aria-hidden />
          </div>
        </div>

        <MobileRangeCalendar
          className="min-h-0 flex-1"
          range={draftRange}
          onRangeChange={handleRangeChange}
          scrollToMonthKey={scrollToMonthKey}
        />

        <div className="shrink-0 border-t border-border bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {awaitingEndDate ? (
            <p className="mb-3 text-center text-xs text-muted-foreground">{selectingEndHint}</p>
          ) : null}
          <button
            type="button"
            onClick={handleClear}
            disabled={!showClear}
            className="inline-flex h-10 w-full items-center justify-center rounded-md border border-input bg-background text-sm font-medium text-foreground hover:bg-muted/60 disabled:pointer-events-none disabled:opacity-40"
          >
            {clearLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
