import {
  MOBILE_PUSH_NOTIFICATION_CONFIG,
  type MobilePushAlertAction,
} from "@/features/alerts/mobilePushNotificationConfig";
import type { AlertPushPayload } from "@/features/alerts/api/alertsApi";

export type BuildAlertPushPayloadInput = {
  pushMobile?: boolean;
  pushWeb?: boolean;
  pushEmail?: boolean;
  thumbUrl?: string;
  galleryUrls?: string[];
  routeKey?: string;
  action?: MobilePushAlertAction;
  sourcePlatform?: "web" | "mobile";
};

/** Builds `pushPayload` for `createAlert` / `updateAlert` with mobile defaults from config. */
export function buildAlertPushPayload(input: BuildAlertPushPayloadInput = {}): AlertPushPayload {
  const defaults = MOBILE_PUSH_NOTIFICATION_CONFIG.defaults;
  const thumb = (input.thumbUrl ?? "").trim();
  const rk = (input.routeKey ?? "").trim().slice(0, 64);

  return {
    thumb_url: thumb,
    gallery_urls: (input.galleryUrls ?? []).slice(0, 12),
    push_mobile: input.pushMobile ?? defaults.pushMobile,
    push_web: input.pushWeb ?? defaults.pushWeb,
    push_email: input.pushEmail ?? defaults.pushEmail,
    source_platform: input.sourcePlatform ?? "web",
    ...(rk ? { route_key: rk } : {}),
    ...(input.action ? { push_action: input.action } : {}),
  };
}
