type FormatNumberOptions = {
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
};

/** Remove thousand separators; leaves decimal dot intact. */
export function stripDecimalGrouping(raw: string): string {
  return raw.replace(/,/g, "");
}

/**
 * Format decimal text for inputs: `,` groups thousands, `.` separates decimals.
 * Preserves in-progress typing such as `123.` or `.5`.
 */
export function formatDecimalInput(raw: string): string {
  const stripped = stripDecimalGrouping(raw.trim());
  if (!stripped) return "";

  const trailingDot = stripped.endsWith(".");
  let intPart = "";
  let hasDot = false;
  let decPart = "";

  for (const ch of stripped) {
    if (ch >= "0" && ch <= "9") {
      if (hasDot) decPart += ch;
      else intPart += ch;
    } else if (ch === "." && !hasDot) {
      hasDot = true;
    } else {
      break;
    }
  }

  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (!hasDot) return formattedInt;
  if (trailingDot && decPart === "") return `${formattedInt}.`;
  return decPart ? `${formattedInt}.${decPart}` : formattedInt;
}

/**
 * Format numeric values with thousands separators for UI display.
 * Invalid or empty values are rendered as `0`.
 */
export function formatNumber(
  value: number | string | null | undefined,
  options?: FormatNumberOptions,
): string {
  const raw =
    typeof value === "number"
      ? value
      : Number(stripDecimalGrouping(String(value ?? "")).trim());

  if (!Number.isFinite(raw)) {
    return "0";
  }

  return raw.toLocaleString("en-US", {
    minimumFractionDigits: options?.minimumFractionDigits ?? 0,
    maximumFractionDigits: options?.maximumFractionDigits ?? 2,
  });
}
