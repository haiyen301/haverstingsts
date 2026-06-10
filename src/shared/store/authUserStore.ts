import { create } from "zustand";
import {
  persist,
  createJSONStorage,
  type StateStorage,
} from "zustand/middleware";

import { stripUserAcl } from "@/shared/auth/stripUserAcl";
import {
  AUTH_USER_PERSIST_STORAGE_KEY,
  clearHttpAuthCookie,
  removeAuthToken,
  STORAGE_USER_KEY,
  type SessionUser,
} from "@/shared/lib/sessionUser";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";

/** SSR / Node: `localStorage` is missing; persist must still get a real storage or `api.persist` is never set. */
const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

function getAuthPersistStorage(): StateStorage {
  if (typeof window === "undefined") return noopStorage;
  try {
    return window.localStorage;
  } catch {
    return noopStorage;
  }
}

type AuthUserState = {
  user: SessionUser | null;
  /** false until `refreshAuthUserFromServer` succeeds — UI must not trust permissions before this. */
  aclReady: boolean;
  setUser: (user: SessionUser | null) => void;
  setAclReady: (ready: boolean) => void;
};

/** ACL is refreshed from server — do not persist stale role/permissions in localStorage. */
function userProfileForPersist(user: SessionUser | null): SessionUser | null {
  return stripUserAcl(user);
}

/** Runs after persist rehydration (client). Do not use `store.persist.onFinishHydration` at module scope — `persist` can be undefined during SSR / edge cases. */
function migrateLegacyUserFromStsUserKey() {
  if (typeof window === "undefined") return;
  const { user, setUser } = useAuthUserStore.getState();
  if (user) return;
  const raw = window.localStorage.getItem(STORAGE_USER_KEY);
  if (!raw) return;
  try {
    setUser(userProfileForPersist(JSON.parse(raw) as SessionUser));
    window.localStorage.removeItem(STORAGE_USER_KEY);
  } catch {
    /* ignore */
  }
}

export const useAuthUserStore = create<AuthUserState>()(
  persist(
    (set) => ({
      user: null,
      aclReady: false,
      setUser: (user) => set({ user }),
      setAclReady: (aclReady) => set({ aclReady }),
    }),
    {
      name: AUTH_USER_PERSIST_STORAGE_KEY,
      storage: createJSONStorage(getAuthPersistStorage),
      partialize: (state) => ({ user: userProfileForPersist(state.user) }),
      merge: (persisted, current) => {
        const p = persisted as Partial<AuthUserState> | undefined;
        return {
          ...current,
          user: userProfileForPersist(p?.user ?? null),
          aclReady: false,
        };
      },
      onRehydrateStorage: () => (_state, error) => {
        if (error) return;
        const { setAclReady, setUser, user } = useAuthUserStore.getState();
        setAclReady(false);
        if (user) {
          setUser(stripUserAcl(user));
        }
        migrateLegacyUserFromStsUserKey();
      },
    },
  ),
);

/** Clears HttpOnly cookie, legacy keys, persisted Zustand slice, and in-memory user. */
export async function clearAuthSession(): Promise<void> {
  if (typeof window === "undefined") return;
  removeAuthToken();
  await clearHttpAuthCookie();
  try {
    window.localStorage.removeItem(STORAGE_USER_KEY);
    window.localStorage.removeItem(AUTH_USER_PERSIST_STORAGE_KEY);
    window.sessionStorage.removeItem(STORAGE_USER_KEY);
    window.sessionStorage.removeItem(AUTH_USER_PERSIST_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  useAuthUserStore.getState().setAclReady(false);
  useAuthUserStore.getState().setUser(null);
  useHarvestingDataStore.getState().reset();
}

/** Snapshot for non-React code (e.g. guards). Prefer `useAuthUserStore` in UI. */
export function getSessionUser(): SessionUser | null {
  return useAuthUserStore.getState().user;
}

export function isAclReady(): boolean {
  return useAuthUserStore.getState().aclReady;
}

export {
  refreshAuthUserFromServer,
  type RefreshAuthUserResult,
} from "@/shared/auth/refreshAuthUserFromServer";

/** @deprecated Prefer `refreshAuthUserFromServer`. */
export async function syncSessionUserFromServer(): Promise<void> {
  const { refreshAuthUserFromServer } = await import(
    "@/shared/auth/refreshAuthUserFromServer"
  );
  await refreshAuthUserFromServer();
}
