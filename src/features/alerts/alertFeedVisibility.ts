import type { AlertFeedItem } from "@/features/alerts/api/alertsApi";
import { parseStsPortalUtcDate } from "@/shared/lib/format/date";

/** Read alerts older than this are hidden from the feed. */
export const READ_ALERT_FEED_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

export function isAlertVisibleInFeed(alert: AlertFeedItem, nowMs = Date.now()): boolean {
  if (!alert.read) return true;
  const ts = parseStsPortalUtcDate(alert.createdAt)?.getTime();
  if (!ts) return true;
  return nowMs - ts <= READ_ALERT_FEED_MAX_AGE_MS;
}

export function filterVisibleAlerts(alerts: AlertFeedItem[]): AlertFeedItem[] {
  return alerts.filter(isAlertVisibleInFeed);
}
