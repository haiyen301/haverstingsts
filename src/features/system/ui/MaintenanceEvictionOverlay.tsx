"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";

import {
  MAINTENANCE_EVICTION_COUNTDOWN_SEC,
  maintenanceEvictionToastPositionClass,
} from "@/shared/config/maintenanceEvictionConfig";
import { useMaintenanceEvictionStore } from "@/shared/store/maintenanceEvictionStore";
import { clearMaintenanceGraceCookie } from "@/shared/auth/maintenanceGraceCookie";
import { clearAuthSession } from "@/shared/store/authUserStore";

export function MaintenanceEvictionOverlay() {
  const t = useTranslations("Maintenance");
  const router = useRouter();
  const evicting = useMaintenanceEvictionStore((s) => s.evicting);
  const resetEviction = useMaintenanceEvictionStore((s) => s.resetEviction);
  const [secondsLeft, setSecondsLeft] = useState(
    MAINTENANCE_EVICTION_COUNTDOWN_SEC,
  );

  useEffect(() => {
    if (!evicting) return;

    setSecondsLeft(MAINTENANCE_EVICTION_COUNTDOWN_SEC);

    const intervalId = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) return 0;
        return prev - 1;
      });
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [evicting]);

  useEffect(() => {
    if (!evicting || secondsLeft > 0) return;

    let cancelled = false;
    void (async () => {
      await clearAuthSession();
      if (cancelled) return;
      clearMaintenanceGraceCookie();
      resetEviction();
      router.replace("/maintenance");
    })();

    return () => {
      cancelled = true;
    };
  }, [evicting, secondsLeft, resetEviction, router]);

  if (!evicting) return null;

  const progress =
    ((MAINTENANCE_EVICTION_COUNTDOWN_SEC - secondsLeft) /
      MAINTENANCE_EVICTION_COUNTDOWN_SEC) *
    100;

  return (
    <div
      className={`${maintenanceEvictionToastPositionClass()} w-[min(100vw-2rem,22rem)] animate-in slide-in-from-bottom-4 fade-in duration-300`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-labelledby="maintenance-eviction-title"
      aria-describedby="maintenance-eviction-desc"
    >
      <div className="overflow-hidden rounded-xl border border-warning/40 bg-card shadow-2xl ring-2 ring-warning/20">
        <div className="flex items-start gap-3 border-b border-border/80 bg-warning/10 px-4 py-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning/20">
            <AlertTriangle className="h-5 w-5 text-warning" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-warning">
              {t("eviction.badge")}
            </p>
            <h2
              id="maintenance-eviction-title"
              className="mt-0.5 text-sm font-semibold leading-snug text-foreground"
            >
              {t("eviction.title")}
            </h2>
          </div>
          <div
            className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-primary/10 tabular-nums"
            aria-label={`${secondsLeft} ${t("eviction.secondsLabel")}`}
          >
            <span className="text-2xl font-bold leading-none text-primary">
              {secondsLeft}
            </span>
            <span className="mt-0.5 text-[10px] font-medium uppercase text-muted-foreground">
              {t("eviction.secondsShort")}
            </span>
          </div>
        </div>

        <div className="px-4 py-3">
          <p
            id="maintenance-eviction-desc"
            className="text-xs leading-relaxed text-muted-foreground"
          >
            {t("eviction.description")}
          </p>

          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear"
              style={{ width: `${progress}%` }}
              aria-hidden
            />
          </div>

          <p className="mt-2 text-[11px] text-muted-foreground">
            {t("eviction.cornerHint")}
          </p>
        </div>
      </div>
    </div>
  );
}
