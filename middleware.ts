import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  parsePrivilegedAdminUserId,
  userIdIsPrivilegedAdmin,
} from "@/shared/auth/privilegedAdminAccess";
import { sanitizeMaintenanceReturnPath } from "@/shared/auth/maintenanceReturnPath";
import { MAINTENANCE_GRACE_COOKIE_NAME } from "@/shared/auth/maintenanceGraceCookie";
import {
  AUTH_ACL_COOKIE_NAME,
  AUTH_COOKIE_NAME,
  AUTH_USER_ID_COOKIE_NAME,
} from "@/shared/lib/authCookie";

const MAINTENANCE_STATUS_PATH = "/api/system/maintenance";
const SESSION_PATH = "/api/authentication/session";

function isMaintenanceExemptPath(pathname: string): boolean {
  if (pathname === "/maintenance") return true;
  if (pathname === MAINTENANCE_STATUS_PATH) return true;
  if (pathname === SESSION_PATH) return true;
  if (pathname.startsWith("/api/authentication")) return true;
  if (pathname === "/") return true;
  if (pathname === "/forgot-password" || pathname === "/register") return true;
  if (pathname.startsWith("/_next")) return true;
  if (pathname.startsWith("/assets")) return true;
  if (pathname.startsWith("/flags")) return true;
  if (pathname === "/favicon.ico") return true;
  return false;
}

function parseAuthUserIdFromCookie(req: NextRequest): number | undefined {
  const raw = req.cookies.get(AUTH_USER_ID_COOKIE_NAME)?.value?.trim();
  return parsePrivilegedAdminUserId(raw);
}

async function fetchMaintenanceEnabled(req: NextRequest): Promise<boolean> {
  try {
    const url = new URL(MAINTENANCE_STATUS_PATH, req.url);
    const res = await fetch(url, {
      headers: { "x-sts-maintenance-check": "1" },
      cache: "no-store",
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { data?: { enabled?: boolean } };
    return json.data?.enabled === true;
  } catch {
    return false;
  }
}

async function resolveUserIdForMiddleware(
  req: NextRequest,
): Promise<number | undefined> {
  const fromCookie = parseAuthUserIdFromCookie(req);
  if (fromCookie != null) return fromCookie;

  const token = req.cookies.get(AUTH_COOKIE_NAME)?.value?.trim();
  if (!token) return undefined;

  try {
    const url = new URL(SESSION_PATH, req.url);
    const res = await fetch(url, {
      headers: { cookie: req.headers.get("cookie") ?? "" },
      cache: "no-store",
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as { userId?: unknown };
    return parsePrivilegedAdminUserId(json.userId);
  } catch {
    return undefined;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isMaintenanceExemptPath(pathname)) {
    if (pathname.startsWith("/admin")) {
      const token = req.cookies.get(AUTH_COOKIE_NAME)?.value?.trim();
      if (!token) {
        return NextResponse.redirect(new URL("/", req.url));
      }
    }
    return NextResponse.next();
  }

  const bypassUserId = parseAuthUserIdFromCookie(req);
  if (
    bypassUserId != null &&
    userIdIsPrivilegedAdmin(bypassUserId)
  ) {
    if (pathname.startsWith("/admin")) {
      const token = req.cookies.get(AUTH_COOKIE_NAME)?.value?.trim();
      if (!token) {
        return NextResponse.redirect(new URL("/", req.url));
      }
    }
    return NextResponse.next();
  }

  const maintenanceOn = await fetchMaintenanceEnabled(req);
  if (maintenanceOn) {
    const hasToken = Boolean(req.cookies.get(AUTH_COOKIE_NAME)?.value?.trim());
    const userId = await resolveUserIdForMiddleware(req);

    if (userId != null && userIdIsPrivilegedAdmin(userId)) {
      return NextResponse.next();
    }

    if (userId != null && !userIdIsPrivilegedAdmin(userId)) {
      const graceActive =
        req.cookies.get(MAINTENANCE_GRACE_COOKIE_NAME)?.value === "1";
      if (graceActive) {
        return NextResponse.next();
      }

      const dest = new URL("/maintenance", req.url);
      dest.searchParams.set("session", "cleared");
      const from = sanitizeMaintenanceReturnPath(
        pathname + req.nextUrl.search,
      );
      if (from) dest.searchParams.set("from", from);
      const res = NextResponse.redirect(dest);
      res.cookies.delete(AUTH_COOKIE_NAME);
      res.cookies.delete(AUTH_USER_ID_COOKIE_NAME);
      res.cookies.delete(AUTH_ACL_COOKIE_NAME);
      return res;
    }

    // Token present but user id not resolved yet — let the app load (syncs sts_auth_uid).
    if (hasToken && userId == null) {
      return NextResponse.next();
    }
  }

  if (pathname.startsWith("/admin")) {
    const token = req.cookies.get(AUTH_COOKIE_NAME)?.value?.trim();
    if (!token) {
      return NextResponse.redirect(new URL("/", req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
