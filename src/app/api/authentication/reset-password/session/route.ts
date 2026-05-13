import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { AUTH_COOKIE_NAME } from "@/shared/lib/authCookie";

export async function GET() {
  const token = (await cookies()).get(AUTH_COOKIE_NAME)?.value?.trim();
  return NextResponse.json({ authenticated: Boolean(token) });
}
