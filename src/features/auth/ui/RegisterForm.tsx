"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Lock, Mail, User } from "lucide-react";

import { INTERNAL_API } from "@/shared/api/stsLogin";
import {
  fetchSessionAuthenticated,
  removeAuthToken,
  type SessionUser,
} from "@/shared/lib/sessionUser";
import { useAuthUserStore } from "@/shared/store/authUserStore";
import { useAppTranslations } from "@/shared/i18n/useAppTranslations";

export default function RegisterForm() {
  const tBase = useAppTranslations();
  const t = (key: string) => tBase(`Auth.${key}`);
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [accountType, setAccountType] = useState<"organization" | "person">(
    "organization",
  );
  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!firstName.trim() || !lastName.trim()) {
      setError(t("registerValidationFirstLastName"));
      return;
    }
    if (!email.trim()) {
      setError(t("registerValidationEmail"));
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
    if (!confirmPassword) {
      setError(t("registerValidationConfirmPassword"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("registerValidationPasswordMismatch"));
      return;
    }
    setLoading(true);

    try {
      const res = await fetch(INTERNAL_API.authentication.register, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          email,
          password,
          account_type: accountType,
          company_name: companyName.trim() || undefined,
        }),
      });

      const json = (await res.json()) as Record<string, unknown>;

      if (!json || json.success !== true) {
        const msg =
          (json.message as string) ||
          (typeof json.messages === "object" &&
            JSON.stringify(json.messages)) ||
          t("registerFailed");
        setError(typeof msg === "string" ? msg : t("registerFailed"));
        return;
      }

      removeAuthToken();
      const profile: SessionUser = {
        first_name: firstName,
        last_name: lastName,
        email,
      };
      useAuthUserStore.getState().setUser(profile);
      const sessionOk = await fetchSessionAuthenticated();
      if (!sessionOk) {
        setError(t("registerTokenMissing"));
        return;
      }
      router.replace("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("registerFailed"));
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
          <h1 className="text-2xl font-semibold text-gray-900">{t("createAccountTitle")}</h1>
          <p className="text-sm text-gray-600 mt-1">
            {t("createAccountSubtitle")}
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("firstName")}
              </label>
              <div className="relative">
                <User className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("lastName")}
              </label>
              <div className="relative">
                <User className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("accountType")}
            </label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="account_type"
                  checked={accountType === "organization"}
                  onChange={() => setAccountType("organization")}
                  className="text-[#1F7A4C]"
                />
                <span className="text-sm text-gray-800">{t("organization")}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="account_type"
                  checked={accountType === "person"}
                  onChange={() => setAccountType("person")}
                  className="text-[#1F7A4C]"
                />
                <span className="text-sm text-gray-800">{t("individual")}</span>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("companyName")} <span className="text-gray-400 font-normal">({tBase("Common.optional").toLowerCase()})</span>
            </label>
            <div className="relative">
              <Building2 className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent"
                placeholder="Acme Inc."
              />
            </div>
          </div>

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
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent"
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
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                type="password"
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent"
                autoComplete="new-password"
              />
            </div>
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
            {loading ? t("creatingAccount") : t("register")}
          </button>

          <p className="text-center text-sm text-gray-600">
            {t("alreadyHaveAccount")}{" "}
            <Link
              href="/"
              className="text-[#1F7A4C] font-medium hover:underline"
            >
              {t("signIn")}
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
