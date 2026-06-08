"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import {
  entryPrimaryScheduleDate,
  formatScheduleEstimatedRange,
  formatScheduleYmd,
} from "./harvestScheduleCalendarUtils";
import type { HarvestScheduleCalendarEntry, HarvestScheduleStatus } from "./harvestScheduleTypes";

const statusStyles: Record<HarvestScheduleStatus, string> = {
  planned: "bg-slate-100 text-slate-700",
  scheduled: "bg-blue-100 text-blue-700",
  harvested: "bg-amber-100 text-amber-700",
  delivered: "bg-green-100 text-green-700",
};

function harvestStatusKey(
  status: HarvestScheduleStatus,
): "harvestStatus_planned" | "harvestStatus_scheduled" | "harvestStatus_harvested" | "harvestStatus_delivered" {
  switch (status) {
    case "planned":
      return "harvestStatus_planned";
    case "scheduled":
      return "harvestStatus_scheduled";
    case "harvested":
      return "harvestStatus_harvested";
    case "delivered":
      return "harvestStatus_delivered";
    default:
      return "harvestStatus_planned";
  }
}

type TooltipCoords = {
  top: number;
  left: number;
  placeAbove: boolean;
};

function useDesktopProjectTooltip() {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const [coords, setCoords] = useState<TooltipCoords>({
    top: 0,
    left: 0,
    placeAbove: false,
  });
  const desktopHoverRef = useRef(false);

  useEffect(() => {
    setPortalReady(true);
    const mq = window.matchMedia("(hover: hover) and (min-width: 1024px)");
    const sync = () => {
      desktopHoverRef.current = mq.matches;
      if (!mq.matches) setOpen(false);
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const updateCoords = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const gap = 6;
    const estHeight = 240;
    const placeAbove = rect.bottom + gap + estHeight > window.innerHeight - 12;
    setCoords({
      top: placeAbove ? rect.top - gap : rect.bottom + gap,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 16)),
      placeAbove,
    });
  }, []);

  const show = useCallback(() => {
    if (!desktopHoverRef.current) return;
    updateCoords();
    setOpen(true);
  }, [updateCoords]);

  const hide = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => updateCoords();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, updateCoords]);

  return { anchorRef, open, portalReady, coords, show, hide };
}

type HarvestScheduleDayEntryChipProps = {
  entry: HarvestScheduleCalendarEntry;
  href: string;
  locale: string;
  variant?: "compact" | "detailed";
};

export function HarvestScheduleDayEntryChip({
  entry,
  href,
  locale,
  variant = "compact",
}: HarvestScheduleDayEntryChipProps) {
  const isDetailed = variant === "detailed";
  const t = useTranslations("HarvestSchedule");
  const tHarvest = useTranslations("Harvest");
  const { anchorRef, open, portalReady, coords, show, hide } =
    useDesktopProjectTooltip();

  const title = entry.project || t("harvestNumber", { id: entry.id });
  const loadType = entry.harvestType || t("defaultHarvestType");
  const grassType = entry.grassType.trim() || t("unknownGrass");
  const qtyText = entry.quantity.toLocaleString(locale);
  const uom = entry.quantityUom.trim() || "—";

  const primarySchedule = entryPrimaryScheduleDate(entry);
  const primaryScheduleLabel = formatScheduleYmd(
    primarySchedule?.ymd ?? "",
    locale,
  );
  const estStart = entry.estimatedDateStart.trim().slice(0, 10);
  const estEnd = (entry.estimatedDateEnd.trim().slice(0, 10) || estStart).trim();
  const estimatedRange =
    estStart && estEnd !== estStart
      ? formatScheduleEstimatedRange(entry.estimatedDateStart, entry.estimatedDateEnd, locale)
      : null;
  const deliveryLabel = formatScheduleYmd(entry.deliveryDate, locale);
  const truckNote = entry.truckNote.trim();
  const generalNote = entry.generalNote.trim();

  const metaRows: { label: string; value: string }[] = [];
  if (primarySchedule?.kind === "estimated" && primaryScheduleLabel) {
    metaRows.push({
      label: t("estDate"),
      value: primaryScheduleLabel,
    });
  }
  if (estimatedRange) {
    metaRows.push({ label: t("estimatedDateRange"), value: estimatedRange });
  }
  if (deliveryLabel) {
    metaRows.push({ label: t("deliveryDate"), value: deliveryLabel });
  }
  if (truckNote) {
    metaRows.push({ label: t("truckNote"), value: truckNote });
  }
  if (generalNote) {
    metaRows.push({ label: t("generalNote"), value: generalNote });
  }

  const expandedBody: ReactNode = (
    <>
      <div className="flex min-w-0 items-start justify-between gap-1">
        <p className="text-sm font-bold uppercase leading-tight text-foreground">{title}</p>
        <span
          className={cn(
            "shrink-0 rounded px-1 py-px text-[0.62rem] font-semibold leading-none",
            statusStyles[entry.status],
          )}
        >
          {tHarvest(harvestStatusKey(entry.status))}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-foreground/85">
        {[
          entry.grassType || t("unknownGrass"),
          `${qtyText} ${uom}`,
          loadType,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {t("farmZone", { farm: entry.farm, zone: entry.zone })}
      </p>
      {metaRows.map((row) => (
        <p key={row.label} className="mt-0.5 text-xs leading-snug text-muted-foreground wrap-break-word">
          <span className="font-semibold text-foreground/75">{row.label}: </span>
          {row.value}
        </p>
      ))}
      <p className="mt-0.5 text-xs leading-snug tabular-nums text-primary">
        <span className="font-semibold text-foreground/75">{t("harvestArea")}: </span>
        {entry.estimatedAreaM2.toLocaleString(locale)} m²
      </p>
    </>
  );

  const tooltipPortal =
    portalReady && open
      ? createPortal(
          <div
            className="sts-hsc-entry-chip-tooltip-floating"
            role="tooltip"
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              transform: coords.placeAbove ? "translateY(-100%)" : undefined,
              zIndex: 9999,
            }}
          >
            {expandedBody}
          </div>,
          document.body,
        )
      : null;

  if (isDetailed) {
    return (
      <Link
        href={href}
        onClick={(e) => e.stopPropagation()}
        className="sts-hsc-entry-chip sts-hsc-entry-chip--detailed block w-full min-w-0 rounded border border-border/70 bg-card/95 p-2.5 text-left shadow-sm transition-[box-shadow,border-color,background-color] hover:border-primary/35 hover:bg-card"
      >
        {expandedBody}
        <p className="mt-2 text-[0.65rem] font-semibold text-primary">{t("viewDetail")} →</p>
      </Link>
    );
  }

  return (
    <>
      <div
        ref={anchorRef}
        className={cn(
          "sts-hsc-entry-chip sts-hsc-entry-chip--compact w-full min-w-0 bg-card text-left",
          open && "sts-hsc-entry-chip--tooltip-open",
        )}
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        <div className="sts-hsc-entry-chip-compact-face">
          <Link
            href={href}
            onClick={(e) => e.stopPropagation()}
            className="sts-hsc-entry-chip-project"
          >
            {title}
          </Link>
          <p className="sts-hsc-entry-chip-summary">
            <span className="sts-hsc-entry-chip-qty-uom">
              {qtyText} {uom.toUpperCase()}
            </span>
            <span className="sts-hsc-entry-chip-sep" aria-hidden>
              ·
            </span>
            <span className="sts-hsc-entry-chip-grass">{grassType}</span>
            <span className="sts-hsc-entry-chip-sep" aria-hidden>
              ·
            </span>
            <span className="sts-hsc-entry-chip-load">{loadType}</span>
          </p>
        </div>
      </div>
      {tooltipPortal}
    </>
  );
}
