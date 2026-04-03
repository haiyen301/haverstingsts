/**
 * HttpOnly session cookie name for the STS JWT.
 * Token must not be stored in localStorage/sessionStorage (survives browser restart).
 */
export const AUTH_COOKIE_NAME = "sts_token";
