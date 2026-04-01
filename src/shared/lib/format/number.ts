type FormatNumberOptions = {
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
};

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
      : Number(String(value ?? "").replace(/,/g, "").trim());

  if (!Number.isFinite(raw)) {
    return "0";
  }

  return raw.toLocaleString("en-US", {
    minimumFractionDigits: options?.minimumFractionDigits ?? 0,
    maximumFractionDigits: options?.maximumFractionDigits ?? 2,
  });
}
