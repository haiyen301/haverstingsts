import {
  MAINTENANCE_GRACE_COOKIE_NAME,
  MAINTENANCE_GRACE_HEADER,
} from "@/shared/auth/maintenanceGraceCookie";

export function maintenanceGraceHeadersFromRequest(
  req: Request,
): Record<string, string> {
  const cookie = req.headers.get("cookie") ?? "";
  const pattern = new RegExp(
    `(?:^|;\\s*)${MAINTENANCE_GRACE_COOKIE_NAME}=1(?:;|$)`,
  );
  if (!pattern.test(cookie)) return {};
  return { [MAINTENANCE_GRACE_HEADER]: "1" };
}
