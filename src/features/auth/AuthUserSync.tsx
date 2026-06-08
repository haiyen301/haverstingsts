"use client";

import { useEffect } from "react";

import {
  syncSessionUserFromServer,
  useAuthUserStore,
} from "@/shared/store/authUserStore";

/**
 * On each page load, re-fetch role/permissions from the server so UI matches DB
 * without requiring logout/login after an admin updates roles.
 */
export function AuthUserSync() {
  useEffect(() => {
    const run = () => {
      void syncSessionUserFromServer();
    };

    const store = useAuthUserStore;
    if (store.persist.hasHydrated()) {
      run();
      return;
    }

    return store.persist.onFinishHydration(run);
  }, []);

  return null;
}
