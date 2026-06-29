import Image from "next/image";

import { cn } from "@/lib/utils";
import type { AndroidApkDeployTier } from "@/shared/config/deploymentEnvironment";

type AppStoreBadgeButtonProps = {
  href: string;
  store: "google-play" | "app-store";
  className?: string;
  external?: boolean;
  /** APK tier — adjusts Android badge copy (production vs staging/dev). */
  androidApkTier?: AndroidApkDeployTier;
};

const storeConfig = {
  "google-play": {
    icon: "/assets/images/google-play.svg",
    iconAlt: "Google Play",
    eyebrow: "GET IT ON",
    title: "Google Play",
  },
  "app-store": {
    icon: "/assets/images/apple-store.svg",
    iconAlt: "App Store",
    eyebrow: "Download on",
    title: "App Store",
  },
} as const;

function getGooglePlayBadgeCopy(tier?: AndroidApkDeployTier) {
  if (tier === "production") {
    return { eyebrow: "GET IT ON", title: "Google Play" };
  }
  return { eyebrow: "Download", title: "Android APK" };
}

export function AppStoreBadgeButton({
  href,
  store,
  className,
  external = false,
  androidApkTier,
}: AppStoreBadgeButtonProps) {
  const config = storeConfig[store];
  const androidCopy =
    store === "google-play" ? getGooglePlayBadgeCopy(androidApkTier) : null;
  const eyebrow = androidCopy?.eyebrow ?? config.eyebrow;
  const title = androidCopy?.title ?? config.title;

  const content = (
    <>
      <Image
        src={config.icon}
        alt={config.iconAlt}
        width={20}
        height={20}
        className={cn(
          "shrink-0 object-cover",
          store === "app-store" ? "brightness-0 invert" : undefined,
        )}
      />
      <span className="flex min-w-0 flex-col items-start leading-none">
        <span className="text-[10px] font-normal uppercase tracking-wide text-white/90">
          {eyebrow}
        </span>
        <span className="mt-0.5 text-sm font-semibold text-white">{title}</span>
      </span>
    </>
  );

  const buttonClass = cn(
    "inline-flex h-10 items-center gap-2 rounded-lg bg-black px-3 py-2 shadow-sm transition-opacity hover:opacity-90",
    className,
  );

  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className={buttonClass}
      aria-label={`${eyebrow} ${title}`}
    >
      {content}
    </a>
  );
}
