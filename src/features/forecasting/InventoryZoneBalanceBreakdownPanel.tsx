"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { InventoryM2ConversionHint } from "@/features/forecasting/InventoryM2ConversionHint";
import type { ZoneInventoryDaySnapshot } from "@/features/forecasting/forecastAvailableAtDate";
import type {
  ZoneBalanceHarvestEvent,
  ZoneBalanceRegrowthEvent,
} from "@/features/forecasting/zoneBalanceDayEvents";
import {
  balanceKgToM2,
  computeZoneBalanceChangeSummary,
  formatKg,
  formatKgPerM2Rate,
  formatM2,
  formatShortDateYmd,
  formatSignedKg,
  formatSignedM2,
  formatTimelineEntryFormula,
  type BalanceBreakdownDisplayUnit,
  type ZoneBalanceChangeSummary,
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

function eventDisplayM2(
  kg: number,
  m2Hint: { m2: number } | null | undefined,
  kgPerM2: number,
): number {
  if (m2Hint && m2Hint.m2 > 0) return Math.round(m2Hint.m2);
  return balanceKgToM2(kg, kgPerM2);
}

function HistoryStep({
  entry,
  todayYmd,
  maxKg,
  displayUnit,
  inventoryKgPerM2,
}: {
  entry: EnrichedZoneBalanceTimelineEntry;
  todayYmd: string;
  maxKg: number;
  displayUnit: BalanceBreakdownDisplayUnit;
  inventoryKgPerM2: number;
}) {
  const t = useTranslations("InventoryBalance");
  const showM2 = displayUnit === "m2";
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
            {formatTimelineEntryFormula(entry, maxKg, (key, values) => t(key, values), {
              unit: displayUnit,
              kgPerM2: inventoryKgPerM2,
            })}
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
                  {showM2
                    ? `${formatSignedM2(eventDisplayM2(ev.creditedKg, ev.m2Hint, inventoryKgPerM2), "+")} m²`
                    : `${formatSignedKg(ev.creditedKg, "+")} kg`}{" "}
                  ·{" "}
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
                  {showM2
                    ? `${formatSignedM2(eventDisplayM2(ev.kg, ev.m2Hint, inventoryKgPerM2), "−")} m²`
                    : `${formatSignedKg(ev.kg, "−")} kg`}{" "}
                  · {formatShortDateYmd(ev.harvestDateYmd)}
                  {ev.label ? ` · ${ev.label}` : ""}
                </EventLine>
              ))}
            </div>
          ) : null}

          {entry.isManualSetToday && entry.manualKg != null ? (
            <EventLine tone="manual">
              <span className="font-semibold">{t("breakdownManualSet")}</span>{" "}
              {showM2
                ? `${formatM2(balanceKgToM2(entry.manualKg, inventoryKgPerM2))} m²`
                : `${formatKg(entry.manualKg)} kg`}
            </EventLine>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold tabular-nums text-foreground">
            {showM2
              ? `${formatM2(balanceKgToM2(entry.endKg, inventoryKgPerM2))} m²`
              : `${formatKg(entry.endKg)} kg`}
          </p>
          {showM2 ? (
            <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">
              {t("breakdownKgSubtitle", { kg: formatKg(entry.endKg) })}
            </p>
          ) : null}
        </div>
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

function SummaryRow({
  label,
  value,
  subValue,
  tone = "default",
}: {
  label: string;
  value: string;
  subValue?: string;
  tone?: "default" | "positive" | "negative" | "emphasis";
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="text-right">
        <span
          className={cn(
            "text-sm font-medium tabular-nums",
            tone === "positive" && "text-emerald-700",
            tone === "negative" && "text-amber-800",
            tone === "emphasis" && "text-primary font-semibold",
            tone === "default" && "text-foreground",
          )}
        >
          {value}
        </span>
        {subValue ? (
          <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">{subValue}</p>
        ) : null}
      </div>
    </div>
  );
}

function BalanceChangeSummaryCard({
  summary,
  inventoryKgPerM2,
  displayUnit,
  hasBridgeEntry,
}: {
  summary: ZoneBalanceChangeSummary;
  inventoryKgPerM2: number;
  displayUnit: BalanceBreakdownDisplayUnit;
  hasBridgeEntry: boolean;
}) {
  const t = useTranslations("InventoryBalance");
  const showM2 = displayUnit === "m2";
  const fmt = (kg: number) =>
    showM2 ? `${formatM2(balanceKgToM2(kg, inventoryKgPerM2))} m²` : `${formatKg(kg)} kg`;
  const fmtSigned = (kg: number) => {
    if (kg === 0) return showM2 ? "0 m²" : "0 kg";
    const sign = kg > 0 ? "+" : "−";
    return showM2
      ? `${formatSignedM2(Math.abs(kg), sign === "+" ? "+" : "−")} m²`
      : `${formatSignedKg(Math.abs(kg), sign === "+" ? "+" : "−")} kg`;
  };
  const eventCount = (n: number) => (n > 0 ? t("breakdownEventCount", { count: n }) : "");

  return (
    <div className="rounded-lg border border-border/80 bg-background px-4 py-3 shadow-sm">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("breakdownChangesSectionTitle")}
      </p>
      {summary.totalRegrowthKg > 0 ? (
        <SummaryRow
          label={`${t("breakdownTotalRegrowth")} ${eventCount(summary.regrowthEventCount)}`.trim()}
          value={fmtSigned(summary.totalRegrowthKg)}
          tone="positive"
        />
      ) : null}
      {summary.totalHarvestKg > 0 ? (
        <SummaryRow
          label={`${t("breakdownTotalHarvest")} ${eventCount(summary.harvestEventCount)}`.trim()}
          value={fmtSigned(-summary.totalHarvestKg)}
          tone="negative"
        />
      ) : null}
      {summary.manualEventCount > 0 ? (
        <SummaryRow
          label={`${t("breakdownManualAdjustment")} ${eventCount(summary.manualEventCount)}`.trim()}
          value={fmtSigned(summary.manualAdjustmentKg)}
        />
      ) : null}
      {summary.totalRegrowthKg === 0 &&
      summary.totalHarvestKg === 0 &&
      summary.manualEventCount === 0 ? (
        <p className="py-1 text-xs text-muted-foreground">{t("breakdownNoChangesYet")}</p>
      ) : null}

      <div className="my-2 border-t border-border/70" />

      <SummaryRow
        label={t("breakdownCurrentBalance")}
        value={fmt(summary.currentKg)}
        tone="emphasis"
      />
      <SummaryRow
        label={t("breakdownNetChange")}
        value={fmtSigned(summary.netChangeKg)}
        subValue={t("breakdownNetChangeHint", {
          from: fmt(summary.openingKg),
          to: fmt(summary.currentKg),
        })}
      />

      {hasBridgeEntry ? (
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
          {t("breakdownBridgeNote")}
        </p>
      ) : null}
    </div>
  );
}

export function InventoryZoneBalanceBreakdownPanel({
  zoneLabel,
  maxKg,
  inventoryKgPerM2 = 0,
  displayUnit = "kg",
  todayYmd,
  todaySnapshot,
  timelineEntries,
  loading = false,
  onClose,
}: {
  zoneLabel: string;
  maxKg: number;
  inventoryKgPerM2?: number;
  displayUnit?: BalanceBreakdownDisplayUnit;
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

  const showM2 = displayUnit === "m2";
  const currentBalanceKg = todaySnapshot?.calculatedKg ?? timelineEntries.at(-1)?.endKg ?? 0;
  const openingKg = timelineEntries.find((entry) => entry.isOpeningDay)?.endKg ?? maxKg;
  const currentBalanceM2 = balanceKgToM2(currentBalanceKg, inventoryKgPerM2);
  const openingM2 = balanceKgToM2(openingKg, inventoryKgPerM2);
  const maxM2 = balanceKgToM2(maxKg, inventoryKgPerM2);

  const changeSummary = useMemo(() => {
    const harvestEventCount = timelineEntries.reduce((n, e) => n + e.harvestEvents.length, 0);
    const regrowthEventCount = timelineEntries.reduce((n, e) => n + e.regrowthEvents.length, 0);
    return computeZoneBalanceChangeSummary({
      timelineEntries,
      maxKg,
      currentKg: currentBalanceKg,
      harvestEventCount,
      regrowthEventCount,
    });
  }, [timelineEntries, maxKg, currentBalanceKg]);

  const hasBridgeEntry = timelineEntries.some((e) => e.isBridgeEntry);

  return (
    <section className="relative border-t-2 border-primary/20 bg-muted/15 px-4 py-5 sm:px-6">
      <div ref={panelTopRef} className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="text-base font-semibold text-foreground">{t("balanceBreakdownTitle")}</h3>
          <p className="text-sm text-muted-foreground">{zoneLabel}</p>
          <p className="text-xs tabular-nums text-muted-foreground">
            {showM2
              ? t("breakdownSummaryLineM2", {
                  from: formatM2(openingM2),
                  to: formatM2(currentBalanceM2),
                })
              : t("breakdownSummaryLine", {
                  from: formatKg(openingKg),
                  to: formatKg(currentBalanceKg),
                })}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {showM2
              ? t("breakdownMaxLineM2", {
                  m2: formatM2(maxM2),
                  kg: formatKg(maxKg),
                  rate: formatKgPerM2Rate(inventoryKgPerM2),
                })
              : t("breakdownMaxLine", { kg: formatKg(maxKg) })}
          </p>
          {showM2 ? (
            <p className="text-[11px] tabular-nums text-muted-foreground">
              {t("breakdownM2FromKgLine", {
                m2: formatM2(currentBalanceM2),
                kg: formatKg(currentBalanceKg),
                rate: formatKgPerM2Rate(inventoryKgPerM2),
              })}
            </p>
          ) : null}
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
        <div className="space-y-4">
          {!loading && timelineEntries.length > 0 ? (
            <BalanceChangeSummaryCard
              summary={changeSummary}
              inventoryKgPerM2={inventoryKgPerM2}
              displayUnit={displayUnit}
              hasBridgeEntry={hasBridgeEntry}
            />
          ) : null}
          <p className="text-xs text-muted-foreground">
            {showM2 ? t("breakdownHistoryHintM2") : t("breakdownHistoryHint")}
          </p>
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
                    displayUnit={displayUnit}
                    inventoryKgPerM2={inventoryKgPerM2}
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
