import { NextResponse } from "next/server";

import { AUTH_COOKIE_NAME } from "@/shared/lib/authCookie";

export async function POST() {
  const res = NextResponse.json({ success: true });
  res.cookies.delete(AUTH_COOKIE_NAME);
  return res;
}
