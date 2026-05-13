import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

type CheckBadgeProps = {
  className?: string;
  iconClassName?: string;
};

export function CheckBadge({ className, iconClassName }: CheckBadgeProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "absolute left-1.5 top-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary text-white",
        className,
      )}
    >
      <Check className={cn("h-3 w-3", iconClassName)} />
    </span>
  );
}
