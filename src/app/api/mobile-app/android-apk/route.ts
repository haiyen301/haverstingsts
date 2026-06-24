import { NextResponse } from "next/server";

import {
  ANDROID_APK_DOWNLOAD_PATH,
  getAndroidApkFilenameSuffixForHost,
} from "@/shared/config/deploymentEnvironment";
import { hasAndroidApkForSuffix } from "@/shared/server/androidApkAssets";

/** Whether an Android APK is available for the current portal host (no filename exposed). */
export async function GET(req: Request) {
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";

  const suffix = getAndroidApkFilenameSuffixForHost(host);
  if (!hasAndroidApkForSuffix(suffix)) {
    return NextResponse.json({ success: true, data: { url: null } });
  }

  return NextResponse.json({
    success: true,
    data: { url: ANDROID_APK_DOWNLOAD_PATH },
  });
}
