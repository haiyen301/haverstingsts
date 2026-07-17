type FormatNumberOptions = {
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
};

/** Remove thousand separators; leaves decimal dot intact. */
export function stripDecimalGrouping(raw: string): string {
  return raw.replace(/,/g, "");
}

/**
 * Normalize typed decimal text before formatting/parsing.
 * Trailing `,` (iOS vi keypad) and a single mid-string `,` (e.g. `1,25`) become `.`.
 */
export function normalizeDecimalTyping(raw: string): string {
  let text = raw.replace(/[^\d.,]/g, "");
  if (text.includes(".")) return text;

  if (text.endsWith(",")) {
    return `${text.slice(0, -1)}.`;
  }

  const commaIdx = text.indexOf(",");
  if (commaIdx >= 0 && !text.slice(commaIdx + 1).includes(",")) {
    const intPart = text.slice(0, commaIdx).replace(/,/g, "");
    const decPart = text.slice(commaIdx + 1);
    const looksLikeThousands =
      intPart.length >= 1 && decPart.length === 3 && /^\d+$/.test(decPart);
    if (decPart.length > 0 && decPart.length <= 4 && !looksLikeThousands) {
      return `${intPart}.${decPart}`;
    }
  }

  // e.g. "0,8" stripped to "08" without a separator → 0.8
  const leadingZero = /^0(\d{1,4})$/.exec(text);
  if (leadingZero) {
    return `0.${leadingZero[1]}`;
  }

  return text;
}

/** Normalized decimal string for API payloads (preserves fractional digits). */
export function normalizedDecimalApiString(
  raw: string | null | undefined,
): string | undefined {
  if (raw == null || !raw.trim()) return undefined;
  let normalized = stripDecimalGrouping(normalizeDecimalTyping(raw.trim()));
  if (!normalized || normalized === ".") return undefined;
  if (normalized.endsWith(".")) {
    normalized = normalized.slice(0, -1);
  }
  if (!normalized) return undefined;
  const n = Number(normalized);
  if (!Number.isFinite(n)) return undefined;
  return normalized;
}

/**
 * Format decimal text for inputs where comma is only a thousands separator and dot
 * is the only decimal separator. Does not convert commas into decimals while typing.
 */
export function formatDecimalInputCommaThousands(raw: string): string {
  const text = raw.replace(/[^\d.,]/g, "");
  if (!text) return "";

  const dotIdx = text.indexOf(".");
  const hasDot = dotIdx >= 0;

  let intPart = "";
  let decPart = "";
  let trailingDot = false;

  if (hasDot) {
    intPart = text.slice(0, dotIdx).replace(/,/g, "");
    const afterDot = text.slice(dotIdx + 1).replace(/[.,]/g, "");
    trailingDot = text.endsWith(".") && afterDot === "";
    decPart = afterDot;
  } else {
    intPart = text.replace(/,/g, "");
  }

  if (!intPart && !hasDot) return "";
  if (!intPart && hasDot) intPart = "0";

  // Leading zero: integer is only `0`; further integer digits require a decimal point first.
  if (intPart.length > 1 && intPart[0] === "0") {
    if (!hasDot) return "0";
    intPart = "0";
  } else if (intPart.length > 1) {
    intPart = intPart.replace(/^0+/, "") || "0";
  }

  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (!hasDot) return formattedInt;
  if (trailingDot && !decPart) return `${formattedInt}.`;
  return decPart ? `${formattedInt}.${decPart}` : formattedInt;
}

/**
 * Format decimal text for inputs: `,` groups thousands, `.` separates decimals.
 * Preserves in-progress typing such as `123.` or `.5`.
 */
export function formatDecimalInput(raw: string): string {
  const stripped = stripDecimalGrouping(normalizeDecimalTyping(raw.trim()));
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

/** Trim redundant trailing zeros after the decimal point (e.g. `0.80000` → `0.8`). */
export function trimTrailingDecimalZeros(raw: string): string {
  const s = raw.trim();
  if (!s.includes(".")) return s;
  return s.replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Format a stored numeric value for decimal inputs.
 * Whole numbers omit a fractional part (e.g. `3000` → `3,000`, not `3,000.000`).
 */
export function formatDecimalInputFromValue(
  value: number | string | null | undefined,
): string {
  const raw = stripDecimalGrouping(
    normalizeDecimalTyping(String(value ?? "").trim()),
  );
  if (!raw) return "";
  const n = Number(raw);
  if (!Number.isFinite(n)) return formatDecimalInput(raw);
  if (Number.isInteger(n)) return formatDecimalInput(String(Math.trunc(n)));
  const trimmed = trimTrailingDecimalZeros(n.toFixed(10));
  return formatDecimalInput(trimmed);
}

/**
 * Format numeric values for display without redundant trailing decimal zeros.
 */
export function formatDecimalDisplay(
  value: number | string | null | undefined,
  maximumFractionDigits = 4,
): string {
  const raw =
    typeof value === "number"
      ? value
      : Number(
          stripDecimalGrouping(
            normalizeDecimalTyping(String(value ?? "").trim()),
          ),
        );

  if (!Number.isFinite(raw)) return "0";

  return raw.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });
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
      : Number(
          stripDecimalGrouping(
            normalizeDecimalTyping(String(value ?? "").trim()),
          ),
        );

  if (!Number.isFinite(raw)) {
    return "0";
  }

  return raw.toLocaleString("en-US", {
    minimumFractionDigits: options?.minimumFractionDigits ?? 0,
    maximumFractionDigits: options?.maximumFractionDigits ?? 2,
  });
}

/** Parse formatted decimal input (`1,234.56`, `1,25`) back to a number. */
export function parseDecimalField(raw: string): number {
  const n = Number(
    stripDecimalGrouping(normalizeDecimalTyping(raw.trim())),
  );
  return Number.isFinite(n) ? n : NaN;
}
