/**
 * HttpOnly session cookie name for the STS JWT.
 * Token must not be stored in localStorage/sessionStorage (survives browser restart).
 */
export const AUTH_COOKIE_NAME = "sts_token";
/** Compact ACL snapshot (is_admin + relevant can_* keys) for server guards. */
export const AUTH_ACL_COOKIE_NAME = "sts_acl";
/** STS `users.id` for fast middleware maintenance bypass checks. */
export const AUTH_USER_ID_COOKIE_NAME = "sts_auth_uid";
