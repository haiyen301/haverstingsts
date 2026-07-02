"use client";

import { X } from "lucide-react";
import { useMemo } from "react";
import { useTranslations } from "next-intl";

import {
  formatBalanceFormulaSummary,
  formatBalanceStepFormula,
  type FertilizerUsageBalanceTimelineEntry,
} from "@/features/fertilizer/lib/fertilizerUsageBalance";
import { formatDateDisplay } from "@/shared/lib/format/date";
import { formatNumber } from "@/shared/lib/format/number";
import { cn } from "@/lib/utils";

type Props = {
  farmName: string;
  productLabel: string;
  timeline: FertilizerUsageBalanceTimelineEntry[];
  highlightUsageId?: number;
  onClose: () => void;
};

function eventLabel(
  kind: FertilizerUsageBalanceTimelineEntry["kind"],
  t: ReturnType<typeof useTranslations<"FertilizerUsage">>,
): string {
  switch (kind) {
    case "opening":
      return t("balanceTimeline.opening");
    case "import":
      return t("balanceTimeline.import");
    case "set_balance":
      return t("balanceTimeline.setBalance");
    case "transfer_in":
      return t("balanceTimeline.transferIn");
    case "transfer_out":
      return t("balanceTimeline.transferOut");
    default:
      return t("balanceTimeline.consumption");
  }
}

function formatDelta(delta: number, kind: FertilizerUsageBalanceTimelineEntry["kind"]): string {
  if (kind === "opening") {
    return formatNumber(delta, { maximumFractionDigits: 3 });
  }
  const sign = delta > 0 ? "+" : "";
  return `${sign}${formatNumber(delta, { maximumFractionDigits: 3 })}`;
}

export function FertilizerUsageBalanceBreakdownPanel({
  farmName,
  productLabel,
  timeline,
  highlightUsageId,
  onClose,
}: Props) {
  const t = useTranslations("FertilizerUsage");

  const formulaLabels = useMemo(
    () => ({
      opening: t("balanceTimeline.opening"),
      import: t("balanceTimeline.import"),
      setBalance: t("balanceTimeline.setBalance"),
      transferIn: t("balanceTimeline.transferIn"),
      transferOut: t("balanceTimeline.transferOut"),
      consumption: t("balanceTimeline.consumption"),
    }),
    [t],
  );

  const formulaSummary = useMemo(
    () => formatBalanceFormulaSummary(timeline, formulaLabels),
    [timeline, formulaLabels],
  );

  const displayTimeline = useMemo(() => [...timeline].reverse(), [timeline]);

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">{t("balanceTimeline.title")}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {farmName} · {productLabel}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          onClick={onClose}
          aria-label={t("balanceTimeline.close")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {formulaSummary ? (
        <div className="mb-3 rounded-md border border-border bg-muted/30 px-3 py-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("balanceTimeline.formulaTitle")}
          </p>
          <p className="mt-1 font-mono text-sm text-foreground">{formulaSummary}</p>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-2 py-2 font-medium">{t("balanceTimeline.date")}</th>
              <th className="px-2 py-2 font-medium">{t("balanceTimeline.event")}</th>
              <th className="px-2 py-2 font-medium">{t("balanceTimeline.change")}</th>
              <th className="px-2 py-2 font-medium">{t("balanceTimeline.formula")}</th>
              <th className="px-2 py-2 text-right font-medium">{t("balanceTimeline.balance")}</th>
            </tr>
          </thead>
          <tbody>
            {displayTimeline.map((entry) => {
              const highlighted = highlightUsageId != null && entry.usageId === highlightUsageId;
              return (
                <tr
                  key={entry.key}
                  className={cn(
                    "border-b border-border/60 last:border-b-0",
                    highlighted && "bg-primary/5",
                    entry.kind === "set_balance" && "bg-amber-50/80 dark:bg-amber-950/20",
                  )}
                >
                  <td className="whitespace-nowrap px-2 py-2 tabular-nums">
                    {formatDateDisplay(entry.dateYmd)}
                  </td>
                  <td className="px-2 py-2">
                    <span className="font-medium">{eventLabel(entry.kind, t)}</span>
                    {entry.label ? (
                      <span className="mt-0.5 block text-xs text-muted-foreground">{entry.label}</span>
                    ) : null}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-2 tabular-nums",
                      entry.delta > 0 && entry.kind !== "opening" && "text-emerald-600",
                      entry.delta < 0 && "text-destructive",
                      entry.kind === "set_balance" && "text-amber-700 dark:text-amber-400",
                    )}
                  >
                    {formatDelta(entry.delta, entry.kind)}
                  </td>
                  <td className="px-2 py-2 font-mono text-xs text-muted-foreground">
                    {formatBalanceStepFormula(entry)}
                  </td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums">
                    {formatNumber(entry.balanceAfter, { maximumFractionDigits: 3 })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
