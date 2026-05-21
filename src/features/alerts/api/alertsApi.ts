"use client";

import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import { emitAlertsUpdated } from "@/features/alerts/alertClientEvents";
import { stsProxyGetWithParams, stsProxyPostJson } from "@/shared/api/stsProxyClient";

export type AlertSeverity = "info" | "success" | "warning" | "critical";
export type AlertType = "daily-harvest" | "inventory" | "new-project" | "custom" | string;

export type AlertPushPayload = {
  thumb_url?: string;
  gallery_urls?: string[];
  push_mobile?: boolean;
  push_web?: boolean;
  push_email?: boolean;
  /** e.g. `projects_new` — stored in `alert_events.payload` for workers. */
  route_key?: string;
};

export type AlertFeedItem = {
  id: string;
  eventId: string;
  type: AlertType;
  title: string;
  message: string;
  severity: AlertSeverity;
  createdAt: string;
  read: boolean;
  href?: string;
  icon?: string;
  imageUrl?: string;
  thumbUrl?: string;
  galleryUrls?: string[];
  pushMobile?: boolean;
  pushWeb?: boolean;
  pushEmail?: boolean;
  routeKey?: string;
  status?: string;
  actionPayload?: Record<string, unknown>;
};

export type CreateAlertInput = {
  type?: AlertType;
  title: string;
  message: string;
  severity?: AlertSeverity;
  icon?: string;
  imageUrl?: string;
  href?: string;
  /** Explicit STS `users.id` list (highest priority when set, unless `recipientAllUsers` / roles). */
  userIds?: number[];
  /** When true, PHP creates rows for all active users (cap on server). */
  recipientAllUsers?: boolean;
  /** PHP resolves to users with these `roles.id`. */
  recipientRoleIds?: number[];
  sourceEntityType?: string;
  sourceEntityId?: string;
  dedupeKey?: string;
  /** Merged into PHP `alert_events.payload` (thumb, gallery, push flags). */
  pushPayload?: AlertPushPayload;
};

export async function fetchMyAlerts(params?: {
  limit?: number;
  unread?: boolean;
  type?: string;
}): Promise<AlertFeedItem[]> {
  const data = await stsProxyGetWithParams<AlertFeedItem[]>(STS_API_PATHS.alerts, {
    limit: params?.limit,
    unread: params?.unread ? 1 : undefined,
    type: params?.type,
  });
  return Array.isArray(data) ? data : [];
}

export async function createAlert(input: CreateAlertInput): Promise<{ event_id: number }> {
  const push = input.pushPayload;
  const payload =
    push !== undefined
      ? (() => {
          const rk =
            typeof push.route_key === "string" && push.route_key.trim() !== ""
              ? push.route_key.trim().slice(0, 64)
              : undefined;
          return {
            thumb_url: push.thumb_url ?? "",
            gallery_urls: Array.isArray(push.gallery_urls) ? push.gallery_urls : [],
            push_mobile: Boolean(push.push_mobile),
            push_web: Boolean(push.push_web),
            push_email: Boolean(push.push_email),
            ...(rk ? { route_key: rk } : {}),
          };
        })()
      : undefined;

  const body: Record<string, unknown> = {
    type: input.type ?? "custom",
    title: input.title,
    message: input.message,
    severity: input.severity ?? "info",
    icon: input.icon ?? "",
    image_url: input.imageUrl ?? "",
    href: input.href ?? "",
    source_entity_type: input.sourceEntityType ?? "manual",
    source_entity_id: input.sourceEntityId ?? "",
    dedupe_key: input.dedupeKey ?? "",
    ...(payload ? { payload } : {}),
  };

  if (input.recipientAllUsers) {
    body.recipient_all_users = 1;
    body.user_ids = [];
    body.recipient_role_ids = [];
  } else if (input.recipientRoleIds && input.recipientRoleIds.length > 0) {
    body.recipient_role_ids = input.recipientRoleIds;
    body.user_ids = [];
  } else if (input.userIds && input.userIds.length > 0) {
    body.user_ids = input.userIds;
  } else {
    body.user_ids = [];
  }

  const result = await stsProxyPostJson<{ event_id: number }>(STS_API_PATHS.alertSave, body);
  emitAlertsUpdated();
  return result;
}

export async function markAlertRead(id: string): Promise<void> {
  await stsProxyPostJson(STS_API_PATHS.alertMarkRead, { id: Number(id) });
  emitAlertsUpdated();
}

export async function markAllAlertsRead(): Promise<void> {
  await stsProxyPostJson(STS_API_PATHS.alertMarkAllRead, {});
  emitAlertsUpdated();
}

export async function markAlertTypeRead(type: string): Promise<void> {
  await stsProxyPostJson(STS_API_PATHS.alertMarkTypeRead, { type });
  emitAlertsUpdated();
}

export type UpdateAlertInput = {
  id: string;
  title: string;
  message: string;
  severity?: AlertSeverity;
  icon?: string;
  imageUrl?: string;
  href?: string;
};

export async function updateAlert(input: UpdateAlertInput): Promise<void> {
  await stsProxyPostJson(STS_API_PATHS.alertUpdateEvent, {
    id: Number(input.id),
    title: input.title,
    message: input.message,
    severity: input.severity ?? "info",
    icon: input.icon ?? "",
    image_url: input.imageUrl ?? "",
    href: input.href ?? "",
  });
  emitAlertsUpdated();
}

export async function removeAlert(userAlertId: string): Promise<void> {
  await stsProxyPostJson(STS_API_PATHS.alertRemove, { id: Number(userAlertId) });
  emitAlertsUpdated();
}

