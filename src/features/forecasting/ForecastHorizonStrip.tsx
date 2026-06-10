"use client";

import { useMemo } from "react";
import { useLocale } from "next-intl";

import { useAppTranslations } from "@/shared/i18n/useAppTranslations";

function formatMonthYearLong(d: Date, locale: string): string {
  return d.toLocaleDateString(locale, { month: "long", year: "numeric" });
}

type ForecastHorizonStripProps = {
  horizonEnd: Date;
  /** Same merged harvest count as "Upcoming Harvests Driving the Forecast". */
  upcomingHarvestCount: number;
  /** Same inventory kg total as "Upcoming Harvests Driving the Forecast". */
  upcomingHarvestTotalKg: number;
};

export function ForecastHorizonStrip({
  horizonEnd,
  upcomingHarvestCount,
  upcomingHarvestTotalKg,
}: ForecastHorizonStripProps) {
  const t = useAppTranslations();
  const locale = useLocale();

  const horizonThroughLabel = useMemo(
    () => formatMonthYearLong(horizonEnd, locale),
    [horizonEnd, locale],
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
    </div>
  );
}
