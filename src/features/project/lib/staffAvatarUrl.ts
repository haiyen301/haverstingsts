import { getStsDomainUrl, STS_PUBLIC_PATHS } from "@/shared/config/stsUrls";

export function buildProfileAvatarUrl(fileNameOrPath: string): string {
  const value = String(fileNameOrPath ?? "").trim();
  if (!value) return "";
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  if (value.startsWith("//")) return `https:${value}`;
  const root = getStsDomainUrl().replace(/\/$/, "");
  if (!root) return value;
  if (value.startsWith("/")) {
    if (value.startsWith("/files/")) return `${root}${value}`;
    return `${root}${STS_PUBLIC_PATHS.profileImages}/${value.replace(/^\/+/, "")}`;
  }
  if (value.includes("/")) {
    if (value.startsWith("files/")) return `${root}/${value}`;
    if (value.startsWith("profile_images/")) {
      return `${root}/${STS_PUBLIC_PATHS.files}/${value}`;
    }
    return `${root}/${value}`;
  }
  return `${root}${STS_PUBLIC_PATHS.profileImages}/${value}`;
}

/**
 * Mirrors Flutter / legacy PHP: staff `image` may be URL, path, JSON snippet, or serialized PHP.
 * Returns absolute URL or "".
 */
export function resolveStaffAvatarImageUrl(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  if (
    text.startsWith("http://") ||
    text.startsWith("https://") ||
    text.startsWith("//")
  ) {
    return buildProfileAvatarUrl(text);
  }
  const phpFileName =
    text.match(/["']?file_name["']?\s*[:=]\s*["']([^"']+)["']/i)?.[1] ??
    text.match(/s:\d+:"file_name";s:\d+:"([^"]+)"/i)?.[1];
  if (phpFileName) return buildProfileAvatarUrl(phpFileName);
  if (text.includes("profile_images")) return buildProfileAvatarUrl(text);
  return "";
}

/** True when we should still try staff store / richer parsing (not a real photo URL). */
export function isPlaceholderAssigneeAvatarUrl(url: string): boolean {
  const u = String(url ?? "").trim();
  if (!u) return true;
  if (u.includes("i.pravatar.cc") || u.includes("placehold.co")) return true;
  if (u.startsWith("data:image/svg+xml,")) return true;
  return false;
}
