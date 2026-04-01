import { create } from "zustand";
import {
  persist,
  createJSONStorage,
  type StateStorage,
} from "zustand/middleware";

import {
  STORAGE_TOKEN_KEY,
  STORAGE_USER_KEY,
  type SessionUser,
} from "@/shared/lib/sessionUser";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";

const PERSIST_NAME = "sts-auth-user";

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
  setUser: (user: SessionUser | null) => void;
};

/** Runs after persist rehydration (client). Do not use `store.persist.onFinishHydration` at module scope — `persist` can be undefined during SSR / edge cases. */
function migrateLegacyUserFromStsUserKey() {
  if (typeof window === "undefined") return;
  const { user, setUser } = useAuthUserStore.getState();
  if (user) return;
  const raw = window.localStorage.getItem(STORAGE_USER_KEY);
  if (!raw) return;
  try {
    setUser(JSON.parse(raw) as SessionUser);
    window.localStorage.removeItem(STORAGE_USER_KEY);
  } catch {
    /* ignore */
  }
}

export const useAuthUserStore = create<AuthUserState>()(
  persist(
    (set) => ({
      user: null,
      setUser: (user) => set({ user }),
    }),
    {
      name: PERSIST_NAME,
      storage: createJSONStorage(getAuthPersistStorage),
      partialize: (state) => ({ user: state.user }),
      onRehydrateStorage: () => (_state, error) => {
        if (error) return;
        migrateLegacyUserFromStsUserKey();
      },
    },
  ),
);

/** Clears JWT, legacy user key, persisted Zustand slice, and in-memory user. */
export function clearAuthSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_TOKEN_KEY);
  window.localStorage.removeItem(STORAGE_USER_KEY);
  useAuthUserStore.getState().setUser(null);
  useHarvestingDataStore.getState().reset();
}

/** Snapshot for non-React code (e.g. guards). Prefer `useAuthUserStore` in UI. */
export function getSessionUser(): SessionUser | null {
  return useAuthUserStore.getState().user;
}
