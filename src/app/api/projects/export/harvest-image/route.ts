import { NextResponse } from "next/server";

import {
  fetchProjectExportHarvestImageBuffer,
  isAllowedProjectExportHarvestImageUrl,
} from "@/shared/server/projectListExportHarvestImage";
import { resolveStsBearerFromRequest } from "@/shared/server/stsAuthBearer";

export async function GET(req: Request) {
  const auth = await resolveStsBearerFromRequest(req);
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ message: "Authorization required." }, { status: 401 });
  }

  const src = new URL(req.url).searchParams.get("src")?.trim() ?? "";
  if (!src || !isAllowedProjectExportHarvestImageUrl(src)) {
    return NextResponse.json({ message: "Invalid image URL." }, { status: 400 });
  }

  const fetched = await fetchProjectExportHarvestImageBuffer(src, auth);
  if (!fetched) {
    return NextResponse.json({ message: "Image not found." }, { status: 404 });
  }

  return new NextResponse(fetched.buffer, {
    status: 200,
    headers: {
      "Content-Type": fetched.contentType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
