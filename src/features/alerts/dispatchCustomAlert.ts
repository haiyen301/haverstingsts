"use client";

import { createAlert, type AlertSeverity } from "@/features/alerts/api/alertsApi";
import { applyRecipientToCreateAlert } from "@/features/alerts/alertRecipientDispatch";
import type { AlertRecipientRule } from "@/features/alerts/alertFeedConfigTypes";
import { hasModulePermission } from "@/shared/auth/permissions";
import { useAuthUserStore } from "@/shared/store/authUserStore";

/**
 * How to set push **intent** flags on the saved event (`push_mobile` / `push_web` / `push_email` in payload).
 * The browser does not send FCM/email itself; a backend worker reads these flags.
 *
 * - `'all'`: all three channels `true`.
 * - Object: each key is explicit — `true` / `false`; omitted keys count as `false`.
 */
export type DispatchCustomAlertChannels =
  | "all"
  | Partial<{ mobile: boolean; web: boolean; email: boolean }>;

export type DispatchCustomAlertInput = {
  /** `alert_types.code` in STSPortal (e.g. `new-project`, `daily-harvest`). Must match an existing type. */
  categoryCode: string;
  title: string;
  message: string;
  href?: string;
  thumbUrl?: string;
  gallery_urls?: string[];
  severity?: AlertSeverity;
  sourceEntityType?: string;
  sourceEntityId?: string;
  dedupeKey?: string;
  channels?: DispatchCustomAlertChannels;
  /** Optional; stored in `payload.route_key` for workers / analytics (max 64 chars). */
  routeKey?: string;
  /** Who receives the alert; default `{ mode: "self" }` (API actor only). */
  recipient?: AlertRecipientRule;
  /**
   * Automatic route alerts can bypass the client-side `my_alerts.create` gate because backend
   * `Alerts::save` only requires an authenticated user. Manual compose should keep the gate.
   */
  bypassClientPermissionCheck?: boolean;
};

export type DispatchCustomAlertResult =
  | { ok: true; categoryCode: string }
  | {
      ok: false;
      skipped: "no_permission" | "empty_text" | "no_category" | "request_failed";
      error?: string;
    };

function resolvePushFlags(channels: DispatchCustomAlertChannels | undefined): {
  push_mobile: boolean;
  push_web: boolean;
  push_email: boolean;
} {
  if (channels === undefined || channels === "all") {
    return { push_mobile: true, push_web: true, push_email: true };
  }
  return {
    push_mobile: Boolean(channels.mobile),
    push_web: Boolean(channels.web),
    push_email: Boolean(channels.email),
  };
}

/**
 * Create an in-app alert with **your** title, message, **category** (`alert_types.code`), and **push channel** flags.
 * Use this when you do not want route-based defaults from `alert-feed-config.json`.
 *
 * By default requires `my_alerts` **create**. Route-based automatic alerts may bypass that
 * client-only check and rely on backend auth instead.
 */
export async function dispatchCustomAlert(
  input: DispatchCustomAlertInput,
): Promise<DispatchCustomAlertResult> {
  if (typeof window === "undefined") {
    return { ok: false, skipped: "no_permission" };
  }

  const user = useAuthUserStore.getState().user;
  const u = user as Record<string, unknown> | null;
  const isAdmin = Boolean(u?.is_admin ?? u?.Is_Admin);
  if (!user) {
    return { ok: false, skipped: "no_permission" };
  }
  const needsCreatePermission = input.bypassClientPermissionCheck !== true;
  if (needsCreatePermission && !hasModulePermission("my_alerts", user, "create", isAdmin)) {
    return { ok: false, skipped: "no_permission" };
  }

  const categoryCode = input.categoryCode.trim();
  if (!categoryCode) {
    return { ok: false, skipped: "no_category" };
  }

  const title = input.title.trim();
  const message = input.message.trim();
  if (!title || !message) {
    return { ok: false, skipped: "empty_text" };
  }

  const flags = resolvePushFlags(input.channels);
  const thumb = (input.thumbUrl ?? "").trim();
  const rk = (input.routeKey ?? "").trim().slice(0, 64);

  try {
    const base = {
      type: categoryCode,
      title,
      message,
      severity: input.severity ?? "info",
      icon: "bell",
      imageUrl: thumb,
      href: (input.href ?? "").trim(),
      sourceEntityType: (input.sourceEntityType ?? "stsrenew_custom").trim() || "stsrenew_custom",
      sourceEntityId: (input.sourceEntityId ?? "").trim(),
      dedupeKey: input.dedupeKey,
      pushPayload: {
        thumb_url: thumb,
        gallery_urls: (input.gallery_urls ?? []).slice(0, 12),
        push_mobile: flags.push_mobile,
        push_web: flags.push_web,
        push_email: flags.push_email,
        source_platform: "web" as const,
        ...(rk ? { route_key: rk } : {}),
      },
    };
    const withRecipients = applyRecipientToCreateAlert(base, input.recipient ?? { mode: "self" });
    await createAlert(withRecipients);
    return { ok: true, categoryCode };
  } catch (e) {
    return {
      ok: false,
      skipped: "request_failed",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
