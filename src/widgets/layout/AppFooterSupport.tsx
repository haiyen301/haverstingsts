"use client";

import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  getIosTestFlightUrlForHost,
  shouldOfferAndroidApkForHost,
} from "@/shared/config/deploymentEnvironment";
import { AppStoreBadgeButton } from "@/widgets/layout/AppStoreBadgeButton";

type AppFooterSupportProps = {
  variant?: "desktop" | "mobile";
  className?: string;
};

export function AppFooterSupport({ variant = "desktop", className }: AppFooterSupportProps) {
  const [iosTestFlightUrl, setIosTestFlightUrl] = useState("");
  const [androidApkUrl, setAndroidApkUrl] = useState<string | null>(null);
  const isMobile = variant === "mobile";

  useEffect(() => {
    const host = window.location.hostname;
    setIosTestFlightUrl(getIosTestFlightUrlForHost(host));

    if (!shouldOfferAndroidApkForHost(host)) return;

    void fetch("/api/mobile-app/android-apk")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { data?: { url?: string | null } } | null) => {
        const url = body?.data?.url?.trim();
        setAndroidApkUrl(url || null);
      })
      .catch(() => setAndroidApkUrl(null));
  }, []);

  const supportLinkClass = isMobile
    ? "transition-colors text-sidebar-foreground/80 hover:text-sidebar-foreground"
    : "transition-colors hover:text-[rgb(31,122,76)]";

  const appLinks = (
    <div className="flex flex-wrap items-center gap-2">
      {androidApkUrl ? (
        <AppStoreBadgeButton href={androidApkUrl} store="google-play" />
      ) : null}
      {iosTestFlightUrl ? (
        <AppStoreBadgeButton href={iosTestFlightUrl} store="app-store" external />
      ) : null}
    </div>
  );

  return (
    <div
      className={cn(
        isMobile
          ? "space-y-3 text-xs text-sidebar-foreground/70"
          : "flex flex-wrap items-center justify-between gap-x-4 gap-y-3 text-xs text-muted-foreground",
        className,
      )}
    >
      <div
        className={cn(
          "flex flex-wrap gap-x-3 gap-y-2",
          isMobile ? "flex-col items-start" : "items-center text-center sm:text-left",
        )}
      >
        <span
          className={cn(
            "font-medium",
            isMobile ? "text-sidebar-foreground" : "text-foreground",
          )}
        >
          Support: Ms. Yen
        </span>
        <a href="mailto:yen@sportsturfsolutions.com" className={supportLinkClass}>
          yen@sportsturfsolutions.com
        </a>
        <a
          href="https://wa.me/84983115600"
          target="_blank"
          rel="noreferrer"
          className={cn("inline-flex items-center gap-1.5", supportLinkClass)}
          aria-label="WhatsApp support"
        >
          <MessageCircle className="h-3.5 w-3.5" aria-hidden />
          <span>WhatsApp</span>
        </a>
      </div>

      {iosTestFlightUrl || androidApkUrl ? appLinks : null}
    </div>
  );
}
