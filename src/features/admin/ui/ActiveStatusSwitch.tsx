"use client";

import { cn } from "@/lib/utils";

type ActiveStatusSwitchProps = {
  checked: boolean;
  onCheckedChange: () => void;
  disabled?: boolean;
  pending?: boolean;
  activeLabel?: string;
  inactiveLabel?: string;
};

export function ActiveStatusSwitch({
  checked,
  onCheckedChange,
  disabled,
  pending,
  activeLabel = "Active",
  inactiveLabel = "Inactive",
}: ActiveStatusSwitchProps) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled || pending}
        className={cn(
          "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          checked ? "bg-lime-500" : "bg-muted-foreground/40",
          (disabled || pending) && "cursor-not-allowed opacity-60",
        )}
        onClick={() => onCheckedChange()}
      >
        <span
          className={cn(
            "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-5" : "translate-x-1",
          )}
        />
      </button>
      <span
        className={cn(
          "text-xs",
          checked ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {pending ? "Saving..." : checked ? activeLabel : inactiveLabel}
      </span>
    </div>
  );
}
