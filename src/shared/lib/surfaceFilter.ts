/**
 * Nền + màu chữ cho control lọc / chọn có trạng thái “trống” vs “đã có giá trị”.
 * Maps tới token trong `globals.css`:
 * - `--surface-filter-empty` (nền trống) / `bg-primary/10` (nền đã chọn)
 * - `--filter-color-empty` (#222) / `--filter-color-filled` (#333) (chữ)
 *
 * Tailwind: `bg-surface-filter-*` + `text-filter-*`.
 */
export const SURFACE_FILTER_EMPTY_CLASS = "bg-surface-filter-empty";
export const SURFACE_FILTER_FILLED_CLASS = "bg-surface-filter-filled";
export const FILTER_COLOR_EMPTY_CLASS = "text-filter-empty";
export const FILTER_COLOR_FILLED_CLASS = "text-filter-filled";
/** Border when a filter has an active selection (maps to `hsl(var(--primary))`). */
export const FILTER_BORDER_FILLED_CLASS = "border-primary";
/** Background when a filter has an active selection (`hsl(var(--primary))` at 10% opacity). */
export const FILTER_BG_FILLED_CLASS = "bg-primary/10";

export function textSurfaceFilter(hasValue: boolean): string {
  return hasValue ? FILTER_COLOR_FILLED_CLASS : FILTER_COLOR_EMPTY_CLASS;
}

export function bgSurfaceFilter(hasValue: boolean): string {
  return hasValue
    ? `${FILTER_BG_FILLED_CLASS} ${FILTER_COLOR_FILLED_CLASS} ${FILTER_BORDER_FILLED_CLASS}`
    : `${SURFACE_FILTER_EMPTY_CLASS} ${FILTER_COLOR_EMPTY_CLASS}`;
}

/** Alias — nền + màu chữ filter. */
export function surfaceFilter(hasValue: boolean): string {
  return bgSurfaceFilter(hasValue);
}
