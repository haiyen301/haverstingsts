"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { InventoryM2ConversionHint } from "@/features/forecasting/InventoryM2ConversionHint";
import type { ZoneInventoryDaySnapshot } from "@/features/forecasting/forecastAvailableAtDate";
import type {
  ZoneBalanceHarvestEvent,
  ZoneBalanceRegrowthEvent,
} from "@/features/forecasting/zoneBalanceDayEvents";
import {
  formatKg,
  formatShortDateYmd,
  formatSignedKg,
  formatTimelineEntryFormula,
  type ZoneBalanceTimelineEntry,
} from "@/features/forecasting/zoneBalanceBreakdown";
import { cn } from "@/lib/utils";

export type EnrichedZoneBalanceTimelineEntry = ZoneBalanceTimelineEntry & {
  harvestEvents: ZoneBalanceHarvestEvent[];
  regrowthEvents: ZoneBalanceRegrowthEvent[];
};

function EventLine({
  tone,
  children,
  hint,
}: {
  tone: "harvest" | "regrowth" | "manual";
  children: ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-2 rounded-md px-2 py-1.5 text-[11px]",
        tone === "harvest" && "bg-amber-50/80 text-amber-900",
        tone === "regrowth" && "bg-emerald-50/80 text-emerald-900",
        tone === "manual" && "bg-amber-100/60 text-amber-900",
      )}
    >
      <div className="min-w-0 leading-relaxed">{children}</div>
      {hint ? <div className="shrink-0 pt-0.5">{hint}</div> : null}
    </div>
  );
}

function HistoryStep({
  entry,
  todayYmd,
  maxKg,
}: {
  entry: EnrichedZoneBalanceTimelineEntry;
  todayYmd: string;
  maxKg: number;
}) {
  const t = useTranslations("InventoryBalance");
  const isToday = entry.dateYmd === todayYmd;
  const label = entry.isOpeningDay
    ? t("breakdownOpeningDay")
    : entry.isBridgeEntry
      ? t("breakdownBridgeDay", { date: formatShortDateYmd(entry.dateYmd) })
      : isToday
        ? t("breakdownTodayLabel")
        : formatShortDateYmd(entry.dateYmd);

  return (
    <li
      className={cn(
        "rounded-lg border px-3 py-3",
        isToday
          ? "border-primary/30 bg-primary/5"
          : entry.isBridgeEntry
            ? "border-border/70 bg-muted/30"
            : entry.isManualSetToday
              ? "border-amber-200 bg-amber-50/40"
              : "border-border/70 bg-background",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <p
            className={cn(
              "text-sm font-semibold",
              isToday ? "text-primary" : entry.isManualSetToday ? "text-amber-900" : "text-foreground",
            )}
          >
            {label}
          </p>
          <p className="text-[11px] leading-relaxed tabular-nums text-muted-foreground">
            {formatTimelineEntryFormula(entry, maxKg, (key, values) => t(key, values))}
          </p>

          {entry.regrowthEvents.length > 0 && !entry.isBridgeEntry ? (
            <div className="space-y-1">
              {entry.regrowthEvents.map((ev) => (
                <EventLine
                  key={`rg-${ev.rowId}-${ev.sourceHarvestDateYmd}`}
                  tone="regrowth"
                  hint={<InventoryM2ConversionHint hint={ev.m2Hint} />}
                >
                  <span className="font-semibold">{t("breakdownRegrowthLabel")}</span>{" "}
                  {formatSignedKg(ev.creditedKg, "+")} kg ·{" "}
                  {t("breakdownRegrowthFromHarvest", {
                    date: formatShortDateYmd(ev.sourceHarvestDateYmd),
                  })}
                  {ev.label ? ` · ${ev.label}` : ""}
                </EventLine>
              ))}
            </div>
          ) : null}

          {entry.harvestEvents.length > 0 && !entry.isBridgeEntry ? (
            <div className="space-y-1">
              {entry.harvestEvents.map((ev) => (
                <EventLine
                  key={`hv-${ev.rowId}`}
                  tone="harvest"
                  hint={<InventoryM2ConversionHint hint={ev.m2Hint} />}
                >
                  <span className="font-semibold">{t("breakdownHarvestLabel")}</span>{" "}
                  {formatSignedKg(ev.kg, "−")} kg · {formatShortDateYmd(ev.harvestDateYmd)}
                  {ev.label ? ` · ${ev.label}` : ""}
                </EventLine>
              ))}
            </div>
          ) : null}

          {entry.isManualSetToday && entry.manualKg != null ? (
            <EventLine tone="manual">
              <span className="font-semibold">{t("breakdownManualSet")}</span>{" "}
              {formatKg(entry.manualKg)} kg
            </EventLine>
          ) : null}
        </div>
        <p className="shrink-0 text-right text-sm font-semibold tabular-nums text-foreground">
          {formatKg(entry.endKg)} kg
        </p>
      </div>
    </li>
  );
}

function BackToTopButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group inline-flex items-center gap-2.5 rounded-full border border-border/80 bg-background/95 px-5 py-2.5 text-sm font-medium text-foreground shadow-md ring-1 ring-black/4 backdrop-blur-sm transition hover:border-primary/35 hover:bg-primary/5 hover:text-primary hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.98]"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
        <ArrowUp className="h-4 w-4" aria-hidden />
      </span>
      {label}
    </button>
  );
}

export function InventoryZoneBalanceBreakdownPanel({
  zoneLabel,
  maxKg,
  todayYmd,
  todaySnapshot,
  timelineEntries,
  loading = false,
  onClose,
}: {
  zoneLabel: string;
  maxKg: number;
  todayYmd: string;
  todaySnapshot: ZoneInventoryDaySnapshot | null | undefined;
  timelineEntries: EnrichedZoneBalanceTimelineEntry[];
  loading?: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("InventoryBalance");
  const panelTopRef = useRef<HTMLDivElement>(null);
  const listEndRef = useRef<HTMLDivElement>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);

  const scrollToTop = useCallback(() => {
    panelTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  useEffect(() => {
    const endEl = listEndRef.current;
    if (!endEl || timelineEntries.length < 4) {
      setShowBackToTop(false);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setShowBackToTop(entry.isIntersecting),
      { root: null, rootMargin: "0px 0px -8px 0px", threshold: 0.1 },
    );
    observer.observe(endEl);
    return () => observer.disconnect();
  }, [timelineEntries.length, loading]);

  const currentBalanceKg = todaySnapshot?.calculatedKg ?? timelineEntries.at(-1)?.endKg ?? 0;
  const openingKg = timelineEntries.find((entry) => entry.isOpeningDay)?.endKg ?? maxKg;

  return (
    <section className="relative border-t-2 border-primary/20 bg-muted/15 px-4 py-5 sm:px-6">
      <div ref={panelTopRef} className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="text-base font-semibold text-foreground">{t("balanceBreakdownTitle")}</h3>
          <p className="text-sm text-muted-foreground">{zoneLabel}</p>
          <p className="text-xs tabular-nums text-muted-foreground">
            {t("breakdownSummaryLine", {
              from: formatKg(openingKg),
              to: formatKg(currentBalanceKg),
            })}
          </p>
          <p className="text-[11px] text-muted-foreground">{t("breakdownMaxLine", { kg: formatKg(maxKg) })}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-2 text-muted-foreground transition hover:bg-muted/40 hover:text-foreground"
          aria-label={t("close")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {loading ? (
        <div
          className="flex flex-col items-center justify-center gap-4 rounded-lg border border-border/70 bg-background px-4 py-10"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="relative flex h-12 w-12 items-center justify-center">
            <span
              className="absolute inline-flex h-12 w-12 animate-spin rounded-full border-[3px] border-primary/25 border-t-primary motion-reduce:animate-none"
              aria-hidden
            />
            <Loader2
              className="h-5 w-5 animate-spin text-primary motion-reduce:animate-none"
              style={{ animationDirection: "reverse", animationDuration: "0.75s" }}
              aria-hidden
            />
          </div>
          <p className="text-sm font-medium text-foreground">{t("breakdownLoading")}</p>
          <p className="text-xs text-muted-foreground">{t("breakdownLoadingHint")}</p>
          <div className="w-full max-w-md space-y-2 pt-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-10 animate-pulse rounded-lg bg-muted/70 motion-reduce:animate-none"
                style={{ animationDelay: `${i * 120}ms` }}
              />
            ))}
          </div>
        </div>
      ) : !todaySnapshot && timelineEntries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("breakdownUnavailable")}</p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{t("breakdownHistoryHint")}</p>
          {timelineEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("breakdownNoHistory")}</p>
          ) : (
            <div className="relative">
              <ol className="space-y-2">
                {timelineEntries.map((entry, index) => (
                  <HistoryStep
                    key={`${entry.dateYmd}-${index}`}
                    entry={entry}
                    todayYmd={todayYmd}
                    maxKg={maxKg}
                  />
                ))}
              </ol>
              <div ref={listEndRef} className="h-px w-full" aria-hidden />
              {showBackToTop ? (
                <div className="sticky bottom-6 z-10 flex justify-center pt-6 pb-2">
                  <BackToTopButton label={t("breakdownBackToTop")} onClick={scrollToTop} />
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
