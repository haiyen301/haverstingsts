import { cookies } from "next/headers";

import { AUTH_COOKIE_NAME } from "@/shared/lib/authCookie";

export const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
};

/** `Authorization: Bearer …` from header or HttpOnly session cookie. */
export async function resolveStsBearerFromRequest(
  req: Request,
): Promise<string | null> {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ") && auth.length > 8) return auth;
  const store = await cookies();
  const token = store.get(AUTH_COOKIE_NAME)?.value?.trim();
  if (token) return `Bearer ${token}`;
  return null;
}
