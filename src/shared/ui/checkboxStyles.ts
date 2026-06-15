import { cn } from "@/lib/utils";

export const checkboxRootClass =
  "relative inline-flex h-4 w-4 shrink-0 items-center justify-center";

/** Covers the full box so clicks hit the input, not the decorative layer. */
export const checkboxInputClass =
  "peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed";

const checkboxBoxBaseClass =
  "pointer-events-none flex h-4 w-4 items-center justify-center rounded border bg-background text-transparent transition-colors peer-disabled:cursor-not-allowed peer-disabled:opacity-50 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2";

export const checkboxIconClass =
  "h-3 w-3";

/**
 * Reusable checkbox visual:
 * - unchecked: keeps the current border/background
 * - checked: fills with the provided checked color classes
 * - checkmark: always white via `checkboxIconClass`
 */
export function checkboxBoxClass(
  checkedClassName = "peer-checked:border-primary peer-checked:bg-primary peer-checked:text-white",
  uncheckedClassName = "border-border",
): string {
  return cn(checkboxBoxBaseClass, uncheckedClassName, checkedClassName);
}
