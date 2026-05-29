import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";

import { AUTH_COOKIE_NAME } from "@/shared/lib/authCookie";
import { cookies } from "next/headers";
import { fetchTrustedAclByToken } from "@/shared/server/trustedAcl";
import { userIdIsPrivilegedAdmin } from "@/shared/auth/privilegedAdminAccess";
import { hasModulePermission } from "@/shared/auth/permissions";
import {
  ALERT_CATEGORY_ICON_KEYS,
  ALERT_ROUTE_KEYS,
  type AlertFeedCategory,
  type AlertFeedConfig,
  type AlertRecipientRule,
  type AlertRouteBinding,
  isValidCategoryId,
  normalizeRecipientRule,
} from "@/features/alerts/alertFeedConfigTypes";
import {
  DEFAULT_ALERT_FEED_CONFIG,
  defaultPushChannelsForRoute,
  mergeAlertFeedConfigWithDefaults,
} from "@/features/alerts/alertFeedConfigDefaults";

const CONFIG_PATH = path.join(process.cwd(), "data", "alert-feed-config.json");
const SEED_CONFIG_PATH = path.join(process.cwd(), "seeds", "alert-feed-config.seed.json");

function isIconKey(v: string): v is (typeof ALERT_CATEGORY_ICON_KEYS)[number] {
  return (ALERT_CATEGORY_ICON_KEYS as readonly string[]).includes(v);
}

function isRouteKey(v: string): v is (typeof ALERT_ROUTE_KEYS)[number] {
  return (ALERT_ROUTE_KEYS as readonly string[]).includes(v);
}

function normalizeCategory(raw: unknown): AlertFeedCategory | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? "").trim().toLowerCase();
  const title = String(o.title ?? "").trim();
  const description = String(o.description ?? "").trim();
  const icon = String(o.icon ?? "bell").trim();
  if (!isValidCategoryId(id) || title === "") return null;
  if (!isIconKey(icon)) return null;
  return { id, title, description, icon };
}

function normalizeRecipientRaw(raw: unknown): AlertRecipientRule | undefined {
  if (raw === null || raw === undefined || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const mode = String(o.mode ?? "").trim();
  if (mode === "self") return { mode: "self" };
  if (mode === "all_users") return { mode: "all_users" };
  if (mode === "user_ids") {
    const arr = Array.isArray(o.userIds) ? o.userIds : [];
    const userIds = arr
      .map((x) => Number(x))
      .filter((n) => Number.isInteger(n) && n > 0)
      .slice(0, 100);
    return { mode: "user_ids", userIds };
  }
  if (mode === "role_ids") {
    const arr = Array.isArray(o.roleIds) ? o.roleIds : [];
    const roleIds = arr
      .map((x) => Number(x))
      .filter((n) => Number.isInteger(n) && n > 0)
      .slice(0, 30);
    return { mode: "role_ids", roleIds };
  }
  return undefined;
}

function normalizeBinding(raw: unknown, categoryIds: Set<string>): AlertRouteBinding | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? "").trim();
  const routeKey = String(o.routeKey ?? "").trim();
  const categoryId = String(o.categoryId ?? "").trim();
  if (id === "" || !isRouteKey(routeKey) || !isValidCategoryId(categoryId)) return null;
  if (!categoryIds.has(categoryId)) return null;
  const defCh = defaultPushChannelsForRoute(routeKey);
  const readBool = (k: string, fallback: boolean): boolean => {
    if (!(k in o)) return fallback;
    const v = o[k];
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    const s = String(v).trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes";
  };
  const recRaw = normalizeRecipientRaw(o.recipient);
  const base: AlertRouteBinding = {
    id,
    routeKey,
    categoryId,
    push_mobile: readBool("push_mobile", defCh.push_mobile),
    push_web: readBool("push_web", defCh.push_web),
    push_email: readBool("push_email", defCh.push_email),
  };
  if (recRaw !== undefined) {
    base.recipient = normalizeRecipientRule(recRaw);
  }
  return base;
}

function parseConfig(raw: unknown): AlertFeedConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (Number(o.version) !== 1) return null;
  const catsIn = Array.isArray(o.categories) ? o.categories : [];
  const categories: AlertFeedCategory[] = [];
  for (const c of catsIn) {
    const n = normalizeCategory(c);
    if (n) categories.push(n);
  }
  if (categories.length === 0) return null;
  const catIds = new Set(categories.map((c) => c.id));
  const bindsIn = Array.isArray(o.routeBindings) ? o.routeBindings : [];
  const routeBindings: AlertRouteBinding[] = [];
  for (const b of bindsIn) {
    const n = normalizeBinding(b, catIds);
    if (n) routeBindings.push(n);
  }
  const cfg: AlertFeedConfig = { version: 1, categories, routeBindings };
  const dr = normalizeRecipientRaw(o.defaultRecipient);
  if (dr !== undefined) {
    cfg.defaultRecipient = normalizeRecipientRule(dr);
  }
  return cfg;
}

async function readBearerToken(req: Request): Promise<string> {
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ") && authHeader.length > 8) {
    return authHeader.slice(7).trim();
  }
  return (await cookies()).get(AUTH_COOKIE_NAME)?.value?.trim() ?? "";
}

/** Any valid session — used so project/harvest screens can load route→category mappings without `admin_people`. */
async function requireAuthenticated(req: Request): Promise<Response | null> {
  const token = await readBearerToken(req);
  if (!token) {
    return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
  }
  const acl = await fetchTrustedAclByToken(token);
  if (!acl) {
    return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
  }
  return null;
}

async function requireAdminPeopleEdit(req: Request): Promise<Response | null> {
  const token = await readBearerToken(req);
  if (!token) {
    return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
  }
  const acl = await fetchTrustedAclByToken(token);
  if (!acl) {
    return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
  }
  const ok =
    hasModulePermission("admin_people", acl.permissions, "edit", acl.is_admin) ||
    hasModulePermission("admin_people", acl.permissions, "create", acl.is_admin) ||
    acl.is_admin;
  if (!ok) {
    return NextResponse.json({ success: false, message: "Forbidden." }, { status: 403 });
  }
  if (!userIdIsPrivilegedAdmin(acl.userId)) {
    return NextResponse.json({ success: false, message: "Forbidden." }, { status: 403 });
  }
  return null;
}

async function readConfigFromDisk(): Promise<AlertFeedConfig | null> {
  for (const candidate of [CONFIG_PATH, SEED_CONFIG_PATH]) {
    try {
      const raw = await fs.readFile(candidate, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      const cfg = parseConfig(parsed);
      if (cfg) return cfg;
    } catch {
      /* try next source */
    }
  }
  return null;
}

export async function GET(req: Request) {
  const gate = await requireAuthenticated(req);
  if (gate) return gate;

  const cfg = await readConfigFromDisk();
  if (cfg) {
    return NextResponse.json({ success: true, data: mergeAlertFeedConfigWithDefaults(cfg) });
  }
  return NextResponse.json({
    success: true,
    data: mergeAlertFeedConfigWithDefaults(DEFAULT_ALERT_FEED_CONFIG),
  });
}

export async function POST(req: Request) {
  const gate = await requireAdminPeopleEdit(req);
  if (gate) return gate;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON." }, { status: 400 });
  }

  const cfg = parseConfig(body);
  if (!cfg) {
    return NextResponse.json(
      { success: false, message: "Invalid config: need version 1, non-empty categories." },
      { status: 400 },
    );
  }

  const merged = mergeAlertFeedConfigWithDefaults(cfg);

  try {
    await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
    await fs.writeFile(CONFIG_PATH, JSON.stringify(merged, null, 2), "utf8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { success: false, message: `Could not write config file: ${msg}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, data: merged });
}
