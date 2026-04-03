"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lock, Mail } from "lucide-react";

import { INTERNAL_API } from "@/shared/api/stsLogin";
import {
  clearRememberedCredentials,
  loadRememberedCredentials,
  saveRememberedCredentials,
} from "@/shared/lib/loginRemember";
import { fetchSessionAuthenticated, removeAuthToken } from "@/shared/lib/sessionUser";
import type { SessionUser } from "@/shared/lib/sessionUser";
import { useAuthUserStore } from "@/shared/store/authUserStore";
import { useAppTranslations } from "@/shared/i18n/useAppTranslations";

type LoginResponse =
  | {
      success: true;
      message?: string;
      data: { token?: string; [k: string]: unknown };
    }
  | { success: false; message?: string; [k: string]: unknown };

export default function LoginForm() {
  const tBase = useAppTranslations();
  const t = (key: string) => tBase(`Auth.${key}`);
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const saved = loadRememberedCredentials();
    if (saved?.email) {
      setEmail(saved.email);
      setRemember(true);
    }
  }, [mounted]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError(t("loginValidationEmailPassword"));
      return;
    }
    setLoading(true);

    try {
      const res = await fetch(INTERNAL_API.authentication.login, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      const json: LoginResponse = await res.json();

      if (!json || (json as { success?: boolean }).success !== true) {
        const msg =
          (json as { message?: string })?.message ??
          t("loginFailedCheckCredentials");
        setError(msg);
        return;
      }

      removeAuthToken();
      const data = (json as { data?: Record<string, unknown> }).data;
      if (!data || typeof data !== "object") {
        setError(t("loginTokenMissing"));
        return;
      }
      const { token: _omit, ...profile } = data;
      useAuthUserStore.getState().setUser(profile as SessionUser);

      const sessionOk = await fetchSessionAuthenticated();
      if (!sessionOk) {
        setError(t("loginTokenMissing"));
        return;
      }

      if (remember) {
        saveRememberedCredentials(email);
      } else {
        clearRememberedCredentials();
      }

      router.replace("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("loginFailedGeneric"));
    } finally {
      setLoading(false);
    }
  };

  if (!mounted) return null;

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-gray-50 p-4"
      suppressHydrationWarning
    >
      <div className="w-full max-w-md bg-white rounded-xl border border-gray-200 p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">{t("loginTitle")}</h1>
          <p className="text-sm text-gray-600 mt-1">
            {t("loginSubtitle")}
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("email")}
            </label>
            <div className="relative">
              <Mail className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                placeholder="you@example.com"
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent"
                autoComplete="email"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("password")}
            </label>
            <div className="relative">
              <Lock className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder={t("passwordPlaceholder")}
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent"
                autoComplete="current-password"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="rounded border-gray-300 text-[#1F7A4C] focus:ring-[#1F7A4C]"
              />
              <span className="text-sm text-gray-700">{t("rememberMe")}</span>
            </label>
            <Link
              href="/forgot-password"
              className="text-sm text-[#1F7A4C] font-medium hover:underline shrink-0"
            >
              {t("forgotPassword")}
            </Link>
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-button-primary text-white rounded-lg font-medium hover:bg-[#196A40] transition-colors disabled:opacity-60"
          >
            {loading ? t("signingIn") : t("signIn")}
          </button>

          <p className="text-center text-sm text-gray-600">
            {t("noAccount")}{" "}
            <Link
              href="/register"
              className="text-[#1F7A4C] font-medium hover:underline"
            >
              {t("register")}
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
