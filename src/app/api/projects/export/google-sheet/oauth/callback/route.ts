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
import {
  DEMO_HARVEST_GOOGLE_SHEET_RETURN_PATH,
  isPublicHarvestExportDemoOAuthReturnPath,
} from "@/features/harvest/lib/harvestExportDemoOAuthPaths";
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
 * Saves tokens → redirects to returnTo with `googleSheetExport=resume`.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const stateRaw = url.searchParams.get("state");
  const stateFromQuery = decodeOAuthStatePayload(stateRaw);
  const isPublicDemo = isPublicHarvestExportDemoOAuthReturnPath(
    stateFromQuery?.returnTo ?? "",
  );

  // STS login required except when OAuth was started from `/test/harvest-export` only.
  if (!isPublicDemo) {
    const auth = await resolveStsBearerFromRequest(req);
    if (!auth?.startsWith("Bearer ")) {
      return NextResponse.redirect(
        new URL("/login?error=google_export_auth", req.url),
      );
    }
  }

  const origin = requestOrigin(req);
  const config = getProjectListGoogleSheetConfig(origin);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code")?.trim();

  const failRedirect = (message: string) => {
    const target = new URL(
      isPublicDemo ? DEMO_HARVEST_GOOGLE_SHEET_RETURN_PATH : "/projects",
      req.url,
    );
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
