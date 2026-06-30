"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, LogOut, Mail, Phone, Briefcase, Lock } from "lucide-react";

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
import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import { getInternalStsProxyUrl } from "@/shared/api/stsProxyClient";

function ProfileContent() {
  const t = useAppTranslations();
  const router = useRouter();
  const user = useAuthUserStore((s) => s.user);

  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  const displayName = getUserDisplayName(user);
  const avatarSrc = resolveAvatarUrl(getUserAvatarPath(user));

  const logout = async () => {
    await clearAuthSession();
    router.replace("/");
  };

  const onChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (!currentPassword.trim() || !password || !passwordConfirm) {
      setPasswordError(t("Profile.passwordRequired"));
      return;
    }
    if (password.length < 6) {
      setPasswordError(t("Profile.passwordTooShort"));
      return;
    }
    if (password !== passwordConfirm) {
      setPasswordError(t("Profile.passwordMismatch"));
      return;
    }

    setPasswordLoading(true);
    try {
      const res = await fetch(getInternalStsProxyUrl(STS_API_PATHS.profileChangePassword), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          current_password: currentPassword,
          password,
          password_confirm: passwordConfirm,
        }),
      });

      const json = (await res.json()) as { success?: boolean; message?: string };
      if (!json?.success) {
        const msg = (json?.message ?? "").toLowerCase();
        if (msg.includes("authentication failed")) {
          setPasswordError(t("Profile.currentPasswordIncorrect"));
        } else {
          setPasswordError(json?.message ?? t("Profile.passwordRequired"));
        }
        return;
      }

      setPasswordSuccess(t("Profile.passwordUpdated"));
      setCurrentPassword("");
      setPassword("");
      setPasswordConfirm("");
    } catch (err: unknown) {
      setPasswordError(err instanceof Error ? err.message : t("Profile.passwordRequired"));
    } finally {
      setPasswordLoading(false);
    }
  };

  const row = (label: string, value: string | undefined) => (
    <div className="py-3 border-b border-gray-100 last:border-0">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
        {label}
      </p>
      <p className="text-sm text-gray-900 mt-0.5">{value?.trim() || "—"}</p>
    </div>
  );

  const passwordField = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    show: boolean,
    onToggleShow: () => void,
    autoComplete: string,
  ) => (
    <div>
      <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
        {label}
      </label>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 pr-10 text-sm text-gray-900 focus:border-button-primary focus:outline-none focus:ring-1 focus:ring-button-primary"
        />
        <button
          type="button"
          onClick={onToggleShow}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600"
          aria-label={show ? "Hide password" : "Show password"}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
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
                className="h-24 w-24 shrink-0 rounded-full border border-gray-200 bg-gray-100 object-cover object-[center_22%] brightness-105 contrast-110 saturate-105"
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

          <div className="px-6 py-5 border-t border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4">
              <Lock className="w-4 h-4 shrink-0" />
              {t("Profile.changePassword")}
            </h3>
            <form onSubmit={onChangePassword} className="space-y-4">
              {passwordField(
                t("Profile.currentPassword"),
                currentPassword,
                setCurrentPassword,
                showCurrentPassword,
                () => setShowCurrentPassword((v) => !v),
                "current-password",
              )}
              {passwordField(
                t("Profile.newPassword"),
                password,
                setPassword,
                showPassword,
                () => setShowPassword((v) => !v),
                "new-password",
              )}
              {passwordField(
                t("Profile.confirmPassword"),
                passwordConfirm,
                setPasswordConfirm,
                showPasswordConfirm,
                () => setShowPasswordConfirm((v) => !v),
                "new-password",
              )}

              {passwordError ? (
                <p className="text-sm text-red-600" role="alert">
                  {passwordError}
                </p>
              ) : null}
              {passwordSuccess ? (
                <p className="text-sm text-green-700" role="status">
                  {passwordSuccess}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={passwordLoading}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-button-primary hover:bg-[#196A40] rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {passwordLoading ? "…" : t("Profile.updatePassword")}
              </button>
            </form>
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
