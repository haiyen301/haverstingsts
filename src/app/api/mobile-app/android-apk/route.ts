import { NextResponse } from "next/server";

import { ANDROID_APK_DOWNLOAD_PATH } from "@/shared/config/deploymentEnvironment";
import { hasAndroidApkForEnv } from "@/shared/server/androidApkAssets";

/** Whether an Android APK is available for this deploy (no filename exposed). */
export async function GET() {
  if (!hasAndroidApkForEnv()) {
    return NextResponse.json({ success: true, data: { url: null } });
  }

  return NextResponse.json({
    success: true,
    data: { url: ANDROID_APK_DOWNLOAD_PATH },
  });
}
