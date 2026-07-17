/**
 * Public URLs — mirrors Flutter `stsapp/lib/core/utils/url_container.dart`.
 *
 * - `domainUrl` → `getStsDomainUrl()` (env `NEXT_PUBLIC_STS_DOMAIN_URL` or derived from API base).
 * - `attachmentUrl` = `domainUrl + '/files/timeline_files/'`
 * - `harvestingImgUrl` = `attachmentUrl + 'harvesting/'` → join basename `file_name` for previews.
 */

import { getStsSiteRootUrl } from "@/shared/api/stsLogin";

/**
 * Flutter `UrlContainer.domainUrl`: site root (no trailing slash), e.g.
 * `https://staging.sportsturfsolutions.com/stsportal`.
 *
 * Set `NEXT_PUBLIC_STS_DOMAIN_URL` when `NEXT_PUBLIC_STS_API_BASE_URL` is only `http://host`
 * but static files are under `http://host/stsportal/files/...`.
 */
export function getStsDomainUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_STS_DOMAIN_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  return getStsSiteRootUrl();
}

/** Path segments under `domainUrl` (same as Dart static segments, without domain). */
export const STS_PUBLIC_PATHS = {
  files: "/files",
  timelineFiles: "/files/timeline_files",
  /** `UrlContainer.harvestingImgUrl` without trailing slash */
  harvestingImages: "/files/timeline_files/harvesting",
  profileImages: "/files/profile_images",
  systemImages: "/files/system",
  reactHarvesting: "/files/timeline_files/react_harvesting",
  customerVisit: "/files/timeline_files/customer_visit",
  /** Fertilizer usage image uploads (month subfolders inside). */
  fertilizerUsageImages: "/files/timeline_files/fertilizer_usage",
  /** Flutter Android APK builds copied to STSPortal `assets/apk/` */
  apkAssets: "/assets/apk",
} as const;

const HARVESTING_URL_MARKER = "/files/timeline_files/harvesting/";
const MONTH_SUBFOLDER_RE = /^\d{1,2}\//;
const UPLOAD_TIMESTAMP_PREFIX_RE = /^(\d{10})_file/i;

function fileNameFromHarvestingUrl(url: string): string | null {
  const idx = url.indexOf(HARVESTING_URL_MARKER);
  if (idx < 0) return null;
  const tail = url.slice(idx + HARVESTING_URL_MARKER.length);
  return tail || null;
}

/**
 * Mirrors PHP `ensure_harvest_stored_file_name` and Flutter
 * `HarvestImageUrlResolver.ensureHarvestStoredFileName`.
 *
 * DB rows (e.g. harvest id 1883) may store only `1781850409_file....jpg` while
 * files live under `06/1781850409_file....jpg` on disk.
 */
export function ensureHarvestStoredFileName(fileName: string): string {
  const text = fileName.trim();
  if (!text) return "";

  if (/^https?:\/\//i.test(text)) {
    const fromUrl = fileNameFromHarvestingUrl(text);
    if (fromUrl) return ensureHarvestStoredFileName(fromUrl);
    return text;
  }

  const normalized = text.replace(/\\/g, "/");
  for (const prefix of [
    "/files/timeline_files/harvesting/",
    "files/timeline_files/harvesting/",
    "/timeline_files/harvesting/",
    "timeline_files/harvesting/",
    "harvesting/",
  ]) {
    if (normalized.startsWith(prefix)) {
      return ensureHarvestStoredFileName(normalized.slice(prefix.length));
    }
  }

  if (MONTH_SUBFOLDER_RE.test(normalized)) {
    return normalized;
  }

  const match = UPLOAD_TIMESTAMP_PREFIX_RE.exec(normalized);
  if (match) {
    const ts = Number.parseInt(match[1], 10);
    if (Number.isFinite(ts) && ts >= 946684800) {
      const month = String(new Date(ts * 1000).getMonth() + 1).padStart(2, "0");
      return `${month}/${normalized}`;
    }
  }

  return normalized;
}

/** Flutter `harvestingImgUrl` without trailing slash — use for basename-only `file_name`. */
export function getHarvestingImagePathSource(): string {
  const root = getStsDomainUrl();
  if (!root) return "";
  return `${root}${STS_PUBLIC_PATHS.harvestingImages}`;
}

/**
 * Build browser URL for a stored `file_name` or absolute URL — matches Flutter
 * `CustomImageAndFileField`: `pathSource + '/' + fileName` when not already absolute.
 */
export function resolveHarvestDisplayUrl(fileNameOrUrl: string): string {
  let s = fileNameOrUrl.trim();
  if (!s) return "";

  if (s.startsWith("//")) {
    if (typeof window !== "undefined" && window.location?.protocol) {
      s = `${window.location.protocol}${s}`;
    } else {
      s = `https:${s}`;
    }
  }

  if (s.startsWith("http://") || s.startsWith("https://")) {
    const fromUrl = fileNameFromHarvestingUrl(s);
    if (fromUrl) {
      return resolveHarvestDisplayUrl(ensureHarvestStoredFileName(fromUrl));
    }
    return s;
  }

  s = ensureHarvestStoredFileName(s);

  const domain = getStsDomainUrl();
  if (!domain) return s;
  const siteRoot = domain.replace(/\/$/, "");
  const harvestingBase = getHarvestingImagePathSource();

  if (s.startsWith("/")) {
    if (s.startsWith("/files/timeline_files/harvesting")) {
      return `${siteRoot}${s}`;
    }
    // DB/API sometimes stores `/timeline_files/harvesting/...` without leading `/files`
    if (s.startsWith("/timeline_files/")) {
      return `${siteRoot}/files${s}`;
    }
    if (s.startsWith("/harvesting/")) {
      return `${siteRoot}/files/timeline_files${s}`;
    }
    // Other `/files/...` (e.g. profile) — keep under site root
    if (s.startsWith("/files/")) {
      return `${siteRoot}${s}`;
    }
    // e.g. `/03/1774497229_xxx.jpg` — subfolder + file under harvesting (Flutter: pathSource + fileName)
    return harvestingBase ? `${harvestingBase}${s}` : `${siteRoot}${s}`;
  }

  // Basename only — Flutter: `harvestingImgUrl + fileName` → .../files/timeline_files/harvesting/name
  if (!s.includes("/")) {
    return harvestingBase ? `${harvestingBase}/${s}` : s;
  }

  if (s.startsWith("files/timeline_files/harvesting")) {
    return `${siteRoot}/${s}`;
  }

  if (s.startsWith("files/")) {
    return `${siteRoot}/${s}`;
  }

  // `timeline_files/harvesting/...` (no leading `files/`)
  if (s.startsWith("timeline_files/")) {
    return `${siteRoot}/files/${s}`;
  }

  if (s.startsWith("harvesting/")) {
    return `${siteRoot}/files/timeline_files/${s}`;
  }

  // e.g. `03/1774497229_xxx.jpg` — same as Flutter joining pathSource + relative path
  return harvestingBase ? `${harvestingBase}/${s}` : `${siteRoot}/${s}`;
}

/** Flutter `harvestingImgUrl` path segment: `/files/timeline_files/harvesting` */
export const HARVESTING_TIMELINE_PATH = STS_PUBLIC_PATHS.harvestingImages;

/**
 * Build browser URL for a fertilizer usage image `file_name`
 * (stored as `<month>/<timestamp>_file...jpg` under
 * `files/timeline_files/fertilizer_usage/`).
 */
export function resolveFertilizerUsageImageUrl(fileNameOrUrl: string): string {
  const s = fileNameOrUrl.trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;

  const domain = getStsDomainUrl();
  const relative = s.replace(/^\/+/, "");
  if (relative.startsWith("files/timeline_files/fertilizer_usage/")) {
    return domain ? `${domain}/${relative}` : `/${relative}`;
  }
  const base = `${domain}${STS_PUBLIC_PATHS.fertilizerUsageImages}`;
  return `${base}/${relative}`;
}
