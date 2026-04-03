"use client";

import { useRouter } from "next/navigation";
import { LogOut, Mail, Phone, Briefcase } from "lucide-react";

import RequireAuth from "@/features/auth/RequireAuth";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import {
  getUserDisplayName,
  getUserInitials,
  getUserAvatarPath,
  resolveAvatarUrl,
} from "@/shared/lib/sessionUser";
import { useAppTranslations } from "@/shared/i18n/useAppTranslations";
import { clearAuthSession, useAuthUserStore } from "@/shared/store/authUserStore";

function ProfileContent() {
  const t = useAppTranslations();
  const router = useRouter();
  const user = useAuthUserStore((s) => s.user);

  const displayName = getUserDisplayName(user);
  const avatarSrc = resolveAvatarUrl(getUserAvatarPath(user));

  const logout = async () => {
    await clearAuthSession();
    router.replace("/");
  };

  const row = (label: string, value: string | undefined) => (
    <div className="py-3 border-b border-gray-100 last:border-0">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
        {label}
      </p>
      <p className="text-sm text-gray-900 mt-0.5">{value?.trim() || "—"}</p>
    </div>
  );

  return (
    <DashboardLayout>
      <div className="p-6 lg:p-8 max-w-2xl">
        <h1 className="text-2xl font-semibold text-gray-900 mb-6">{t("Profile.title")}</h1>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="p-6 flex flex-col sm:flex-row sm:items-center gap-6 border-b border-gray-100 bg-gray-50/80">
            {avatarSrc ? (
              <img
                src={avatarSrc}
                alt={displayName}
                className="w-24 h-24 rounded-full object-cover border border-gray-200 bg-gray-100 shrink-0"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div
                className="w-24 h-24 rounded-full shrink-0 flex items-center justify-center text-2xl font-semibold text-white bg-button-primary border border-[#196A40]"
                aria-hidden
              >
                {getUserInitials(user)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-semibold text-gray-900 truncate">
                {displayName}
              </h2>
              {user?.job_title ? (
                <p className="text-sm text-gray-600 mt-1 flex items-center gap-2">
                  <Briefcase className="w-4 h-4 shrink-0" />
                  {String(user.job_title)}
                </p>
              ) : null}
              {user?.email ? (
                <p className="text-sm text-gray-600 mt-1 flex items-center gap-2">
                  <Mail className="w-4 h-4 shrink-0" />
                  {String(user.email)}
                </p>
              ) : null}
              {user?.phone ? (
                <p className="text-sm text-gray-600 mt-1 flex items-center gap-2">
                  <Phone className="w-4 h-4 shrink-0" />
                  {String(user.phone)}
                </p>
              ) : null}
            </div>
          </div>

          <div className="px-6 py-2">
            {row(t("Profile.email"), user?.email as string | undefined)}
            {row(t("Profile.phone"), user?.phone as string | undefined)}
            {row(t("Profile.jobTitle"), user?.job_title as string | undefined)}
            {row(t("Profile.role"), user?.role_title as string | undefined)}
            {row(t("Profile.company"), user?.company_name as string | undefined)}
            {row(t("Profile.country"), user?.country as string | undefined)}
          </div>

          <div className="p-6 border-t border-gray-100 bg-gray-50/50">
            <button
              type="button"
              onClick={logout}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-button-primary hover:bg-[#196A40] rounded-lg transition-colors"
            >
              <LogOut className="w-4 h-4" />
              {t("Profile.logOut")}
            </button>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

export default function ProfilePage() {
  return (
    <RequireAuth>
      <ProfileContent />
    </RequireAuth>
  );
}
