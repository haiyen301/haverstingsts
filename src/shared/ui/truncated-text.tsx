"use client";

import { cn } from "@/lib/utils";
import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";

type TruncatedTextProps = {
  text: string;
  className?: string;
  /** Tooltip max width in px. Defaults to 384. */
  tooltipMaxWidth?: number;
};

type TooltipPosition = {
  left: number;
  top: number;
  maxWidth: number;
  placement: "above" | "below";
};

function computeTooltipPosition(
  rect: DOMRect,
  tooltipMaxWidth: number,
): TooltipPosition {
  const margin = 8;
  const maxWidth = Math.min(tooltipMaxWidth, window.innerWidth - margin * 2);
  let left = rect.left;
  if (left + maxWidth > window.innerWidth - margin) {
    left = window.innerWidth - maxWidth - margin;
  }
  left = Math.max(margin, left);

  const spaceBelow = window.innerHeight - rect.bottom;
  const showAbove = spaceBelow < 72 && rect.top > spaceBelow;

  return {
    left,
    top: showAbove ? rect.top - 6 : rect.bottom + 6,
    maxWidth,
    placement: showAbove ? "above" : "below",
  };
}

/**
 * Renders truncated text and shows a styled tooltip on hover only when the label
 * is actually clipped (scrollWidth > clientWidth).
 */
export function TruncatedText({
  text,
  className,
  tooltipMaxWidth = 384,
}: TruncatedTextProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [tooltip, setTooltip] = useState<TooltipPosition | null>(null);

  const isTruncated = useCallback(() => {
    const el = ref.current;
    if (!el) return false;
    return el.scrollWidth > el.clientWidth;
  }, []);

  const showTooltip = useCallback(
    (target: HTMLElement) => {
      if (!isTruncated()) {
        setTooltip(null);
        return;
      }
      setTooltip(computeTooltipPosition(target.getBoundingClientRect(), tooltipMaxWidth));
    },
    [isTruncated, tooltipMaxWidth],
  );

  const handleMouseEnter = (e: React.MouseEvent<HTMLSpanElement>) => {
    showTooltip(e.currentTarget);
  };

  const handleMouseLeave = () => {
    setTooltip(null);
  };

  return (
    <>
      <span
        ref={ref}
        className={cn("block truncate", className)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocus={(e) => showTooltip(e.currentTarget)}
        onBlur={handleMouseLeave}
      >
        {text}
      </span>
      {tooltip && typeof document !== "undefined"
        ? createPortal(
            <div
              role="tooltip"
              className={cn(
                "pointer-events-none fixed z-200 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs leading-snug text-gray-800 shadow-md",
                tooltip.placement === "above" && "-translate-y-full",
              )}
              style={{
                left: tooltip.left,
                top: tooltip.top,
                maxWidth: tooltip.maxWidth,
              }}
            >
              {text}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
