import { NextResponse } from "next/server";

import { resolveAndroidApkPublicUrl } from "@/shared/server/androidApkAssets";

/** Public STSPortal APK download URL for the footer (tier from `NEXT_PUBLIC_STS_API_BASE_URLS`). */
export async function GET() {
  const url = resolveAndroidApkPublicUrl();
  if (!url) {
    return NextResponse.json({ success: true, data: { url: null } });
  }

  return NextResponse.json({
    success: true,
    data: { url },
  });
}
