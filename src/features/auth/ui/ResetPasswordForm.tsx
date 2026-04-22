"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Eye, EyeOff, Lock, Mail } from "lucide-react";

import { INTERNAL_API } from "@/shared/api/stsLogin";
import { useAppTranslations } from "@/shared/i18n/useAppTranslations";

export default function ResetPasswordForm() {
  const tBase = useAppTranslations();
  const t = (key: string) => tBase(`Auth.${key}`);
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialEmail = searchParams.get("email")?.trim() ?? "";
  const initialCode = searchParams.get("code")?.trim() ?? "";
  const initialVerified = searchParams.get("verified") === "1";

  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState(initialCode);
  const [codeVerified, setCodeVerified] = useState(initialVerified);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const verifyCode = async () => {
    setError(null);
    setSuccess(null);

    const normalizedEmail = email.trim();
    const normalizedCode = code.trim();
    if (!normalizedEmail) {
      setError(t("forgotValidationEmail"));
      return;
    }
    if (!/^\d{8}$/.test(normalizedCode)) {
      setError("Reset code must be exactly 8 digits.");
      return;
    }

    setVerifying(true);
    try {
      const res = await fetch(INTERNAL_API.authentication.verifyResetCode, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: normalizedCode, email: normalizedEmail }),
      });
      const json = (await res.json()) as { success?: boolean; message?: string };

      if (!json || json.success !== true) {
        setCodeVerified(false);
        setError(json?.message ?? "Reset code is invalid or expired.");
        return;
      }

      setCodeVerified(true);
      router.replace(
        `/login/reset-password?email=${encodeURIComponent(normalizedEmail)}&code=${encodeURIComponent(normalizedCode)}&verified=1`,
      );
    } catch (err: unknown) {
      setCodeVerified(false);
      setError(err instanceof Error ? err.message : t("resetRequestFailed"));
    } finally {
      setVerifying(false);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const normalizedEmail = email.trim();
    const normalizedCode = code.trim();
    if (!normalizedEmail) {
      setError(t("forgotValidationEmail"));
      return;
    }
    if (!/^\d{8}$/.test(normalizedCode)) {
      setError("Reset code must be exactly 8 digits.");
      return;
    }
    if (!codeVerified) {
      setError("Please verify reset code before setting a new password.");
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
        body: JSON.stringify({ key: normalizedCode, email: normalizedEmail, password }),
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
      setCodeVerified(false);
      setCode("");
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
            {codeVerified ? "Set a new password" : t("resetPasswordTitle")}
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            {codeVerified
              ? "Choose a new password for your account."
              : "Enter your email and reset code to continue."}
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
            {!codeVerified && (
              <>
                <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("email")}
              </label>
              <div className="relative">
                <Mail className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setCodeVerified(false);
                  }}
                  type="email"
                  disabled={loading || verifying}
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent disabled:bg-gray-50"
                  autoComplete="email"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reset Code
              </label>
              <input
                value={code}
                onChange={(e) => {
                  const next = e.target.value.replace(/\D/g, "").slice(0, 8);
                  setCode(next);
                  setCodeVerified(false);
                }}
                type="text"
                inputMode="numeric"
                maxLength={8}
                disabled={loading || verifying}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent disabled:bg-gray-50 tracking-[0.2em]"
                placeholder="12345678"
              />
            </div>

            <button
              type="button"
              onClick={verifyCode}
              disabled={verifying || loading}
              className="w-full py-2.5 border border-[#1F7A4C] text-[#1F7A4C] rounded-lg font-medium hover:bg-[#1F7A4C]/5 transition-colors disabled:opacity-60"
            >
              {verifying ? "Verifying..." : "Verify code"}
            </button>
              </>
            )}

            {codeVerified && (
              <div className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                Reset code is valid.
              </div>
            )}

            {codeVerified && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t("password")}
                  </label>
                  <div className="relative">
                    <Lock className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      type={showPassword ? "text" : "password"}
                      disabled={loading}
                      className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent disabled:bg-gray-50"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
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
                      type={showConfirmPassword ? "text" : "password"}
                      disabled={loading}
                      className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent disabled:bg-gray-50"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((prev) => !prev)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                    >
                      {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>
              </>
            )}

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
              disabled={loading || !codeVerified}
              className="w-full py-3 bg-button-primary text-white rounded-lg font-medium hover:bg-[#196A40] transition-colors disabled:opacity-60"
            >
              {loading ? t("resetSaving") : t("resetPasswordSubmit")}
            </button>
          </form>

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
