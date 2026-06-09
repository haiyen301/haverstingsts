import { NextResponse } from "next/server";

import {
  getProjectListGoogleSheetConfig,
  GOOGLE_SHEET_EXPORT_RESUME_QUERY,
  GOOGLE_SHEET_EXPORT_RESUME_VALUE,
} from "@/features/project/config/projectListGoogleSheetConfig";
import {
  clearOAuthStateCookie,
  decodeOAuthStatePayload,
  exchangeGoogleOAuthCode,
  applyGoogleExportOAuthTokensCookie,
  readGoogleExportOAuthTokens,
  readOAuthStateCookie,
} from "@/shared/server/googleExportOAuth";
import { resolveStsBearerFromRequest } from "@/shared/server/stsAuthBearer";

function requestOrigin(req: Request): string {
  return new URL(req.url).origin;
}

function appendResumeQuery(returnTo: string): string {
  const path = returnTo.trim() || "/projects";
  const url = new URL(path, "http://local");
  url.searchParams.set(GOOGLE_SHEET_EXPORT_RESUME_QUERY, GOOGLE_SHEET_EXPORT_RESUME_VALUE);
  return `${url.pathname}${url.search}`;
}

/**
 * OAuth callback — Google redirects here after user clicks Allow.
 * Saves tokens → redirects to `/projects?googleSheetExport=resume`.
 */
export async function GET(req: Request) {
  const auth = await resolveStsBearerFromRequest(req);
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.redirect(
      new URL("/login?error=google_export_auth", req.url),
    );
  }

  const origin = requestOrigin(req);
  const config = getProjectListGoogleSheetConfig(origin);
  const url = new URL(req.url);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code")?.trim();
  const stateRaw = url.searchParams.get("state");

  const failRedirect = (message: string) => {
    const target = new URL("/projects", req.url);
    target.searchParams.set("googleSheetExport", "error");
    target.searchParams.set("googleSheetError", message.slice(0, 200));
    const res = NextResponse.redirect(target);
    clearOAuthStateCookie(res);
    return res;
  };

  if (error) {
    return failRedirect(error);
  }

  if (!code) {
    return failRedirect("Missing authorization code.");
  }

  const stateFromQuery = decodeOAuthStatePayload(stateRaw);
  const stateFromCookie = await readOAuthStateCookie();
  if (
    !stateFromQuery?.nonce ||
    !stateFromCookie?.nonce ||
    stateFromQuery.nonce !== stateFromCookie.nonce
  ) {
    return failRedirect("Invalid OAuth state.");
  }

  try {
    const tokens = await exchangeGoogleOAuthCode(config, code);
    const previous = await readGoogleExportOAuthTokens();
    const merged = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? previous?.refreshToken,
      expiresAt: tokens.expiresAt,
      scope: tokens.scope ?? previous?.scope,
    };

    const returnTo = appendResumeQuery(stateFromQuery.returnTo || "/projects");
    const res = NextResponse.redirect(new URL(returnTo, req.url));
    applyGoogleExportOAuthTokensCookie(res, merged);
    clearOAuthStateCookie(res);
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return failRedirect(msg);
  }
}
