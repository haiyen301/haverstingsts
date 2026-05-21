/**
 * Maintenance eviction countdown (web).
 *
 * Change `MAINTENANCE_EVICTION_COUNTDOWN_SEC` to adjust how long users see
 * the warning before sign-out. Flutter uses the same value in
 * `stsapp/lib/data/controller/maintenance/maintenance_controller.dart`.
 */

/** Seconds before sign-out and redirect to /maintenance. */
export const MAINTENANCE_EVICTION_COUNTDOWN_SEC = 20;

/** Poll interval while users browse (detects maintenance ON without refresh). */
export const MAINTENANCE_STATUS_POLL_MS = 10_500;

export type MaintenanceEvictionToastCorner =
  | "bottom-right"
  | "bottom-left"
  | "top-right"
  | "top-left";

/** Corner placement for the eviction countdown toast. */
export const MAINTENANCE_EVICTION_TOAST_CORNER: MaintenanceEvictionToastCorner =
  "bottom-right";

const TOAST_CORNER_CLASS: Record<MaintenanceEvictionToastCorner, string> = {
  "bottom-right": "bottom-4 right-4 sm:bottom-6 sm:right-6",
  "bottom-left": "bottom-4 left-4 sm:bottom-6 sm:left-6",
  "top-right": "top-4 right-4 sm:top-6 sm:right-6",
  "top-left": "top-4 left-4 sm:top-6 sm:left-6",
};

export function maintenanceEvictionToastPositionClass(): string {
  return `fixed z-[9999] ${TOAST_CORNER_CLASS[MAINTENANCE_EVICTION_TOAST_CORNER]}`;
}
