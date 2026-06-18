"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HelpCircle } from "lucide-react";
import { useTranslations } from "next-intl";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { InventoryM2ConversionHint } from "@/features/forecasting/InventoryM2ConversionHint";
import type { ZoneBalanceM2Hint } from "@/features/forecasting/zoneBalanceDayEvents";
import { cn } from "@/lib/utils";

export function InventoryConversionNoteHint({
  note,
  usesZoneConfig,
  className,
}: {
  note: string;
  usesZoneConfig?: boolean;
  className?: string;
}) {
  const t = useTranslations("InventoryBalance");
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const openPanel = useCallback(() => {
    clearCloseTimer();
    setOpen(true);
  }, [clearCloseTimer]);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 120);
  }, [clearCloseTimer]);

  useEffect(() => () => clearCloseTimer(), [clearCloseTimer]);

  if (!note.trim()) return null;

  return (
    <Popover modal={false} open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted/30 text-muted-foreground shadow-sm transition-colors",
            "hover:border-border hover:bg-muted/60 hover:text-foreground",
            open && "border-primary/35 bg-primary/5 text-foreground",
            className,
          )}
          aria-label={t("m2ConversionTooltipAria")}
          aria-expanded={open}
          onMouseEnter={openPanel}
          onMouseLeave={scheduleClose}
          onFocus={openPanel}
          onBlur={scheduleClose}
        >
          <HelpCircle className="h-3 w-3" strokeWidth={2} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        role="tooltip"
        side="top"
        align="start"
        sideOffset={6}
        collisionPadding={12}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onMouseEnter={openPanel}
        onMouseLeave={scheduleClose}
        className="z-110 w-[min(18rem,calc(100vw-2rem))] border-border bg-card p-2.5 text-left text-[11px] leading-snug text-card-foreground shadow-lg"
      >
        <p className="font-medium text-foreground">
          {usesZoneConfig ? t("breakdownZoneConfigTitle") : t("m2ConversionTooltipTitle")}
        </p>
        <p className="mt-1 tabular-nums text-muted-foreground">{note}</p>
      </PopoverContent>
    </Popover>
  );
}

export function ZoneBalanceEventHint({
  m2Hint,
  conversionNote,
  usesZoneConfig,
}: {
  m2Hint: ZoneBalanceM2Hint | null | undefined;
  conversionNote?: string;
  usesZoneConfig?: boolean;
}) {
  if (m2Hint) {
    return <InventoryM2ConversionHint hint={m2Hint} />;
  }
  if (conversionNote) {
    return (
      <InventoryConversionNoteHint note={conversionNote} usesZoneConfig={usesZoneConfig} />
    );
  }
  return null;
}
