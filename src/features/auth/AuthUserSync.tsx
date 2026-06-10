"use client";

import { useEffect } from "react";

import { refreshAuthUserFromServer } from "@/shared/auth/refreshAuthUserFromServer";
import { useAuthUserStore } from "@/shared/store/authUserStore";

/**
 * Mount trong root layout — mỗi lần load/refresh trang gọi refreshAuthUserFromServer.
 */
export function AuthUserSync() {
  useEffect(() => {
    const runRefresh = () => {
      void refreshAuthUserFromServer().catch(() => {
        useAuthUserStore.getState().setAclReady(false);
      });
    };

    const store = useAuthUserStore;
    const persist = store.persist;

    if (!persist) {
      runRefresh();
      return;
    }

    const unsubHydration = persist.onFinishHydration(runRefresh);
    runRefresh();

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        runRefresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      unsubHydration();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
