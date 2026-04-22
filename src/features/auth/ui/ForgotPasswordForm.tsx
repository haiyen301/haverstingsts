"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Mail } from "lucide-react";

import { INTERNAL_API } from "@/shared/api/stsLogin";
import { useAppTranslations } from "@/shared/i18n/useAppTranslations";

export default function ForgotPasswordForm() {
  const tBase = useAppTranslations();
  const t = (key: string) => tBase(`Auth.${key}`);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!email.trim()) {
      setError(t("forgotValidationEmail"));
      return;
    }
    setLoading(true);

    try {
      const res = await fetch(INTERNAL_API.authentication.forgetPassword, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      const json = (await res.json()) as {
        success?: boolean;
        message?: string;
      };

      if (!json || json.success !== true) {
        setError(json?.message ?? t("forgotResetSendFailed"));
        return;
      }

      setSuccess(
        json.message ??
          t("forgotResetSuccess"),
      );
      window.setTimeout(() => {
        router.push(`/login/reset-password?email=${encodeURIComponent(email.trim())}`);
      }, 600);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("forgotRequestFailed"));
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
            {t("forgotPasswordTitle")}
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            {t("forgotPasswordSubtitle")}
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
                disabled={!!success}
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent disabled:bg-gray-50"
                autoComplete="email"
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
            disabled={loading || !!success}
            className="w-full py-3 bg-button-primary text-white rounded-lg font-medium hover:bg-[#196A40] transition-colors disabled:opacity-60"
          >
            {loading ? t("sending") : t("sendResetLink")}
          </button>

          <Link
            href="/"
            className="flex items-center justify-center gap-2 text-sm text-[#1F7A4C] font-medium hover:underline"
          >
            <ArrowLeft className="w-4 h-4" />
            {t("backToSignIn")}
          </Link>
        </form>
      </div>
    </div>
  );
}
