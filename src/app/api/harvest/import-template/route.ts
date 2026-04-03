import { NextResponse } from "next/server";

import { resolveStsBearerFromRequest } from "@/shared/server/stsAuthBearer";
import { getStsDomainUrl, STS_PUBLIC_PATHS } from "@/shared/config/stsUrls";

const TEMPLATE_FILE_NAME = "Phan Thiet Harvest Data Load.xlsx";

export async function GET(req: Request) {
  const auth = await resolveStsBearerFromRequest(req);
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json(
      { success: false, message: "Authorization required." },
      { status: 401 },
    );
  }

  const domain = getStsDomainUrl();
  if (!domain) {
    return NextResponse.json(
      { success: false, message: "Missing STS domain URL config." },
      { status: 500 },
    );
  }

  const upstreamUrl = `${domain}${STS_PUBLIC_PATHS.systemImages}/${encodeURIComponent(
    TEMPLATE_FILE_NAME,
  )}`;

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        Authorization: auth,
      },
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { success: false, message: msg, upstreamUrl },
      { status: 502 },
    );
  }

  if (!upstreamRes.ok) {
    const text = await upstreamRes.text().catch(() => "");
    return NextResponse.json(
      {
        success: false,
        message: `Upstream returned ${upstreamRes.status}.`,
        upstreamUrl,
        upstreamBodyPreview: text.slice(0, 4000),
      },
      { status: 502 },
    );
  }

  const ab = await upstreamRes.arrayBuffer();
  return new NextResponse(ab, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${TEMPLATE_FILE_NAME}"`,
      "Cache-Control": "no-store",
    },
  });
}

