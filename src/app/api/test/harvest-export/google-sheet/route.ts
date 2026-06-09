import { NextResponse } from "next/server";

import { getProjectListGoogleSheetConfig } from "@/features/project/config/projectListGoogleSheetConfig";
import { writeProjectListToUserGoogleSheet } from "@/features/project/lib/googleSheetOAuthExport";
import type { ProjectListGoogleSheetExportPayload } from "@/features/project/lib/projectListExport";
import {
  getValidGoogleExportAccessToken,
  isGoogleExportOAuthConfigured,
} from "@/shared/server/googleExportOAuth";

function requestOrigin(req: Request): string {
  return new URL(req.url).origin;
}

/** Public demo endpoint — no STS login; Google OAuth cookie only. */
export async function POST(req: Request) {
  const origin = requestOrigin(req);
  const config = getProjectListGoogleSheetConfig(origin);
  if (!isGoogleExportOAuthConfigured(config)) {
    return NextResponse.json(
      {
        ok: false,
        needsAuth: true,
        message:
          "Google OAuth is not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.",
      },
      { status: 503 },
    );
  }

  let body: ProjectListGoogleSheetExportPayload;
  try {
    body = (await req.json()) as ProjectListGoogleSheetExportPayload;
  } catch {
    return NextResponse.json(
      { ok: false, message: "Invalid JSON body." },
      { status: 400 },
    );
  }

  if (!Array.isArray(body.headers) || !Array.isArray(body.rows)) {
    return NextResponse.json(
      { ok: false, message: "Payload must include headers and rows arrays." },
      { status: 400 },
    );
  }

  const tokenResult = await getValidGoogleExportAccessToken(origin);
  if (!tokenResult) {
    return NextResponse.json(
      {
        ok: false,
        needsAuth: true,
        message: "Connect your Google account to export.",
        authorizePath: "/api/projects/export/google-sheet/oauth/authorize",
      },
      { status: 401 },
    );
  }

  try {
    const result = await writeProjectListToUserGoogleSheet({
      accessToken: tokenResult.accessToken,
      config: {
        ...config,
        sheetTabName: body.sheetTabName?.trim() || "harvests-demo",
      },
      payload: {
        ...body,
        sheetTabName: body.sheetTabName?.trim() || "harvests-demo",
      },
    });
    return NextResponse.json({
      ok: true,
      message: "Exported demo data to your Google Drive.",
      spreadsheetUrl: result.spreadsheetUrl,
      spreadsheetId: result.spreadsheetId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, message: msg }, { status: 502 });
  }
}

export async function GET(req: Request) {
  const origin = requestOrigin(req);
  const config = getProjectListGoogleSheetConfig(origin);
  const configured = isGoogleExportOAuthConfigured(config);
  const tokenResult = configured
    ? await getValidGoogleExportAccessToken(origin)
    : null;

  return NextResponse.json({
    configured,
    connected: Boolean(tokenResult),
    authorizePath: "/api/projects/export/google-sheet/oauth/authorize",
  });
}
