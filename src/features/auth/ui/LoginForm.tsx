"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";

import { INTERNAL_API } from "@/shared/api/stsLogin";
import {
  probeApiRoute,
  readFetchJson,
  resolveSameOriginApiUrl,
  type FetchJsonDebug,
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
  | { success: false; message?: string; [k: string]: unknown };

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
  const [loginDebug, setLoginDebug] = useState<FetchJsonDebug | null>(null);
  const [sessionProbe, setSessionProbe] = useState<FetchJsonDebug | null>(null);
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

  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    void (async () => {
      try {
        const debug = await probeApiRoute(INTERNAL_API.authentication.session);
        if (!cancelled) setSessionProbe(debug);
      } catch (err) {
        if (!cancelled) {
          console.error("[login] session probe failed", err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mounted]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoginDebug(null);
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
        setLoginDebug(parsed.debug);
        console.error("[login] non-json or failed response", parsed.debug);
        setError(parsed.error);
        return;
      }
      const json = parsed.data;

      if (!json || (json as { success?: boolean }).success !== true) {
        const msg =
          (json as { message?: string })?.message ??
          t("loginFailedCheckCredentials");
        setLoginDebug(parsed.debug);
        console.error("[login] API returned success=false", {
          debug: parsed.debug,
          json,
        });
        if (parsed.status === 503) {
          router.replace("/maintenance");
          return;
        }
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

  const sessionRouteBroken =
    sessionProbe != null &&
    (sessionProbe.status === 404 || sessionProbe.looksLikeHtml);

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
          {sessionRouteBroken ? (
            <details
              open
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-left"
            >
              <summary className="cursor-pointer text-xs font-medium text-amber-900">
                {t("loginDebugApiMissing")}
              </summary>
              <div className="mt-2 space-y-1 text-[11px] leading-snug text-amber-950">
                <p>{t("loginDebugHint")}</p>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-white/70 p-2 font-mono text-[10px]">
                  {JSON.stringify(sessionProbe, null, 2)}
                </pre>
              </div>
            </details>
          ) : null}

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
            <div className="space-y-2">
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </div>
              {(loginDebug || sessionProbe) && (
                <details className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-left">
                  <summary className="cursor-pointer text-xs font-medium text-amber-900">
                    {t("loginDebugTitle")}
                  </summary>
                  <div className="mt-2 space-y-2 text-[11px] leading-snug text-amber-950">
                    <p>{t("loginDebugHint")}</p>
                    {sessionProbe ? (
                      <div>
                        <p className="font-medium">{t("loginDebugSessionProbe")}</p>
                        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-white/70 p-2 font-mono text-[10px]">
                          {JSON.stringify(sessionProbe, null, 2)}
                        </pre>
                      </div>
                    ) : null}
                    {loginDebug ? (
                      <div>
                        <p className="font-medium">{t("loginDebugLoginPost")}</p>
                        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-white/70 p-2 font-mono text-[10px]">
                          {JSON.stringify(loginDebug, null, 2)}
                        </pre>
                      </div>
                    ) : null}
                  </div>
                </details>
              )}
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
