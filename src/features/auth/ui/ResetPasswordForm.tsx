"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";

import { INTERNAL_API } from "@/shared/api/stsLogin";
import { useAppTranslations } from "@/shared/i18n/useAppTranslations";

export default function ResetPasswordForm() {
  const tBase = useAppTranslations();
  const t = (key: string) => tBase(`Auth.${key}`);
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!token) {
      setError(t("resetInvalidLink"));
      return;
    }
    if (!password) {
      setError(t("registerValidationPassword"));
      return;
    }
    if (password.length < 6) {
      setError(t("registerValidationPasswordLength"));
      return;
    }
    if (password !== confirm) {
      setError(t("registerValidationPasswordMismatch"));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(INTERNAL_API.authentication.resetPassword, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: token, password }),
      });

      const json = (await res.json()) as {
        success?: boolean;
        message?: string;
      };

      if (!json || json.success !== true) {
        setError(json?.message ?? t("resetFailed"));
        return;
      }

      setSuccess(json.message ?? t("resetSuccess"));
      setPassword("");
      setConfirm("");
      window.setTimeout(() => {
        router.replace("/");
      }, 1200);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("resetRequestFailed"));
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
          <h1 className="text-2xl font-semibold text-gray-900">
            {t("resetPasswordTitle")}
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            {t("resetPasswordSubtitle")}
          </p>
        </div>

        {!token ? (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {t("resetInvalidLink")}
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
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
                  disabled={!!success}
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent disabled:bg-gray-50"
                  autoComplete="new-password"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("confirmPassword")}
              </label>
              <div className="relative">
                <Lock className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  type="password"
                  disabled={!!success}
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent disabled:bg-gray-50"
                  autoComplete="new-password"
                />
              </div>
            </div>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            {success && (
              <div className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                {success}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !!success || !token}
              className="w-full py-3 bg-button-primary text-white rounded-lg font-medium hover:bg-[#196A40] transition-colors disabled:opacity-60"
            >
              {loading ? t("resetSaving") : t("resetPasswordSubmit")}
            </button>
          </form>
        )}

        <Link
          href="/"
          className="mt-6 flex items-center justify-center gap-2 text-sm text-[#1F7A4C] font-medium hover:underline"
        >
          <ArrowLeft className="w-4 h-4" />
          {t("backToSignIn")}
        </Link>
      </div>
    </div>
  );
}
