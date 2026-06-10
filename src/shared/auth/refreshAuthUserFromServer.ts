import { stripUserAcl } from "@/shared/auth/stripUserAcl";
import { fetchSessionStatus, type SessionUser } from "@/shared/lib/sessionUser";
import { useAuthUserStore } from "@/shared/store/authUserStore";

/** Profile fields kept from client when session payload omits them. */
const PRESERVE_IF_MISSING_KEYS = [
  "avatar",
  "profile_image",
  "profileImage",
  "country",
  "country_id",
  "user_country_id",
  "farm_user_id",
  "farmUserId",
  "company_name",
  "phone",
  "job_title",
  "address",
  "gender",
  "note",
  "alternative_phone",
  "dob",
] as const;

export type RefreshAuthUserResult = {
  ok: boolean;
  user: SessionUser | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function buildUserFromServer(
  current: SessionUser | null,
  serverUser: SessionUser,
): SessionUser {
  const profileBase = stripUserAcl(current) ?? {};
  const nextUser: SessionUser = { ...profileBase };

  for (const [key, value] of Object.entries(serverUser)) {
    if (key === "permissions" || key === "is_admin" || key === "role_id" || key === "role_title") {
      continue;
    }
    nextUser[key] = value;
  }

  if ("permissions" in serverUser && isRecord(serverUser.permissions)) {
    nextUser.permissions = { ...serverUser.permissions };
  } else {
    nextUser.permissions = {};
  }
  if ("is_admin" in serverUser) nextUser.is_admin = serverUser.is_admin;
  if ("role_id" in serverUser) nextUser.role_id = serverUser.role_id;
  if ("role_title" in serverUser) nextUser.role_title = serverUser.role_title;

  for (const key of PRESERVE_IF_MISSING_KEYS) {
    if (!(key in serverUser) && current && key in current) {
      nextUser[key] = current[key];
    }
  }

  return nextUser;
}

/**
 * Gọi server lấy lại user + role + permissions mới nhất và lưu vào Zustand store.
 * Thay thế hoàn toàn ACL — không merge permissions cũ từ login/localStorage.
 */
export async function refreshAuthUserFromServer(): Promise<RefreshAuthUserResult> {
  if (typeof window === "undefined") {
    return { ok: false, user: null };
  }

  const { setAclReady } = useAuthUserStore.getState();
  setAclReady(false);

  const session = await fetchSessionStatus();
  if (!session.authenticated || !session.user) {
    return { ok: false, user: useAuthUserStore.getState().user };
  }

  const serverUser = session.user;
  if (!isRecord(serverUser) || !("permissions" in serverUser)) {
    return { ok: false, user: useAuthUserStore.getState().user };
  }

  const current = useAuthUserStore.getState().user;
  const nextUser = buildUserFromServer(current, serverUser);

  useAuthUserStore.getState().setUser(nextUser);
  setAclReady(true);
  return { ok: true, user: nextUser };
}
