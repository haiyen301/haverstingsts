"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { Clock, Wrench } from "lucide-react";
import { useTranslations } from "next-intl";

import { images } from "@/lib/assets/images";
import { fetchMaintenanceStatus } from "@/features/admin/api/maintenanceApi";
import { enableMaintenancePolling } from "@/shared/auth/maintenancePollControl";
import {
  clearMaintenanceReturnPath,
  resolveMaintenanceExitPath,
} from "@/shared/auth/maintenanceReturnPath";
import { fetchSessionAuthenticated } from "@/shared/lib/sessionUser";

export function MaintenanceScreen() {
  const t = useTranslations("Maintenance");
  const router = useRouter();
  const searchParams = useSearchParams();
  const { theme, mounted: themeMounted } = useTheme();
  const [message, setMessage] = useState("");
  const [estimatedReturn, setEstimatedReturn] = useState("");
  const [showPage, setShowPage] = useState(false);

  useEffect(() => {
    let mounted = true;

    void (async () => {
      try {
        const status = await fetchMaintenanceStatus();
        if (!mounted) return;

        if (!status.enabled) {
          const authed = await fetchSessionAuthenticated();
          if (!mounted) return;

          const target = resolveMaintenanceExitPath({
            authenticated: authed,
            fromQuery: searchParams.get("from"),
          });
          if (authed) clearMaintenanceReturnPath();
          enableMaintenancePolling();
          router.replace(target);
          return;
        }

        if (status.message) setMessage(status.message);
        if (status.estimatedReturn) setEstimatedReturn(status.estimatedReturn);
        setShowPage(true);
      } catch {
        if (mounted) setShowPage(true);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [router, searchParams]);

  if (!showPage) return null;

  const logoSrc =
    themeMounted && theme === "dark" ? images.stsLogoDark : images.stsLogo;

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-4 py-16">
      <div
        className="pointer-events-none absolute inset-0 opacity-90"
        aria-hidden
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% -10%, hsl(var(--secondary) / 0.35), transparent 55%), radial-gradient(ellipse 70% 50% at 100% 100%, hsl(var(--primary) / 0.12), transparent 50%), radial-gradient(ellipse 60% 40% at 0% 80%, hsl(var(--accent) / 0.08), transparent 45%)",
        }}
      />
      <div
        className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full blur-3xl"
        style={{ background: "hsl(var(--primary) / 0.15)" }}
        aria-hidden
      />

      <div className="relative z-10 w-full max-w-lg">
        <div className="mb-10 flex flex-col items-center text-center">
          <div className="mb-6 flex h-20 w-52 items-center justify-center">
            <Image
              src={logoSrc}
              alt="STS"
              width={208}
              height={64}
              className="h-auto w-full max-w-[13rem] object-contain"
              priority
            />
          </div>
          <div className="mb-4 inline-flex items-center justify-center rounded-full border border-primary/20 bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary">
            <Wrench className="mr-2 h-4 w-4 shrink-0" aria-hidden />
            {t("badge")}
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {t("title")}
          </h1>
          <p className="mt-3 max-w-md text-base leading-relaxed text-muted-foreground">
            {message || t("subtitle")}
          </p>
          {estimatedReturn ? (
            <p className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border bg-card/80 px-4 py-2 text-sm text-foreground shadow-sm backdrop-blur-sm">
              <Clock className="h-4 w-4 text-primary" aria-hidden />
              <span>
                <span className="font-medium">{t("estimatedReturn")}: </span>
                {estimatedReturn}
              </span>
            </p>
          ) : null}
        </div>

        <div className="rounded-2xl border border-border/80 bg-card/90 p-6 shadow-lg backdrop-blur-md sm:p-8">
          <ul className="space-y-3 text-sm text-muted-foreground">
            <li className="flex gap-3">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
              {t("bullet1")}
            </li>
            <li className="flex gap-3">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-secondary" aria-hidden />
              {t("bullet2")}
            </li>
            <li className="flex gap-3">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
              {t("bullet3")}
            </li>
          </ul>
          <p className="mt-6 border-t border-border pt-5 text-center text-xs text-muted-foreground">
            {t("footer")}
          </p>
        </div>
      </div>
    </div>
  );
}
