"use client";

import { Loader2, Play, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";

import { useForecastQueueRunner } from "@/features/forecasting/useForecastQueueRunner";
import { cn } from "@/lib/utils";

type ForecastPageHeaderActionsProps = {
  className?: string;
};

export function ForecastPageHeaderActions({ className }: ForecastPageHeaderActionsProps) {
  const t = useTranslations("ForecastQueue");
  const {
    isProcessing,
    queueBusy,
    canRunQueue,
    pendingJobs,
    refreshPageData,
    runNextQueueJob,
  } = useForecastQueueRunner();

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <button
        type="button"
        onClick={() => void refreshPageData()}
        disabled={queueBusy}
        aria-label={t("refreshAria")}
        title={t("refresh")}
        className="group relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-white text-muted-foreground shadow-sm transition hover:bg-muted/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
      >
        <RefreshCw className={cn("h-4 w-4", queueBusy && "animate-spin")} />
        <span className="pointer-events-none absolute -bottom-8 left-1/2 z-20 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[11px] font-medium text-popover-foreground shadow-md group-hover:block">
          {t("refresh")}
        </span>
      </button>

      <button
        type="button"
        onClick={() => void runNextQueueJob()}
        disabled={!canRunQueue}
        aria-label={t("updateDataAria")}
        title={t("updateData")}
        className="group relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-white text-muted-foreground shadow-sm transition hover:bg-muted/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isProcessing ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        ) : (
          <Play className="h-4 w-4" />
        )}
        <span className="pointer-events-none absolute -bottom-8 left-1/2 z-20 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[11px] font-medium text-popover-foreground shadow-md group-hover:block">
          {t("updateData")}
          {pendingJobs > 0 ? ` (${pendingJobs})` : ""}
        </span>
      </button>
    </div>
  );
}
