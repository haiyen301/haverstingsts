import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function ForecastEventBadge({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-semibold leading-snug",
        className,
      )}
    >
      {label}
    </span>
  );
}

/** Farm bold + muted detail, e.g. "Laem Chabang · TifEagle 2". */
export function ForecastEventTitleRich({
  farm,
  detail,
}: {
  farm: string;
  detail: string;
}) {
  return (
    <p className="text-sm leading-snug">
      <span className="font-semibold">{farm}</span>
      {detail ? (
        <span className="text-muted-foreground"> · {detail}</span>
      ) : null}
    </p>
  );
}

export function forecastHarvestEventSubtitle(
  customer: string | undefined,
  project: string | undefined,
): string {
  const c = String(customer ?? "").trim();
  const p = String(project ?? "").trim();
  if (!c && !p) return "";
  return `${c}${c && p ? " · " : ""}${p}`;
}

export function forecastUpcomingGrassDetail(
  grass: string,
  zone: string,
): string {
  return [String(grass ?? "").trim(), String(zone ?? "").trim()]
    .filter(Boolean)
    .join(" ");
}

type ForecastEventTileProps = {
  accentClassName: string;
  dateLabel: string;
  title: ReactNode;
  subtitle?: ReactNode;
  badges: ReactNode[];
  amount: ReactNode;
  onDateClick?: () => void;
  onAmountClick?: () => void;
};

export type ForecastRegrowthDayLine = {
  id: string;
  farm: string;
  grassDetail: string;
  amount: ReactNode;
  badges: ReactNode[];
  subtitle?: ReactNode;
};

/** One card per regrowth day — date once, multiple farm/grass lines inside. */
export function ForecastRegrowthDayGroup({
  accentClassName,
  dateLabel,
  lines,
  onDateClick,
}: {
  accentClassName: string;
  dateLabel: string;
  lines: ForecastRegrowthDayLine[];
  onDateClick?: () => void;
}) {
  const dateEl = onDateClick ? (
    <button
      type="button"
      onClick={onDateClick}
      className="text-left text-sm font-semibold tabular-nums text-primary underline decoration-primary/45"
    >
      {dateLabel}
    </button>
  ) : (
    <span className="text-sm font-semibold tabular-nums">{dateLabel}</span>
  );

  return (
    <div className="w-full rounded-[10px] border border-border/55 bg-muted/3 px-3 py-2.5 transition-colors hover:bg-muted/30">
      <div className="flex items-start gap-2.5">
        <div
          className={cn("mt-[5px] h-2 w-2 shrink-0 rounded-full", accentClassName)}
        />
        <div className="min-w-0 flex-1">
          <div>{dateEl}</div>
          <div className="mt-2 space-y-2.5">
            {lines.map((line) => (
              <div key={line.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <ForecastEventTitleRich farm={line.farm} detail={line.grassDetail} />
                    {line.subtitle ? <div className="mt-0.5">{line.subtitle}</div> : null}
                  </div>
                  <div className="shrink-0 text-right text-sm font-semibold tabular-nums">
                    {line.amount}
                  </div>
                </div>
                {line.badges.length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">{line.badges}</div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ForecastEventTile({
  accentClassName,
  dateLabel,
  title,
  subtitle,
  badges,
  amount,
  onDateClick,
  onAmountClick,
}: ForecastEventTileProps) {
  const dateEl = onDateClick ? (
    <button
      type="button"
      onClick={onDateClick}
      className="text-left text-sm font-semibold tabular-nums text-primary underline decoration-primary/45"
    >
      {dateLabel}
    </button>
  ) : (
    <span className="text-sm font-semibold tabular-nums">{dateLabel}</span>
  );

  const amountEl = onAmountClick ? (
    <button
      type="button"
      onClick={onAmountClick}
      className="inline-flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-right text-sm font-semibold tabular-nums transition-colors"
    >
      {amount}
    </button>
  ) : (
    <span className="inline-flex items-center gap-1 text-right text-sm font-semibold tabular-nums">
      {amount}
    </span>
  );

  return (
    <div className="w-full rounded-[10px] border border-border/55 bg-muted/3 px-3 py-2.5 transition-colors hover:bg-muted/30">
      <div className="flex items-start gap-2.5">
        <div
          className={cn("mt-[5px] h-2 w-2 shrink-0 rounded-full", accentClassName)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">{dateEl}</div>
            {amountEl}
          </div>
          <div className="mt-1">{title}</div>
          {subtitle ? <div className="mt-0.5">{subtitle}</div> : null}
        </div>
      </div>
      {badges.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5 pl-[18px]">{badges}</div>
      ) : null}
    </div>
  );
}
