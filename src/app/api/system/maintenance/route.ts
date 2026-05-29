import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { userIdIsPrivilegedAdmin } from "@/shared/auth/privilegedAdminAccess";
import { AUTH_COOKIE_NAME } from "@/shared/lib/authCookie";
import { normalizeMaintenancePatch } from "@/shared/system/maintenanceConfig";
import {
  fetchMaintenanceStatusFromUpstream,
  saveMaintenanceConfigToUpstream,
} from "@/shared/server/maintenanceUpstream";
import { fetchTrustedAclByToken } from "@/shared/server/trustedAcl";

async function readBearerToken(req: Request): Promise<string> {
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ") && authHeader.length > 8) {
    return authHeader.slice(7).trim();
  }
  return (await cookies()).get(AUTH_COOKIE_NAME)?.value?.trim() ?? "";
}

async function requireMaintenanceAdmin(req: Request): Promise<Response | null> {
  const token = await readBearerToken(req);
  if (!token) {
    return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
  }
  const acl = await fetchTrustedAclByToken(token);
  if (!acl) {
    return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
  }
  if (!userIdIsPrivilegedAdmin(acl.userId)) {
    return NextResponse.json({ success: false, message: "Forbidden." }, { status: 403 });
  }
  return null;
}

/** Public status — reads STSPortal `sts_settings` (shared with mobile). */
export async function GET() {
  const data = await fetchMaintenanceStatusFromUpstream();
  return NextResponse.json({
    success: true,
    data: {
      enabled: data.enabled,
      message: data.message,
      estimatedReturn: data.estimatedReturn,
      updatedAt: data.updatedAt,
      evictionCountdownSec: data.evictionCountdownSec,
    },
  });
}

/** Toggle maintenance in database — only user id 409. */
export async function POST(req: Request) {
  const gate = await requireMaintenanceAdmin(req);
  if (gate) return gate;

  const token = await readBearerToken(req);
  if (!token) {
    return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON." }, { status: 400 });
  }

  const cfg = normalizeMaintenancePatch(body);
  if (!cfg) {
    return NextResponse.json({ success: false, message: "Invalid payload." }, { status: 400 });
  }

  const bodyObj = body as Record<string, unknown>;
  const countdownRaw =
    bodyObj.evictionCountdownSec ?? bodyObj.eviction_countdown_sec;
  const saved = await saveMaintenanceConfigToUpstream(token, {
    enabled: cfg.enabled,
    message: cfg.message,
    estimatedReturn: cfg.estimatedReturn,
    ...(countdownRaw !== undefined && countdownRaw !== null
      ? { evictionCountdownSec: Number(countdownRaw) }
      : {}),
  });

  if (!saved) {
    return NextResponse.json(
      { success: false, message: "Could not save maintenance settings to server." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      enabled: saved.enabled,
      message: saved.message ?? "",
      estimatedReturn: saved.estimatedReturn ?? "",
      updatedAt: saved.updatedAt ?? null,
      evictionCountdownSec: saved.evictionCountdownSec,
    },
  });
}
