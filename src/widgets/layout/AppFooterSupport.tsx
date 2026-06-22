"use client";

import { useEffect, useState } from "react";
import { MessageCircle, Smartphone } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  getIosTestFlightUrlForHost,
  shouldOfferAndroidApkForHost,
} from "@/shared/config/deploymentEnvironment";
import { AndroidAppIcon } from "@/widgets/layout/AndroidAppIcon";

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
    if (shouldOfferAndroidApkForHost(host)) {
      void fetch("/api/mobile-app/android-apk")
        .then((res) => (res.ok ? res.json() : null))
        .then((body: { data?: { url?: string | null } } | null) => {
          const url = body?.data?.url?.trim();
          setAndroidApkUrl(url || null);
        })
        .catch(() => setAndroidApkUrl(null));
    }
  }, []);

  const supportLinkClass = isMobile
    ? "transition-colors text-sidebar-foreground/80 hover:text-sidebar-foreground"
    : "transition-colors hover:text-[rgb(31,122,76)]";

  const appLinks = (
    <>
      {androidApkUrl ? (
        <a
          href={androidApkUrl}
          className="inline-flex items-center gap-2 text-base font-semibold text-[#3DDC84] transition-opacity hover:opacity-80"
          aria-label="Download Android app"
        >
          <AndroidAppIcon />
          <span>Android App</span>
        </a>
      ) : null}
      {iosTestFlightUrl ? (
        <a
          href={iosTestFlightUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 text-base font-semibold text-[#007AFF] transition-opacity hover:opacity-80"
          aria-label="Download iOS app on TestFlight"
        >
          <Smartphone className="h-4 w-4 shrink-0" aria-hidden />
          <span>iOS App</span>
        </a>
      ) : null}
    </>
  );

  return (
    <div
      className={cn(
        isMobile
          ? "space-y-3 text-xs text-sidebar-foreground/70"
          : "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground",
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

      {iosTestFlightUrl || androidApkUrl ? (
        <div
          className={cn(
            "flex flex-wrap gap-x-4 gap-y-2",
            isMobile ? "items-start" : "items-center justify-end",
          )}
        >
          {appLinks}
        </div>
      ) : null}
    </div>
  );
}
