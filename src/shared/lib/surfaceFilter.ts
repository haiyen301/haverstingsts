/**
 * Nền cho control lọc / chọn có trạng thái “trống” vs “đã có giá trị”.
 * Maps tới token trong `globals.css`: `--surface-filter-empty` (--card, trắng) và
 * `--surface-filter-filled` (--background, xanh nhạt).
 *
 * Tailwind: `bg-surface-filter-empty` | `bg-surface-filter-filled`.
 */
export const SURFACE_FILTER_EMPTY_CLASS = "bg-surface-filter-empty";
export const SURFACE_FILTER_FILLED_CLASS = "bg-surface-filter-filled";

export function bgSurfaceFilter(hasValue: boolean): string {
  return hasValue ? SURFACE_FILTER_FILLED_CLASS : SURFACE_FILTER_EMPTY_CLASS;
}
