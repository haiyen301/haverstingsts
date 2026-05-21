/** STS `users.id` values allowed to open Alert feed settings UI and `/api/admin/alert-feed-config`. */
export const ALERT_FEED_SETTINGS_ALLOWED_USER_IDS = new Set<number>([409]);

export function userIdMayAccessAlertFeedSettings(userId: number | undefined): boolean {
  if (userId == null || !Number.isInteger(userId) || userId <= 0) return false;
  return ALERT_FEED_SETTINGS_ALLOWED_USER_IDS.has(userId);
}
