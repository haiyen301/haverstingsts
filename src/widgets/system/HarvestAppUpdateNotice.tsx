"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";

import {
  fetchHarvestAppUpdateStatus,
  saveHarvestAppUpdateChoice,
  type HarvestAppUpdateStatus,
} from "@/features/alerts/harvestAppUpdateApi";
import {
  getAndroidApkDeployTierFromEnv,
  getAndroidApkDownloadUrl,
  getIosTestFlightUrlForHost,
  shouldOfferAndroidApkForHost,
} from "@/shared/config/deploymentEnvironment";
import { useAuthUserStore } from "@/shared/store/authUserStore";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";
import { AppStoreBadgeButton } from "@/widgets/layout/AppStoreBadgeButton";

const TOAST_ID = "harvest-app-update";
const LOGIN_EPOCH_KEY = "stsrenew-login-epoch";
const LATER_LOGIN_KEY = "stsrenew-harvest-app-update-later-login";
const LATER_WINDOW_MS =  60 * 1000;

export function startNewLoginEpoch(): void {
  try {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(LOGIN_EPOCH_KEY, id);
  } catch {
    // Private mode can block storage. The notice then shows on the next visit.
  }
}

type HarvestAppUpdateToastProps = {
  message: string;
  confirmLabel: string;
  laterLabel: string;
  androidHref: string;
  iosHref: string;
  showAndroid: boolean;
  onConfirm: () => void;
  onLater: () => void;
};

function HarvestAppUpdateToast({
  message,
  confirmLabel,
  laterLabel,
  androidHref,
  iosHref,
  showAndroid,
  onConfirm,
  onLater,
}: HarvestAppUpdateToastProps) {
  const androidApkTier = getAndroidApkDeployTierFromEnv();
  const showLinks = Boolean(iosHref) || (showAndroid && Boolean(androidHref));

  return (
    <div className="flex flex-col gap-3 pr-1">
      <p className="text-sm leading-snug">{message}</p>
      {showLinks ? (
        <div className="flex flex-nowrap items-center gap-2">
          {showAndroid && androidHref ? (
            <AppStoreBadgeButton
              href={androidHref}
              store="google-play"
              androidApkTier={androidApkTier}
              external
            />
          ) : null}
          {iosHref ? (
            <AppStoreBadgeButton href={iosHref} store="app-store" external />
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-nowrap items-center gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className="min-w-0 flex-1 rounded-lg bg-button-primary px-2 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#196A40]"
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={onLater}
          className="min-w-0 flex-1 rounded-lg border border-white/30 px-2 py-2.5 text-sm font-medium text-current transition-colors hover:bg-white/10"
        >
          {laterLabel}
        </button>
      </div>
    </div>
  );
}

function readStorage(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeStorage(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Private mode can block storage.
  }
}

function removeStorage(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
}

function ensureLoginEpoch(): string {
  const existing = readStorage(LOGIN_EPOCH_KEY);
  if (existing) return existing;
  startNewLoginEpoch();
  return readStorage(LOGIN_EPOCH_KEY);
}

function hoursSinceLater(laterAt: string | null): number | null {
  if (!laterAt) return null;
  const laterMs = Date.parse(laterAt);
  if (!Number.isFinite(laterMs)) return null;
  return Date.now() - laterMs;
}

/** Hide only inside the same login, and only until 8 hours after the click. */
function laterStillHidesToast(laterAt: string | null): boolean {
  const elapsed = hoursSinceLater(laterAt);
  if (elapsed == null || elapsed >= LATER_WINDOW_MS) return false;
  const epoch = readStorage(LOGIN_EPOCH_KEY);
  const boundEpoch = readStorage(LATER_LOGIN_KEY);
  return epoch !== "" && epoch === boundEpoch;
}

export function HarvestAppUpdateNotice() {
  const t = useTranslations("HarvestAppUpdate");
  const user = useAuthUserStore((state) => state.user);
  const aclReady = useAuthUserStore((state) => state.aclReady);
  const sessionConfirmed = aclReady && user != null;
  const [iosHref, setIosHref] = useState("");
  const [showAndroid, setShowAndroid] = useState(false);
  const [ready, setReady] = useState(false);
  const hadUser = useRef(false);
  const reopenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const androidHref = getAndroidApkDownloadUrl();

  useEffect(() => {
    const host = window.location.hostname;
    setIosHref(getIosTestFlightUrlForHost(host));
    setShowAndroid(shouldOfferAndroidApkForHost(host));
    setReady(true);
  }, []);

  useEffect(() => {
    if (user) {
      hadUser.current = true;
      return;
    }
    if (!hadUser.current) return;
    hadUser.current = false;
    removeStorage(LATER_LOGIN_KEY);
    if (toast.isActive(TOAST_ID)) toast.dismiss(TOAST_ID);
  }, [user]);

  useEffect(() => {
    if (!sessionConfirmed || !ready) return;
    let cancelled = false;

    const clearReopenTimer = () => {
      if (reopenTimer.current) {
        clearTimeout(reopenTimer.current);
        reopenTimer.current = null;
      }
    };

    const showToast = () => {
      if (cancelled || toast.isActive(TOAST_ID)) return;

      const confirm = () => {
        void saveHarvestAppUpdateChoice("confirm")
          .then(() => {
            removeStorage(LATER_LOGIN_KEY);
            toast.dismiss(TOAST_ID);
          })
          .catch(() => {
            // Keep the toast open when the server did not store the confirmation.
          });
      };

      const later = () => {
        void saveHarvestAppUpdateChoice("later")
          .then((status) => {
            const elapsed = hoursSinceLater(status.laterAt);
            if (status.laterAt && elapsed != null && elapsed < LATER_WINDOW_MS) {
              writeStorage(LATER_LOGIN_KEY, ensureLoginEpoch());
            }
            toast.dismiss(TOAST_ID);
            armReopen(status);
          })
          .catch(() => {
            // Keep the toast open when the postpone was not stored.
          });
      };

      toast.info(
        <HarvestAppUpdateToast
          message={t("message")}
          confirmLabel={t("confirm")}
          laterLabel={t("later")}
          androidHref={androidHref}
          iosHref={iosHref}
          showAndroid={showAndroid}
          onConfirm={confirm}
          onLater={later}
        />,
        {
          containerId: TOAST_CONTAINER_TOP_RIGHT,
          className: "!w-full !max-w-none !rounded-lg !text-sm !shadow-lg",
          toastId: TOAST_ID,
          autoClose: false,
          closeOnClick: false,
          closeButton: false,
          draggable: false,
          hideProgressBar: true,
          icon: false,
        },
      );
    };

    const armReopen = (status: HarvestAppUpdateStatus) => {
      clearReopenTimer();
      if (!status.laterAt || !laterStillHidesToast(status.laterAt)) return;
      const laterMs = Date.parse(status.laterAt);
      const wait = laterMs + LATER_WINDOW_MS - Date.now();
      if (wait <= 0) {
        removeStorage(LATER_LOGIN_KEY);
        showToast();
        return;
      }
      reopenTimer.current = setTimeout(() => {
        removeStorage(LATER_LOGIN_KEY);
        showToast();
      }, wait);
    };

    void fetchHarvestAppUpdateStatus()
      .then((status) => {
        if (cancelled || status.confirmed) return;
        ensureLoginEpoch();
        if (laterStillHidesToast(status.laterAt)) {
          armReopen(status);
          return;
        }
        showToast();
      })
      .catch(() => {
        // Leave the notice hidden when the setting cannot be read.
      });

    return () => {
      cancelled = true;
      clearReopenTimer();
    };
  }, [androidHref, iosHref, ready, sessionConfirmed, showAndroid, t]);

  return null;
}
