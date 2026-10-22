"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";

import {
  getAndroidApkDeployTierFromEnv,
  getAndroidApkDownloadUrl,
  getIosTestFlightUrlForHost,
  shouldOfferAndroidApkForHost,
} from "@/shared/config/deploymentEnvironment";
import { useAuthUserStore } from "@/shared/store/authUserStore";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";
import { AppStoreBadgeButton } from "@/widgets/layout/AppStoreBadgeButton";

/** Bump this when a new Harvesting app build should ask everyone again. */
export const HARVEST_APP_UPDATE_VERSION = "2026-10-22";

const ACK_KEY = "stsrenew-harvest-app-update-ack";
const DISMISS_KEY = "stsrenew-harvest-app-update-dismissed";
const TOAST_ID = "harvest-app-update";

type HarvestAppUpdateToastProps = {
  message: string;
  confirmLabel: string;
  androidHref: string;
  iosHref: string;
  showAndroid: boolean;
  onConfirm: () => void;
};

function HarvestAppUpdateToast({
  message,
  confirmLabel,
  androidHref,
  iosHref,
  showAndroid,
  onConfirm,
}: HarvestAppUpdateToastProps) {
  const androidApkTier = getAndroidApkDeployTierFromEnv();
  const showLinks = Boolean(iosHref) || (showAndroid && Boolean(androidHref));

  return (
    <div className="flex flex-col gap-3 pr-1">
      <p className="text-sm leading-snug">{message}</p>
      {showLinks ? (
        <div className="flex flex-col items-start gap-2">
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
      <button
        type="button"
        onClick={onConfirm}
        className="w-full rounded-lg bg-button-primary py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#196A40]"
      >
        {confirmLabel}
      </button>
    </div>
  );
}

function hasAcknowledged(): boolean {
  try {
    return localStorage.getItem(ACK_KEY) === HARVEST_APP_UPDATE_VERSION;
  } catch {
    return false;
  }
}

function hasDismissedThisSession(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === HARVEST_APP_UPDATE_VERSION;
  } catch {
    return false;
  }
}

function rememberSessionDismiss(): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, HARVEST_APP_UPDATE_VERSION);
  } catch {
    // Private mode can block storage. The toast still closes for this view.
  }
}

function rememberAcknowledgement(): void {
  try {
    localStorage.setItem(ACK_KEY, HARVEST_APP_UPDATE_VERSION);
  } catch {
    // Fall back to the session flag so the notice stays closed in this tab.
  }
  rememberSessionDismiss();
}

export function HarvestAppUpdateNotice() {
  const t = useTranslations("HarvestAppUpdate");
  const user = useAuthUserStore((state) => state.user);
  const aclReady = useAuthUserStore((state) => state.aclReady);
  const sessionConfirmed = aclReady && user != null;
  const [iosHref, setIosHref] = useState("");
  const [showAndroid, setShowAndroid] = useState(false);
  const [ready, setReady] = useState(false);
  const hideWithoutSessionDismiss = useRef(false);
  const androidHref = getAndroidApkDownloadUrl();

  useEffect(() => {
    const host = window.location.hostname;
    setIosHref(getIosTestFlightUrlForHost(host));
    setShowAndroid(shouldOfferAndroidApkForHost(host));
    setReady(true);
  }, []);

  useEffect(() => {
    if (!user) {
      if (toast.isActive(TOAST_ID)) {
        hideWithoutSessionDismiss.current = true;
        toast.dismiss(TOAST_ID);
      }
      return;
    }
    if (!sessionConfirmed || !ready || hasAcknowledged() || hasDismissedThisSession()) return;
    if (toast.isActive(TOAST_ID)) return;

    const confirm = () => {
      rememberAcknowledgement();
      toast.dismiss(TOAST_ID);
    };

    toast.info(
      <HarvestAppUpdateToast
        message={t("message")}
        confirmLabel={t("confirm")}
        androidHref={androidHref}
        iosHref={iosHref}
        showAndroid={showAndroid}
        onConfirm={confirm}
      />,
      {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
        className: "!max-w-[calc(100vw-1.5rem)] !rounded-lg !text-sm !shadow-lg",
        toastId: TOAST_ID,
        autoClose: false,
        closeOnClick: false,
        draggable: false,
        hideProgressBar: true,
        icon: false,
        onClose: () => {
          if (hideWithoutSessionDismiss.current) {
            hideWithoutSessionDismiss.current = false;
            return;
          }
          rememberSessionDismiss();
        },
      },
    );
  }, [androidHref, iosHref, ready, sessionConfirmed, showAndroid, t, user]);

  return null;
}
