export const ALERT_ROUTE_KEYS = [
  "harvest_new",
  "harvest_import",
  "projects_new",
  "projects_import",
] as const;

export type AlertRouteKey = (typeof ALERT_ROUTE_KEYS)[number];

export const ALERT_CATEGORY_ICON_KEYS = [
  "calendar-days",
  "warehouse",
  "folder-plus",
  "bell",
  "package",
  "megaphone",
] as const;

export type AlertCategoryIconKey = (typeof ALERT_CATEGORY_ICON_KEYS)[number];

export type AlertFeedCategory = {
  id: string;
  title: string;
  description: string;
  icon: AlertCategoryIconKey;
};

export type RoutePushChannels = {
  push_mobile: boolean;
  push_web: boolean;
  push_email: boolean;
};

/** Who receives in-app `user_alerts` for automatic route dispatch (`Alerts::save` → `user_ids` / roles / all). */
export type AlertRecipientMode = "self" | "user_ids" | "role_ids" | "all_users";

export type AlertRecipientRule = {
  mode: AlertRecipientMode;
  /** STS `users.id` when `mode === "user_ids"`. */
  userIds?: number[];
  /** STS `roles.id` when `mode === "role_ids"`. */
  roleIds?: number[];
};

export type AlertRouteBinding = {
  id: string;
  routeKey: AlertRouteKey;
  categoryId: string;
  /** When omitted, defaults apply in merge (mobile+web on, email off). */
  push_mobile?: boolean;
  push_web?: boolean;
  push_email?: boolean;
  /** When omitted, `AlertFeedConfig.defaultRecipient` applies, then `{ mode: "self" }`. */
  recipient?: AlertRecipientRule;
};

export type AlertFeedConfig = {
  version: 1;
  categories: AlertFeedCategory[];
  routeBindings: AlertRouteBinding[];
  /** Default recipient when a route binding has no `recipient`. */
  defaultRecipient?: AlertRecipientRule;
};

export function isValidCategoryId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(id);
}

export function normalizeRecipientRule(rule: AlertRecipientRule | undefined): AlertRecipientRule {
  if (!rule || !rule.mode) {
    return { mode: "self" };
  }
  if (rule.mode === "user_ids") {
    const userIds = (rule.userIds ?? [])
      .map((n) => (typeof n === "number" ? n : Number(n)))
      .filter((n) => Number.isInteger(n) && n > 0)
      .slice(0, 100);
    return { mode: "user_ids", userIds };
  }
  if (rule.mode === "role_ids") {
    const roleIds = (rule.roleIds ?? [])
      .map((n) => (typeof n === "number" ? n : Number(n)))
      .filter((n) => Number.isInteger(n) && n > 0)
      .slice(0, 30);
    return { mode: "role_ids", roleIds };
  }
  if (rule.mode === "all_users") {
    return { mode: "all_users" };
  }
  return { mode: "self" };
}
