import { getStsApiBaseUrls, getStsSiteRootUrl } from "@/shared/api/stsLogin";
import { getStsDomainUrl } from "@/shared/config/stsUrls";

function hostnameFromBase(base: string): string | null {
  const trimmed = base.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).hostname;
  } catch {
    return null;
  }
}

/** Harvest attachment URLs we allow the export proxy / server fetch to retrieve. */
export function isAllowedProjectExportHarvestImageUrl(raw: string): boolean {
  const url = raw.trim();
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (!/^https?:$/i.test(parsed.protocol)) return false;
    const allowed = new Set<string>();
    for (const host of [
      hostnameFromBase(getStsDomainUrl()),
      hostnameFromBase(getStsSiteRootUrl()),
      ...getStsApiBaseUrls().map(hostnameFromBase),
    ]) {
      if (host) allowed.add(host);
    }
    return allowed.has(parsed.hostname);
  } catch {
    return false;
  }
}

export function isPublicHttpsImageUrl(raw: string): boolean {
  const url = raw.trim();
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname;
    if (host === "localhost" || host === "127.0.0.1") return false;
    if (/^192\.168\./.test(host)) return false;
    if (/^10\./.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

export async function fetchProjectExportHarvestImageBuffer(
  sourceUrl: string,
  authorization?: string | null,
): Promise<{ buffer: ArrayBuffer; contentType: string } | null> {
  if (!isAllowedProjectExportHarvestImageUrl(sourceUrl)) return null;
  const headers: Record<string, string> = {};
  if (authorization?.startsWith("Bearer ")) {
    headers.Authorization = authorization;
  }
  const res = await fetch(sourceUrl, {
    headers,
    cache: "no-store",
  });
  if (!res.ok) return null;
  const buffer = await res.arrayBuffer();
  if (!buffer.byteLength) return null;
  const contentType =
    res.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  return { buffer, contentType };
}

export function mimeTypeToDriveExtension(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("gif")) return "gif";
  if (m.includes("webp")) return "webp";
  return "jpg";
}

/** Upload image to user's Drive (app-created file) and return a public view URL for Sheets. */
export async function uploadExportImageToGoogleDrive(opts: {
  accessToken: string;
  buffer: ArrayBuffer;
  contentType: string;
  fileName: string;
}): Promise<string | null> {
  const boundary = `sts_export_${Date.now()}`;
  const metadata = JSON.stringify({
    name: opts.fileName,
    mimeType: opts.contentType,
  });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${opts.contentType}\r\n\r\n`,
    ),
    Buffer.from(new Uint8Array(opts.buffer)),
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const uploadRes = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
      cache: "no-store",
    },
  );
  const uploaded = (await uploadRes.json().catch(() => ({}))) as { id?: string };
  const fileId = String(uploaded.id ?? "").trim();
  if (!uploadRes.ok || !fileId) return null;

  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
    cache: "no-store",
  });

  return `https://drive.google.com/uc?export=view&id=${fileId}`;
}
