"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import {
  getUserDisplayName,
  getUserInitials,
  getUserAvatarPath,
  resolveAvatarUrl,
} from "@/shared/lib/sessionUser";
import { clearAuthSession, useAuthUserStore } from "@/shared/store/authUserStore";
import { LOCALES, type AppLocale } from "@/i18n/config";

type SidebarProfileProps = {
  onNavigate?: () => void;
  compact?: boolean;
};

const LOCALE_FLAG_MAP: Record<AppLocale, { code: string; alt: string }> = {
  en: { code: "gb", alt: "English" },
  th: { code: "th", alt: "Thai" },
  vi: { code: "vn", alt: "Vietnamese" },
};

export function SidebarProfile({ onNavigate, compact = false }: SidebarProfileProps) {
  const router = useRouter();
  const user = useAuthUserStore((s) => s.user);
  const locale = useLocale() as AppLocale;
  const t = useTranslations("SidebarProfile");

  const displayName = getUserDisplayName(user);
  const email = user?.email?.trim() ?? "";
  const avatarSrc = resolveAvatarUrl(getUserAvatarPath(user));

  const goProfile = () => {
    router.push("/profile");
    onNavigate?.();
  };

  const logout = async () => {
    await clearAuthSession();
    onNavigate?.();
    router.replace("/");
  };

  const switchLocale = (nextLocale: AppLocale) => {
    if (nextLocale === locale) return;
    document.cookie = `NEXT_LOCALE=${nextLocale}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };

  return (
    <div className={`border-gray-200 bg-white shrink-0 ${compact ? "p-3" : "p-4"}`}>
      <div className="hidden mt-2 grid-cols-3 gap-1 pb-3">
        {LOCALES.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => switchLocale(item)}
            className={`group flex cursor-pointer items-center justify-center rounded-md px-2 py-1.5 text-xs font-medium transition-colors`}
            aria-pressed={item === locale}
            title={t(`languages.${item}`)}
          >
            <img
              src={`/flags/${LOCALE_FLAG_MAP[item].code}.svg`}
              alt={LOCALE_FLAG_MAP[item].alt}
              width={22}
              height={16}
              className={`h-4 w-[22px] rounded-sm object-cover transition duration-200 ${
                item === locale
                  ? "brightness-110"
                  : "grayscale group-hover:grayscale-0 group-hover:brightness-110"
              }`}
            />
          </button>
        ))}
      </div>


      <button
        type="button"
        onClick={goProfile}
        className={`w-full flex items-center rounded-lg p-2 transition-colors hover:bg-gray-100 ${
          compact ? "justify-center" : "gap-3 text-left -m-2"
        }`}
        title={compact ? displayName : undefined}
      >
        {avatarSrc ? (
          <img
            src={avatarSrc}
            alt={displayName}
            className="w-10 h-10 rounded-full object-cover border border-gray-200 shrink-0 bg-gray-100"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div
            className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-sm font-semibold text-white bg-button-primary border border-[#196A40]"
            aria-hidden
          >
            {getUserInitials(user)}
          </div>
        )}
        {!compact ? (
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-900 truncate">
              {displayName}
            </p>
            {email ? (
              <p className="text-xs text-gray-500 truncate">{email}</p>
            ) : (
              <p className="text-xs text-gray-400">{t("viewProfile")}</p>
            )}
          </div>
        ) : null}
      </button>

      <button
        type="button"
        onClick={logout}
        className={`mt-3 w-full flex items-center justify-center text-sm font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors ${
          compact ? "px-2 py-2" : "gap-2 px-3 py-2"
        }`}
        title={t("logOut")}
      >
        <LogOut className="w-4 h-4 shrink-0" />
        {!compact ? t("logOut") : null}
      </button>
    </div>
  );
}
