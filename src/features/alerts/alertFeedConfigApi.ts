import type { AlertFeedConfig } from "@/features/alerts/alertFeedConfigTypes";
import {
  DEFAULT_ALERT_FEED_CONFIG,
  mergeAlertFeedConfigWithDefaults,
} from "@/features/alerts/alertFeedConfigDefaults";

type ConfigResponse = { success: boolean; data?: AlertFeedConfig; message?: string };

export async function fetchAlertFeedConfig(): Promise<AlertFeedConfig> {
  const res = await fetch("/api/admin/alert-feed-config", {
    method: "GET",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const json = (await res.json()) as ConfigResponse;
  if (!res.ok || !json.success || !json.data) {
    return mergeAlertFeedConfigWithDefaults(DEFAULT_ALERT_FEED_CONFIG);
  }
  return mergeAlertFeedConfigWithDefaults(json.data);
}

export async function saveAlertFeedConfig(body: AlertFeedConfig): Promise<void> {
  const res = await fetch("/api/admin/alert-feed-config", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as ConfigResponse;
  if (!res.ok || !json.success) {
    throw new Error(json.message ?? `Save failed (${res.status})`);
  }
}

export function resolveCategoryTypeForRoute(
  routeKey: AlertFeedConfig["routeBindings"][number]["routeKey"],
  config: AlertFeedConfig,
): string | null {
  const b = config.routeBindings.find((x) => x.routeKey === routeKey);
  if (!b?.categoryId) return null;
  const cat = config.categories.find((c) => c.id === b.categoryId);
  return cat?.id ?? b.categoryId;
}

/** Same as `resolveCategoryTypeForRoute` — use when calling `createAlert({ type })` from harvest/project flows. */
export const resolveAlertTypeForRoute = resolveCategoryTypeForRoute;
