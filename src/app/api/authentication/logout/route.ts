import { NextResponse } from "next/server";

import { AUTH_ACL_COOKIE_NAME, AUTH_COOKIE_NAME } from "@/shared/lib/authCookie";

export async function POST() {
  const res = NextResponse.json({ success: true });
  res.cookies.delete(AUTH_COOKIE_NAME);
  res.cookies.delete(AUTH_ACL_COOKIE_NAME);
  return res;
}
