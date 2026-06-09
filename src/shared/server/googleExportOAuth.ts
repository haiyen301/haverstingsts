import { createHash, randomBytes } from "crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  getProjectListGoogleSheetConfig,
  GOOGLE_SHEETS_EXPORT_OAUTH_SCOPES,
  type ProjectListGoogleSheetConfig,
} from "@/features/project/config/projectListGoogleSheetConfig";
import { AUTH_COOKIE_OPTIONS } from "@/shared/server/stsAuthBearer";

export const GOOGLE_EXPORT_OAUTH_TOKEN_COOKIE = "sts_google_export_oauth";
export const GOOGLE_EXPORT_OAUTH_STATE_COOKIE = "sts_google_export_oauth_state";

const TOKEN_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
const STATE_COOKIE_MAX_AGE = 600;

export type GoogleExportOAuthTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope?: string;
};

export type GoogleOAuthStatePayload = {
  nonce: string;
  returnTo: string;
};

function encodeCookieJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCookieJson<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export function decodeOAuthStatePayload(raw: string | null | undefined): GoogleOAuthStatePayload | null {
  if (!raw) return null;
  return decodeCookieJson<GoogleOAuthStatePayload>(raw);
}

export function createOAuthState(returnTo: string): GoogleOAuthStatePayload {
  return {
    nonce: randomBytes(16).toString("hex"),
    returnTo: sanitizeReturnTo(returnTo),
  };
}

function sanitizeReturnTo(returnTo: string): string {
  const trimmed = returnTo.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return "/projects";
  }
  return trimmed;
}

export async function readGoogleExportOAuthTokens(): Promise<GoogleExportOAuthTokens | null> {
  const store = await cookies();
  return decodeCookieJson<GoogleExportOAuthTokens>(
    store.get(GOOGLE_EXPORT_OAUTH_TOKEN_COOKIE)?.value,
  );
}

export async function writeGoogleExportOAuthTokens(
  tokens: GoogleExportOAuthTokens,
): Promise<void> {
  const store = await cookies();
  store.set(GOOGLE_EXPORT_OAUTH_TOKEN_COOKIE, encodeCookieJson(tokens), {
    ...AUTH_COOKIE_OPTIONS,
    maxAge: TOKEN_COOKIE_MAX_AGE,
  });
}

export function applyGoogleExportOAuthTokensCookie(
  res: NextResponse,
  tokens: GoogleExportOAuthTokens,
): void {
  res.cookies.set(GOOGLE_EXPORT_OAUTH_TOKEN_COOKIE, encodeCookieJson(tokens), {
    ...AUTH_COOKIE_OPTIONS,
    maxAge: TOKEN_COOKIE_MAX_AGE,
  });
}

export async function clearGoogleExportOAuthTokens(): Promise<void> {
  const store = await cookies();
  store.delete(GOOGLE_EXPORT_OAUTH_TOKEN_COOKIE);
}

export function setOAuthStateCookie(
  res: NextResponse,
  state: GoogleOAuthStatePayload,
): void {
  res.cookies.set(
    GOOGLE_EXPORT_OAUTH_STATE_COOKIE,
    encodeCookieJson(state),
    {
      ...AUTH_COOKIE_OPTIONS,
      maxAge: STATE_COOKIE_MAX_AGE,
    },
  );
}

export async function readOAuthStateCookie(): Promise<GoogleOAuthStatePayload | null> {
  const store = await cookies();
  return decodeCookieJson<GoogleOAuthStatePayload>(
    store.get(GOOGLE_EXPORT_OAUTH_STATE_COOKIE)?.value,
  );
}

export function clearOAuthStateCookie(res: NextResponse): void {
  res.cookies.set(GOOGLE_EXPORT_OAUTH_STATE_COOKIE, "", {
    ...AUTH_COOKIE_OPTIONS,
    maxAge: 0,
  });
}

export function buildGoogleOAuthAuthorizeUrl(
  config: ProjectListGoogleSheetConfig,
  state: GoogleOAuthStatePayload,
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GOOGLE_SHEETS_EXPORT_OAUTH_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state: encodeCookieJson(state),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function postGoogleToken(
  config: ProjectListGoogleSheetConfig,
  body: Record<string, string>,
): Promise<GoogleExportOAuthTokens> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      ...body,
    }),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as GoogleTokenResponse;
  if (!res.ok || !data.access_token) {
    throw new Error(
      data.error_description ??
        data.error ??
        `Google token exchange failed (${res.status}).`,
    );
  }
  const expiresIn = Number(data.expires_in ?? 3600);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + expiresIn * 1000 - 30_000,
    scope: data.scope,
  };
}

export async function exchangeGoogleOAuthCode(
  config: ProjectListGoogleSheetConfig,
  code: string,
): Promise<GoogleExportOAuthTokens> {
  return postGoogleToken(config, {
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
  });
}

export async function refreshGoogleExportAccessToken(
  config: ProjectListGoogleSheetConfig,
  refreshToken: string,
): Promise<GoogleExportOAuthTokens> {
  return postGoogleToken(config, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

export async function getValidGoogleExportAccessToken(
  requestOrigin?: string,
): Promise<{ accessToken: string; tokens: GoogleExportOAuthTokens } | null> {
  const config = getProjectListGoogleSheetConfig(requestOrigin);
  if (!isGoogleExportOAuthConfigured(config)) return null;

  const existing = await readGoogleExportOAuthTokens();
  if (!existing?.accessToken) return null;

  if (existing.expiresAt > Date.now()) {
    return { accessToken: existing.accessToken, tokens: existing };
  }

  if (!existing.refreshToken) {
    await clearGoogleExportOAuthTokens();
    return null;
  }

  try {
    const refreshed = await refreshGoogleExportAccessToken(
      config,
      existing.refreshToken,
    );
    const merged: GoogleExportOAuthTokens = {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? existing.refreshToken,
      expiresAt: refreshed.expiresAt,
      scope: refreshed.scope ?? existing.scope,
    };
    await writeGoogleExportOAuthTokens(merged);
    return { accessToken: merged.accessToken, tokens: merged };
  } catch {
    await clearGoogleExportOAuthTokens();
    return null;
  }
}

export function isGoogleExportOAuthConfigured(
  config: ProjectListGoogleSheetConfig,
): boolean {
  return Boolean(
    config.enabled &&
      config.clientId &&
      config.clientSecret &&
      config.redirectUri,
  );
}

export function hashOAuthState(state: GoogleOAuthStatePayload): string {
  return createHash("sha256").update(state.nonce).digest("hex");
}
