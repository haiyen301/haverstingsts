import { cn } from "@/lib/utils";

export const checkboxRootClass =
  "relative flex h-4 w-4 shrink-0 items-center justify-center";

export const checkboxInputClass = "peer sr-only";

const checkboxBoxBaseClass =
  "flex h-4 w-4 items-center justify-center rounded border bg-background text-transparent transition-colors peer-disabled:cursor-not-allowed peer-disabled:opacity-50 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2";

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
