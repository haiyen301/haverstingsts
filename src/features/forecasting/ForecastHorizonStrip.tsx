"use client";

import { useMemo } from "react";
import { useLocale } from "next-intl";

import { useAppTranslations } from "@/shared/i18n/useAppTranslations";

export type ForecastHorizonMonths = 1 | 3 | 6 | 12;

function startOfLocalToday(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

function addCalendarMonths(anchor: Date, months: number): Date {
  return new Date(anchor.getFullYear(), anchor.getMonth() + months, anchor.getDate());
}

function formatMonthYearLong(d: Date, locale: string): string {
  return d.toLocaleDateString(locale, { month: "long", year: "numeric" });
}

type ForecastHorizonStripProps = {
  forecastMonths: ForecastHorizonMonths;
  onForecastMonthsChange: (months: ForecastHorizonMonths) => void;
  /** Same merged harvest count as "Upcoming Harvests Driving the Forecast". */
  upcomingHarvestCount: number;
  /** Same inventory kg total as "Upcoming Harvests Driving the Forecast". */
  upcomingHarvestTotalKg: number;
};

export function ForecastHorizonStrip({
  forecastMonths,
  onForecastMonthsChange,
  upcomingHarvestCount,
  upcomingHarvestTotalKg,
}: ForecastHorizonStripProps) {
  const t = useAppTranslations();
  const locale = useLocale();

  const forecastHorizonEnd = useMemo(() => {
    return addCalendarMonths(startOfLocalToday(), forecastMonths);
  }, [forecastMonths]);

  const horizonThroughLabel = useMemo(
    () => formatMonthYearLong(forecastHorizonEnd, locale),
    [forecastHorizonEnd, locale],
  );

  return (
    <div className="glass-card flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("Dashboard.forecastHorizonSection")}
        </p>
        <p className="mt-0.5 text-sm text-foreground">
          <span className="font-heading font-bold">{upcomingHarvestCount}</span>{" "}
          {t("Dashboard.forecastUpcomingDeliveriesBullet")}{" "}
          <span className="font-heading font-bold">
            {Math.round(upcomingHarvestTotalKg).toLocaleString()} kg
          </span>{" "}
          {t("Dashboard.forecastSprigThrough")}{" "}
          <span className="font-heading font-semibold">{horizonThroughLabel}</span>
        </p>
      </div>
      <div className="flex gap-1 rounded-lg bg-muted p-0.5">
        {([1, 3, 6, 12] as ForecastHorizonMonths[]).map((h) => (
          <button
            key={h}
            type="button"
            onClick={() => onForecastMonthsChange(h)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              forecastMonths === h
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {h === 1 ? t("Dashboard.forecastNextMonth") : t("Dashboard.forecastNextNMonths", { months: h })}
          </button>
        ))}
      </div>
    </div>
  );
}
