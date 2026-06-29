import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { NextResponse } from "next/server";

import { getAndroidApkFilenameSuffixesFromEnv } from "@/shared/config/deploymentEnvironment";
import { resolveAndroidApkFile } from "@/shared/server/androidApkAssets";

export const runtime = "nodejs";

/** Stream the env-matched APK without revealing the on-disk filename. */
export async function GET() {
  const suffixes = getAndroidApkFilenameSuffixesFromEnv();
  if (!suffixes.length) {
    return NextResponse.json({ success: false, message: "Not found." }, { status: 404 });
  }

  const apk = resolveAndroidApkFile(suffixes);
  if (!apk) {
    return NextResponse.json({ success: false, message: "Not found." }, { status: 404 });
  }

  const fileStat = await stat(apk.absolutePath);
  const nodeStream = createReadStream(apk.absolutePath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Disposition": `attachment; filename="${apk.attachmentName}"`,
      "Content-Length": String(fileStat.size),
      "Cache-Control": "private, no-store",
    },
  });
}
