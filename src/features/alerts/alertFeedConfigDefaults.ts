import type { AlertFeedConfig, AlertRouteBinding, AlertRouteKey } from "@/features/alerts/alertFeedConfigTypes";
import { ALERT_ROUTE_KEYS, normalizeRecipientRule } from "@/features/alerts/alertFeedConfigTypes";

const DEFAULT_CHANNELS = { push_mobile: true, push_web: true, push_email: false };

export function defaultPushChannelsForRoute(_routeKey: AlertRouteKey): typeof DEFAULT_CHANNELS {
  return { ...DEFAULT_CHANNELS };
}

/** Fill missing `push_*` on bindings and ensure every route key exists. */
export function mergeAlertFeedConfigWithDefaults(raw: AlertFeedConfig): AlertFeedConfig {
  const categories = raw.categories.length > 0 ? raw.categories : DEFAULT_ALERT_FEED_CONFIG.categories;
  const catIds = new Set(categories.map((c) => c.id));
  const defaultRecipient = normalizeRecipientRule(
    raw.defaultRecipient ?? DEFAULT_ALERT_FEED_CONFIG.defaultRecipient,
  );
  const byRoute = new Map<AlertRouteKey, AlertRouteBinding>();
  for (const b of raw.routeBindings) {
    if (!ALERT_ROUTE_KEYS.includes(b.routeKey)) continue;
    if (!catIds.has(b.categoryId)) continue;
    byRoute.set(b.routeKey, {
      ...b,
      push_mobile: b.push_mobile ?? defaultPushChannelsForRoute(b.routeKey).push_mobile,
      push_web: b.push_web ?? defaultPushChannelsForRoute(b.routeKey).push_web,
      push_email: b.push_email ?? defaultPushChannelsForRoute(b.routeKey).push_email,
      recipient: normalizeRecipientRule(b.recipient ?? defaultRecipient),
    });
  }
  for (const rk of ALERT_ROUTE_KEYS) {
    if (byRoute.has(rk)) continue;
    const def = DEFAULT_ALERT_FEED_CONFIG.routeBindings.find((x) => x.routeKey === rk);
    const categoryId = def?.categoryId && catIds.has(def.categoryId) ? def.categoryId : categories[0].id;
    const ch = defaultPushChannelsForRoute(rk);
    byRoute.set(rk, {
      id: def?.id ?? `rb-${rk}`,
      routeKey: rk,
      categoryId,
      push_mobile: ch.push_mobile,
      push_web: ch.push_web,
      push_email: ch.push_email,
      recipient: normalizeRecipientRule(def?.recipient ?? defaultRecipient),
    });
  }
  return {
    version: 1,
    categories,
    defaultRecipient,
    routeBindings: ALERT_ROUTE_KEYS.map((rk) => byRoute.get(rk)!),
  };
}

export const DEFAULT_ALERT_FEED_CONFIG: AlertFeedConfig = {
  version: 1,
  defaultRecipient: { mode: "self" },
  categories: [
    {
      id: "daily-harvest",
      title: "Daily harvest summaries",
      description: "Recap of each day's harvests with photos and key details.",
      icon: "calendar-days",
    },
    {
      id: "inventory",
      title: "Inventory warnings",
      description: "Zones running low stock or reaching maximum capacity.",
      icon: "warehouse",
    },
    {
      id: "new-project",
      title: "New projects",
      description: "Notifications when a new project is added to the system.",
      icon: "folder-plus",
    },
  ],
  routeBindings: [
    {
      id: "rb-harvest-new",
      routeKey: "harvest_new",
      categoryId: "daily-harvest",
      push_mobile: true,
      push_web: true,
      push_email: false,
    },
    {
      id: "rb-harvest-import",
      routeKey: "harvest_import",
      categoryId: "daily-harvest",
      push_mobile: true,
      push_web: true,
      push_email: false,
    },
    {
      id: "rb-projects-new",
      routeKey: "projects_new",
      categoryId: "new-project",
      push_mobile: true,
      push_web: true,
      push_email: false,
    },
    {
      id: "rb-projects-import",
      routeKey: "projects_import",
      categoryId: "new-project",
      push_mobile: true,
      push_web: true,
      push_email: false,
    },
    {
      id: "rb-inventory-update",
      routeKey: "inventory_update",
      categoryId: "inventory",
      push_mobile: true,
      push_web: true,
      push_email: false,
    },
  ],
};
