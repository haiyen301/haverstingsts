"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, CloudSun, LogOut } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  getUserDisplayName,
  getUserInitials,
  getUserAvatarPath,
  resolveAvatarUrl,
} from "@/shared/lib/sessionUser";
import { clearAuthSession, useAuthUserStore } from "@/shared/store/authUserStore";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { cn } from "@/lib/utils";
import { SidebarMenu } from "@/widgets/layout/Menu";

type SidebarProfileProps = {
  onNavigate?: () => void;
  compact?: boolean;
};

type SidebarWeatherCurrent = {
  temperature_2m?: number;
  weather_code?: number;
  precipitation?: number;
};

type SidebarWeatherPayload = {
  current?: SidebarWeatherCurrent;
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    precipitation_probability?: number[];
    weather_code?: number[];
  };
};

type WeatherTarget = {
  farmId: string;
  farmName: string;
  locationId: string;
};

function extractDateHour(raw: string): { date: string; hour: string } | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const date = s.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const h = s.slice(11, 13);
  if (!/^\d{2}$/.test(h)) return null;
  return { date, hour: h };
}

function weatherIconFromCode(code?: number): { icon: string; label: string } {
  if (code == null) return { icon: "❔", label: "Unknown" };
  if (code === 0) return { icon: "☀️", label: "Clear" };
  if (code === 1) return { icon: "🌤️", label: "Mainly clear" };
  if (code === 2) return { icon: "⛅", label: "Partly cloudy" };
  if (code === 3) return { icon: "☁️", label: "Overcast" };
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) {
    return { icon: "🌧️", label: "Rain" };
  }
  if (code === 95 || code === 96 || code === 99) return { icon: "⛈️", label: "Thunderstorm" };
  return { icon: "🌡️", label: "Weather" };
}

function mapFarmToLocationId(farmName: string, countryCode: string): string | null {
  const n = farmName.toLowerCase();
  if (n.includes("ban bueng")) return "ban-bueng-th";
  if (n.includes("laem chabang")) return "laem-chabang-th";
  if (n.includes("semenyih")) return "semenyih-my";
  if (n.includes("hoi an")) return "hoi-an-vn";
  if (n.includes("phan thiet")) return "phan-thiet-vn";

  if (countryCode === "TH") return "laem-chabang-th";
  if (countryCode === "MY") return "semenyih-my";
  if (countryCode === "VN") return "phan-thiet-vn";
  return null;
}

export function SidebarProfile({ onNavigate, compact = false }: SidebarProfileProps) {
  const router = useRouter();
  const user = useAuthUserStore((s) => s.user);
  const farms = useHarvestingDataStore((s) => s.farms);
  const countries = useHarvestingDataStore((s) => s.activeCountries);
  const t = useTranslations("SidebarProfile");
  const [weatherData, setWeatherData] = useState<SidebarWeatherPayload | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [activeWeatherIndex, setActiveWeatherIndex] = useState(0);

  const displayName = getUserDisplayName(user);
  const email = user?.email?.trim() ?? "";
  const avatarSrc = resolveAvatarUrl(getUserAvatarPath(user));


  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const weatherTargets = useMemo((): WeatherTarget[] => {
    const userCountryRaw = String(
      user?.user_country_id ?? user?.country_id ?? user?.country ?? "",
    ).trim();
    if (!userCountryRaw) return [];

    const countryRows = (countries as unknown[]).filter(
      (x): x is Record<string, unknown> => !!x && typeof x === "object",
    );
    const matchedCountry = countryRows.find((row) => {
      const id = String(row.id ?? "").trim();
      const code = String(row.country_code ?? "").trim().toUpperCase();
      const name = String(row.country_name ?? row.name ?? "").trim().toLowerCase();
      const key = userCountryRaw.toLowerCase();
      return id === userCountryRaw || code === userCountryRaw.toUpperCase() || name === key;
    });
    const countryId = String(matchedCountry?.id ?? userCountryRaw).trim();
    const countryCode = String(matchedCountry?.country_code ?? "").trim().toUpperCase();

    const farmRows = (farms as unknown[])
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .filter((f) => String(f.country_id ?? "").trim() === countryId);
    if (!farmRows.length) return [];

    const targets: WeatherTarget[] = [];
    const seen = new Set<string>();
    for (const farm of farmRows) {
      const farmId = String(farm.id ?? "").trim();
      const farmName = String(farm.name ?? farm.title ?? "").trim();
      if (!farmName) continue;
      const locationId = mapFarmToLocationId(farmName, countryCode);
      if (!locationId) continue;
      const key = `${farmId}|${locationId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ farmId, farmName, locationId });
    }
    return targets;
  }, [countries, farms, user?.country, user?.country_id, user?.user_country_id]);

  useEffect(() => {
    if (!weatherTargets.length) {
      setActiveWeatherIndex(0);
      setWeatherData(null);
      return;
    }
    if (activeWeatherIndex > weatherTargets.length - 1) {
      setActiveWeatherIndex(0);
    }
  }, [activeWeatherIndex, weatherTargets]);

  const weatherTarget = weatherTargets[activeWeatherIndex] ?? null;

  useEffect(() => {
    if (!weatherTarget) {
      setWeatherData(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        setWeatherLoading(true);
        const qs = new URLSearchParams({
          locationId: weatherTarget.locationId,
          forecastDays: "1",
        });
        const res = await fetch(`/api/weather/db_open_meteo?${qs.toString()}`, {
          cache: "no-store",
          credentials: "same-origin",
        });
        const payload = (await res.json()) as {
          success?: boolean;
          data?: SidebarWeatherPayload | null;
        };
        if (!cancelled) {
          setWeatherData(payload.success ? (payload.data ?? null) : null);
        }
      } catch {
        if (!cancelled) setWeatherData(null);
      } finally {
        if (!cancelled) setWeatherLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [weatherTarget?.locationId]);

  const goProfile = () => {
    router.push("/profile");
    onNavigate?.();
  };

  const logout = async () => {
    await clearAuthSession();
    onNavigate?.();
    router.replace("/");
  };

  const weatherNowLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(nowMs)),
    [nowMs],
  );

  const weatherByCurrentHour = useMemo(() => {
    const now = new Date(nowMs);
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const h = String(now.getHours()).padStart(2, "0");
    const currentDate = `${y}-${m}-${d}`;
    const currentHour = h;

    const hourly = weatherData?.hourly;
    const times = hourly?.time ?? [];
    const idx = times.findIndex((t) => {
      const dh = extractDateHour(String(t));
      return dh?.date === currentDate && dh?.hour === currentHour;
    });
    if (idx >= 0) {
      return {
        temperature_2m: hourly?.temperature_2m?.[idx],
        precipitation: hourly?.precipitation_probability?.[idx],
        weather_code: hourly?.weather_code?.[idx],
        source: "hourly" as const,
      };
    }
    const cur = weatherData?.current;
    if (!cur) return null;
    return {
      temperature_2m: cur.temperature_2m,
      precipitation: cur.precipitation,
      weather_code: cur.weather_code,
      source: "current" as const,
    };
  }, [nowMs, weatherData]);

  const weatherBadge = weatherIconFromCode(weatherByCurrentHour?.weather_code);

  return (
    <div
      className={cn(
        "shrink-0 border-t border-sidebar-border bg-sidebar text-sidebar-foreground",
        compact ? "px-2 py-3" : "px-3 pb-4 pt-3",
      )}
    >
      <div className="pb-3">
        <SidebarMenu compact={compact} />
      </div>

      {!compact && weatherTarget ? (
        <div className="hidden mb-3 rounded-lg border border-sidebar-border bg-muted/80 p-2.5 dark:bg-sidebar-accent/40">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-sidebar-foreground">
                {weatherTarget.farmName}
              </p>
              <p className="text-[11px] text-sidebar-foreground/60">{weatherNowLabel}</p>
            </div>
            <CloudSun className="h-4 w-4 shrink-0 text-sidebar-foreground/50" />
          </div>
          <div className="mt-2 flex items-center justify-between rounded-md bg-card px-2.5 py-2 dark:bg-sidebar-accent/50">
            {weatherLoading ? (
              <p className="text-xs text-sidebar-foreground/60">Loading weather...</p>
            ) : weatherByCurrentHour ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-base">{weatherBadge.icon}</span>
                  <span className="text-xs text-sidebar-foreground/80">{weatherBadge.label}</span>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-sidebar-foreground">
                    {weatherByCurrentHour.temperature_2m ?? "-"}°
                  </p>
                  <p className="text-[11px] text-sidebar-foreground/60">
                    {weatherByCurrentHour.source === "hourly" ? "Rain % " : "Rain "}
                    {weatherByCurrentHour.precipitation ?? "-"}
                    {weatherByCurrentHour.source === "hourly" ? "%" : " mm"}
                  </p>
                </div>
              </>
            ) : (
              <p className="text-xs text-sidebar-foreground/60">No weather data</p>
            )}
          </div>
          {weatherTargets.length > 1 ? (
            <div className="mt-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() =>
                  setActiveWeatherIndex((prev) =>
                    prev <= 0 ? weatherTargets.length - 1 : prev - 1,
                  )
                }
                className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-sidebar-border bg-card text-sidebar-foreground hover:bg-muted dark:bg-sidebar-accent/50 dark:hover:bg-sidebar-accent"
                aria-label="Previous farm weather"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <div className="flex items-center gap-1.5">
                {weatherTargets.map((target, idx) => (
                  <button
                    key={`${target.farmId}-${target.locationId}`}
                    type="button"
                    onClick={() => setActiveWeatherIndex(idx)}
                    className={`h-1.5 w-1.5 rounded-full transition-all ${
                      idx === activeWeatherIndex
                        ? "w-3 bg-primary"
                        : "bg-sidebar-foreground/25"
                    }`}
                    aria-label={`Go to farm weather ${idx + 1}`}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() =>
                  setActiveWeatherIndex((prev) => (prev + 1) % weatherTargets.length)
                }
                className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-sidebar-border bg-card text-sidebar-foreground hover:bg-muted dark:bg-sidebar-accent/50 dark:hover:bg-sidebar-accent"
                aria-label="Next farm weather"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        onClick={goProfile}
        className={cn(
          "mt-3 flex w-full items-center border-t border-sidebar-border pt-3 rounded-lg p-2 transition-colors hover:bg-muted/80 dark:hover:bg-sidebar-accent/50",
          compact ? "justify-center" : "gap-3 text-left",
        )}
        title={compact ? displayName : undefined}
      >
        {avatarSrc ? (
          <img
            src={avatarSrc}
            alt={displayName}
            className="h-11 w-11 shrink-0 rounded-full border border-white/15 bg-muted object-cover object-[center_22%] brightness-110 contrast-110 saturate-105 shadow-sm dark:border-sidebar-border dark:bg-sidebar-accent/30"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-primary/80 bg-primary text-sm font-semibold text-primary-foreground"
            aria-hidden
          >
            {getUserInitials(user)}
          </div>
        )}
        {!compact ? (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-sidebar-foreground">
              {displayName}
            </p>
            {email ? (
              <p className="truncate text-xs text-sidebar-foreground/60">{email}</p>
            ) : (
              <p className="text-xs text-sidebar-foreground/50">{t("viewProfile")}</p>
            )}
          </div>
        ) : null}
      </button>

      <button
        type="button"
        onClick={logout}
        className={`mt-3 flex w-full items-center justify-center rounded-lg border border-sidebar-border bg-muted text-sm font-medium text-sidebar-foreground transition-colors hover:bg-muted/90 dark:bg-sidebar-accent/50 dark:hover:bg-sidebar-accent ${
          compact ? "px-2 py-2" : "gap-2 px-3 py-2"
        }`}
        title={t("logOut")}
      >
        <LogOut className="w-4 h-4 shrink-0" />
        {!compact ? t("logOut") : null}
      </button>
    </div>
  );
}
