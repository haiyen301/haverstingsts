import { fetchAlertFeedConfig, resolveAlertTypeForRoute } from "@/features/alerts/alertFeedConfigApi";
import { mergeAlertFeedConfigWithDefaults } from "@/features/alerts/alertFeedConfigDefaults";
import type {
  AlertFeedConfig,
  AlertRecipientRule,
  AlertRouteKey,
} from "@/features/alerts/alertFeedConfigTypes";
import { dispatchCustomAlert } from "@/features/alerts/dispatchCustomAlert";
import { resolveRecipientForRoute } from "@/features/alerts/alertRecipientDispatch";
import type { AlertSeverity } from "@/features/alerts/api/alertsApi";

/**
 * Payload for automatic screen alerts. **Do not** pass category or push channels here — they always
 * come from Admin → Alert settings (`alert-feed-config`): the route’s **category** dropdown and
 * **Mobile / Web / Email** checkboxes (and **Recipients**), keyed by `routeKey`.
 */
export type DispatchRouteAlertInput = {
  routeKey: AlertRouteKey;
  title: string;
  message: string;
  href?: string;
  thumbUrl?: string;
  gallery_urls?: string[];
  severity?: AlertSeverity;
  /** Shown in My Alerts; also sent as `source_entity_id` for traceability. */
  sourceEntityId?: string;
  dedupeKey?: string;
};

export type DispatchRouteAlertResult =
  | { ok: true; categoryType: string }
  | {
      ok: false;
      skipped: "no_permission" | "no_category" | "empty_text" | "request_failed";
      error?: string;
    };

/** Category (`alert_types.code`), push flags, and recipient for `routeKey` — all from merged alert settings. */
export function resolveRouteAlertSettings(
  routeKey: AlertRouteKey,
  config: AlertFeedConfig,
): {
  categoryCode: string | null;
  channels: { push_mobile: boolean; push_web: boolean; push_email: boolean };
  recipient: AlertRecipientRule;
} {
  const merged = mergeAlertFeedConfigWithDefaults(config);
  const b = merged.routeBindings.find((x) => x.routeKey === routeKey);
  return {
    categoryCode: resolveAlertTypeForRoute(routeKey, merged),
    channels: {
      push_mobile: b?.push_mobile ?? true,
      push_web: b?.push_web ?? true,
      push_email: b?.push_email ?? false,
    },
    recipient: resolveRecipientForRoute(routeKey, merged),
  };
}

/**
 * Creates an in-app alert (STSPortal `/api/alerts/save`) using the category and push-channel flags
 * configured for `routeKey` in User Management → Alert settings (`data/alert-feed-config.json`).
 *
 * Outbound FCM / web push / SMTP is **not** sent from the browser: flags are stored on the event
 * payload (`push_mobile`, `push_web`, `push_email`, `route_key`) for a backend worker to consume
 * (see `doc/alerts-route-dispatch.md`).
 */
export async function dispatchRouteAlert(
  input: DispatchRouteAlertInput,
  options?: { config?: AlertFeedConfig },
): Promise<DispatchRouteAlertResult> {
  const title = input.title.trim();
  const message = input.message.trim();
  if (!title || !message) {
    return { ok: false, skipped: "empty_text" };
  }

  const config = options?.config ?? (await fetchAlertFeedConfig());
  const merged = mergeAlertFeedConfigWithDefaults(config);
  const { categoryCode: categoryType, channels, recipient } = resolveRouteAlertSettings(
    input.routeKey,
    merged,
  );
  if (!categoryType) {
    return { ok: false, skipped: "no_category" };
  }

  const result = await dispatchCustomAlert({
    categoryCode: categoryType,
    title: input.title,
    message: input.message,
    href: input.href,
    thumbUrl: input.thumbUrl,
    gallery_urls: input.gallery_urls,
    severity: input.severity,
    sourceEntityType: "stsrenew_route",
    sourceEntityId: input.sourceEntityId ?? input.routeKey,
    dedupeKey: input.dedupeKey,
    channels: {
      mobile: channels.push_mobile,
      web: channels.push_web,
      email: channels.push_email,
    },
    routeKey: input.routeKey,
    recipient,
    bypassClientPermissionCheck: true,
  });

  if (result.ok) {
    return { ok: true, categoryType: result.categoryCode };
  }
  if (result.skipped === "no_category") {
    return { ok: false, skipped: "no_category" };
  }
  return result;
}
