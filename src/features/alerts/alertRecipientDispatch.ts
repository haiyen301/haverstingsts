import type { CreateAlertInput } from "@/features/alerts/api/alertsApi";
import { mergeAlertFeedConfigWithDefaults } from "@/features/alerts/alertFeedConfigDefaults";
import type {
  AlertFeedConfig,
  AlertRecipientRule,
  AlertRouteBinding,
  AlertRouteKey,
} from "@/features/alerts/alertFeedConfigTypes";
import { normalizeRecipientRule } from "@/features/alerts/alertFeedConfigTypes";

/** Merged config + route → who gets `user_alerts` rows (STSPortal `Alerts::save`). */
export function resolveRecipientForRoute(
  routeKey: AlertRouteKey,
  config: AlertFeedConfig,
): AlertRecipientRule {
  const merged = mergeAlertFeedConfigWithDefaults(config);
  const binding = merged.routeBindings.find((x) => x.routeKey === routeKey);
  return normalizeRecipientRule(binding?.recipient ?? merged.defaultRecipient);
}

/** Maps rule → fields consumed by `createAlert` / PHP `save`. */
export function applyRecipientToCreateAlert(
  input: CreateAlertInput,
  rule: AlertRecipientRule,
): CreateAlertInput {
  const r = normalizeRecipientRule(rule);
  if (r.mode === "all_users") {
    return { ...input, userIds: undefined, recipientAllUsers: true, recipientRoleIds: undefined };
  }
  if (r.mode === "role_ids" && (r.roleIds?.length ?? 0) > 0) {
    return { ...input, userIds: undefined, recipientAllUsers: false, recipientRoleIds: r.roleIds };
  }
  if (r.mode === "user_ids" && (r.userIds?.length ?? 0) > 0) {
    return { ...input, userIds: r.userIds, recipientAllUsers: false, recipientRoleIds: undefined };
  }
  return { ...input, userIds: undefined, recipientAllUsers: false, recipientRoleIds: undefined };
}

export function recipientFromBinding(
  binding: AlertRouteBinding | undefined,
  config: AlertFeedConfig,
): AlertRecipientRule {
  const merged = mergeAlertFeedConfigWithDefaults(config);
  return normalizeRecipientRule(binding?.recipient ?? merged.defaultRecipient);
}
