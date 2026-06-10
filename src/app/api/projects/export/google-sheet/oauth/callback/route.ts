import { NextResponse } from "next/server";

import {
  buildStsRenewPublicRedirectUrl,
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
        buildStsRenewPublicRedirectUrl(
          "/login?error=google_export_auth",
          requestOrigin(req),
        ),
      );
    }
  }

  const origin = requestOrigin(req);
  const config = getProjectListGoogleSheetConfig(origin);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code")?.trim();

  const failRedirectBasePath = (): string => {
    if (isPublicDemo) return DEMO_HARVEST_GOOGLE_SHEET_RETURN_PATH;
    const raw = stateFromQuery?.returnTo?.trim() || "/projects";
    const pathname = raw.split("?")[0]?.split("#")[0] || "/projects";
    return pathname.startsWith("/") ? pathname : "/projects";
  };

  const failRedirect = (message: string) => {
    const target = buildStsRenewPublicRedirectUrl(failRedirectBasePath(), origin);
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
    const res = NextResponse.redirect(buildStsRenewPublicRedirectUrl(returnTo, origin));
    applyGoogleExportOAuthTokensCookie(res, merged);
    clearOAuthStateCookie(res);
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return failRedirect(msg);
  }
}
