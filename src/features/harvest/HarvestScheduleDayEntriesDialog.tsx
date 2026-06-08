"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";

import { HarvestScheduleDayEntryChip } from "./HarvestScheduleDayEntryChip";
import type { HarvestScheduleCalendarEntry } from "./harvestScheduleTypes";

type HarvestScheduleDayEntriesDialogProps = {
  date: Date;
  entries: HarvestScheduleCalendarEntry[];
  detailHref: (id: string) => string;
  locale: string;
  /** Desktop: extra entries beyond the one visible chip. */
  desktopMoreHiddenCount?: number;
};

export function HarvestScheduleDayEntriesDialog({
  date,
  entries,
  detailHref,
  locale,
  desktopMoreHiddenCount = 0,
}: HarvestScheduleDayEntriesDialogProps) {
  const t = useTranslations("HarvestSchedule");
  const [open, setOpen] = useState(false);
  const [portalReady, setPortalReady] = useState(false);

  const dayTitle = date.toLocaleDateString(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const closeDialog = () => setOpen(false);
  const extraOnDay = Math.max(0, entries.length - 1);
  const mobileAriaLabel =
    extraOnDay > 0
      ? t("calendarTapViewPlus", { count: extraOnDay })
      : t("calendarSproutHint");
  const openDialog = (e: MouseEvent) => {
    e.stopPropagation();
    if (open) return;
    setOpen(true);
  };

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDialog();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const mq = window.matchMedia("(max-width: 1023px)");
    if (!mq.matches) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const dialogNode = open ? (
    <div className="sts-hsc-day-dialog-root" role="presentation">
      <button
        type="button"
        className="sts-hsc-day-dialog-backdrop"
        aria-label={t("calendarCloseDayDialog")}
        onClick={closeDialog}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="harvest-schedule-day-dialog-title"
        className="sts-hsc-day-dialog-panel"
      >
        <header className="sts-hsc-day-dialog-header">
          <div className="min-w-0 flex-1">
            <h2
              id="harvest-schedule-day-dialog-title"
              className="text-base font-semibold tracking-tight text-foreground lg:text-lg"
            >
              {dayTitle}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground lg:text-sm">
              {t("calendarEntriesOnDay", { count: entries.length })}
            </p>
          </div>
          <button
            type="button"
            className="sts-hsc-day-dialog-close"
            aria-label={t("calendarCloseDayDialog")}
            onClick={closeDialog}
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>

        <ul className="sts-hsc-day-dialog-list min-h-0 flex-1 list-none overflow-y-auto">
          {entries.map((entry) => (
            <li key={entry.id}>
              <HarvestScheduleDayEntryChip
                entry={entry}
                href={detailHref(entry.id)}
                locale={locale}
                variant="detailed"
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  ) : null;

  if (entries.length === 0) return null;

  const showDesktopMoreCorner = desktopMoreHiddenCount > 0;

  return (
    <>
      {showDesktopMoreCorner ? (
        <button
          type="button"
          onClick={openDialog}
          className="sts-hsc-cell-more-btn sts-hsc-cell-more-btn--corner"
          aria-label={t("calendarShowMoreEntries", { count: desktopMoreHiddenCount })}
          title={t("calendarMoreButton", { count: desktopMoreHiddenCount })}
          aria-expanded={open}
        >
          {t("calendarMoreButton", { count: desktopMoreHiddenCount })}
        </button>
      ) : null}

      <button
        type="button"
        onClick={openDialog}
        className="sts-hsc-cell-sprout-btn"
        aria-label={mobileAriaLabel}
        title={mobileAriaLabel}
        aria-expanded={open}
      >
        <span className="sts-hsc-cell-sprout-icon" aria-hidden />
        <span className="sts-hsc-cell-sprout-label">
          <span className="sts-hsc-cell-sprout-hint">{t("calendarSproutHint")}</span>
          {extraOnDay > 0 ? (
            <span className="sts-hsc-cell-sprout-count">
              {t("calendarTapViewPlusCount", { count: extraOnDay })}
            </span>
          ) : null}
        </span>
      </button>

      {portalReady && dialogNode ? createPortal(dialogNode, document.body) : null}
    </>
  );
}
