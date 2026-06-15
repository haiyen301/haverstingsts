"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";

import { INTERNAL_API } from "@/shared/api/stsLogin";
import {
  readFetchJson,
  resolveSameOriginApiUrl,
} from "@/shared/lib/fetchJsonResponse";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  clearRememberedCredentials,
  loadRememberedCredentials,
  saveRememberedCredentials,
} from "@/shared/lib/loginRemember";
import { fetchSessionAuthenticated, removeAuthToken } from "@/shared/lib/sessionUser";
import type { SessionUser } from "@/shared/lib/sessionUser";
import { enableMaintenancePolling } from "@/shared/auth/maintenancePollControl";
import {
  clearMaintenanceReturnPath,
  getMaintenanceReturnPath,
} from "@/shared/auth/maintenanceReturnPath";
import { refreshAuthUserFromServer } from "@/shared/auth/refreshAuthUserFromServer";
import { useAuthUserStore } from "@/shared/store/authUserStore";
import { useAppTranslations } from "@/shared/i18n/useAppTranslations";

type LoginResponse =
  | {
      success: true;
      message?: string;
      data: { token?: string; [k: string]: unknown };
    }
  | { success: false; message?: string; reason?: number; [k: string]: unknown };

/** Expected auth rejection (wrong password / unknown email) — not an infra bug. */
function isLoginCredentialFailure(
  status: number,
  json: LoginResponse | null | undefined,
): boolean {
  if (!json || json.success === true) return false;
  if (status === 503) return false;
  return json.success === false;
}

function loginErrorMessage(
  json: LoginResponse | null | undefined,
  t: (key: string) => string,
): string {
  if (json?.success === false && json.reason === 2) {
    return t("loginFailedWrongPassword");
  }
  return t("loginFailedCheckCredentials");
}

export default function LoginForm() {
  const tBase = useAppTranslations();
  const t = (key: string) => tBase(`Auth.${key}`);
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
      const loginPath = INTERNAL_API.authentication.login;
      const loginUrl = resolveSameOriginApiUrl(loginPath);
      const res = await fetch(loginPath, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      const parsed = await readFetchJson<LoginResponse>(res, loginUrl);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      const json = parsed.data;

      if (!json || (json as { success?: boolean }).success !== true) {
        if (parsed.status === 503) {
          router.replace("/maintenance");
          return;
        }
        if (isLoginCredentialFailure(parsed.status, json)) {
          setError(loginErrorMessage(json, t));
          return;
        }
        setError(
          (json as { message?: string })?.message ?? t("loginFailedGeneric"),
        );
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
      enableMaintenancePolling();

      await refreshAuthUserFromServer();

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

      const returnPath = getMaintenanceReturnPath();
      if (returnPath) clearMaintenanceReturnPath();
      router.replace(returnPath ?? "/dashboard");
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
                type={showPassword ? "text" : "password"}
                placeholder={t("passwordPlaceholder")}
                className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent"
                autoComplete="current-password"
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

          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <Checkbox
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                checkedClassName="peer-checked:border-[#1F7A4C] peer-checked:bg-[#1F7A4C] peer-checked:text-white"
                uncheckedClassName="border-gray-300"
                boxClassName="peer-focus-visible:ring-[#1F7A4C]"
              />
              <span className="text-sm text-gray-700">{t("rememberMe")}</span>
            </label>
            <Link
              href="/forgot-password"
              className="text-sm text-foreground font-medium hover:underline shrink-0"
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
              className="text-foreground font-medium hover:underline"
            >
              {t("register")}
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
