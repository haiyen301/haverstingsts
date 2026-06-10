import { NextResponse } from "next/server";

import {
  getProjectListGoogleSheetConfig,
  GOOGLE_SHEET_OAUTH_AUTHORIZE_PATH,
} from "@/features/project/config/projectListGoogleSheetConfig";
import {
  buildGoogleOAuthAuthorizeUrl,
  createOAuthState,
  isGoogleExportOAuthConfigured,
  setOAuthStateCookie,
} from "@/shared/server/googleExportOAuth";
import { isPublicHarvestExportDemoOAuthReturnPath } from "@/features/harvest/lib/harvestExportDemoOAuthPaths";
import { resolveStsBearerFromRequest } from "@/shared/server/stsAuthBearer";

function requestOrigin(req: Request): string {
  const url = new URL(req.url);
  return url.origin;
}

/** Start Google OAuth — user is redirected to Google consent, then callback route. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const returnTo = url.searchParams.get("returnTo")?.trim() || "/projects";

  // STS login required except when returnTo is the public demo page only.
  if (!isPublicHarvestExportDemoOAuthReturnPath(returnTo)) {
    const auth = await resolveStsBearerFromRequest(req);
    if (!auth?.startsWith("Bearer ")) {
      return NextResponse.json(
        { ok: false, message: "Authorization required." },
        { status: 401 },
      );
    }
  }

  const origin = requestOrigin(req);
  const config = getProjectListGoogleSheetConfig(origin);
  if (!isGoogleExportOAuthConfigured(config)) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Google OAuth is not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET — see projectListGoogleSheetConfig.ts.",
      },
      { status: 503 },
    );
  }
  const state = createOAuthState(returnTo);
  const authorizeUrl = buildGoogleOAuthAuthorizeUrl(config, state);

  const res = NextResponse.redirect(authorizeUrl);
  setOAuthStateCookie(res, state);
  return res;
}

/** Return authorize URL as JSON (for SPA redirect without full page navigation to API). */
export async function POST(req: Request) {
  let returnTo = "/projects";
  try {
    const body = (await req.json()) as { returnTo?: string };
    if (body.returnTo?.trim()) returnTo = body.returnTo.trim();
  } catch {
    /* optional body */
  }

  if (!isPublicHarvestExportDemoOAuthReturnPath(returnTo)) {
    const auth = await resolveStsBearerFromRequest(req);
    if (!auth?.startsWith("Bearer ")) {
      return NextResponse.json(
        { ok: false, message: "Authorization required." },
        { status: 401 },
      );
    }
  }

  const origin = requestOrigin(req);
  const config = getProjectListGoogleSheetConfig(origin);
  if (!isGoogleExportOAuthConfigured(config)) {
    return NextResponse.json(
      { ok: false, configured: false, message: "Google OAuth is not configured." },
      { status: 503 },
    );
  }

  const state = createOAuthState(returnTo);
  const authorizeUrl = buildGoogleOAuthAuthorizeUrl(config, state);
  const res = NextResponse.json({
    ok: true,
    authorizeUrl,
    callbackPath: GOOGLE_SHEET_OAUTH_AUTHORIZE_PATH,
  });
  setOAuthStateCookie(res, state);
  return res;
}
