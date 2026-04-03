import { getStsApiBaseUrl, INTERNAL_API } from "@/shared/api/stsLogin";

/** Legacy key — JWT now lives in HttpOnly session cookie only. */
export const STORAGE_TOKEN_KEY = "sts_token";
export const STORAGE_USER_KEY = "sts_user";

/** Remove any JWT left in client storage by older builds. */
export function removeAuthToken(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_TOKEN_KEY);
    window.sessionStorage.removeItem(STORAGE_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/** Whether the HttpOnly session cookie is present (server-side JWT). */
export async function fetchSessionAuthenticated(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const res = await fetch(INTERNAL_API.authentication.session, {
      credentials: "same-origin",
    });
    if (!res.ok) return false;
    const j = (await res.json()) as { authenticated?: boolean };
    return j.authenticated === true;
  } catch {
    return false;
  }
}

/** Clears the HttpOnly JWT cookie (call on logout). */
export async function clearHttpAuthCookie(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await fetch(INTERNAL_API.authentication.logout, {
      method: "POST",
      credentials: "same-origin",
    });
  } catch {
    /* offline */
  }
}

/** Zustand persist key for `useAuthUserStore`. */
export const AUTH_USER_PERSIST_STORAGE_KEY = "sts-auth-user";

function clearLegacyClientStoredJwt() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_TOKEN_KEY);
    window.sessionStorage.removeItem(STORAGE_TOKEN_KEY);
  } catch {
    /* private mode */
  }
}

clearLegacyClientStoredJwt();

export type SessionUser = {
  id?: number;
  first_name?: string;
  last_name?: string;
  email?: string;
  avatar?: string;
  profile_image?: string;
  profileImage?: string;
  job_title?: string;
  phone?: string;
  role_title?: string;
  company_name?: string;
  [key: string]: unknown;
};

const PROFILE_IMAGES_PREFIX = "files/profile_images/";

function normalizeAvatarPath(input: string): string {
  const raw = input.trim();
  if (!raw) return raw;
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;

  const noLeadingSlash = raw.replace(/^\/+/, "");
  if (
    noLeadingSlash.startsWith("files/") ||
    noLeadingSlash.startsWith("uploads/") ||
    noLeadingSlash.startsWith("storage/")
  ) {
    return noLeadingSlash;
  }

  return `${PROFILE_IMAGES_PREFIX}${noLeadingSlash}`;
}

/** Avatar from API may be a filename or path relative to STSPortal origin. */
export function resolveAvatarUrl(
  avatar: string | undefined | null,
): string | undefined {
  const raw = avatar?.trim();
  if (!raw) return undefined;
  const a = normalizeAvatarPath(raw);
  if (!a) return undefined;
  if (a.startsWith("http://") || a.startsWith("https://")) return a;
  const base = getStsApiBaseUrl().replace(/\/$/, "");
  if (!base) return undefined;
  return `${base}${a.startsWith("/") ? "" : "/"}${a}`;
}

export function getUserAvatarPath(user: SessionUser | null): string | undefined {
  if (!user) return undefined;
  const avatar =
    (typeof user.avatar === "string" && user.avatar) ||
    (typeof user.profile_image === "string" && user.profile_image) ||
    (typeof user.profileImage === "string" && user.profileImage) ||
    undefined;
  return avatar?.trim() || undefined;
}

export function getUserDisplayName(user: SessionUser | null): string {
  if (!user) return "User";
  const first = user.first_name?.trim() ?? "";
  const last = user.last_name?.trim() ?? "";
  const full = `${first} ${last}`.trim();
  if (full) return full;
  return user.email?.trim() || "User";
}

export function getUserInitials(user: SessionUser | null): string {
  if (!user) return "?";
  const first = user.first_name?.trim()?.[0] ?? "";
  const last = user.last_name?.trim()?.[0] ?? "";
  if (first && last) return `${first}${last}`.toUpperCase();
  const email = user.email?.trim();
  if (email) return email.slice(0, 2).toUpperCase();
  return "?";
}
