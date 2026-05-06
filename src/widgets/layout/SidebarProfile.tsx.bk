"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, CloudSun, LogOut } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import {
  getUserDisplayName,
  getUserInitials,
  getUserAvatarPath,
  resolveAvatarUrl,
} from "@/shared/lib/sessionUser";
import { clearAuthSession, useAuthUserStore } from "@/shared/store/authUserStore";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { LOCALES, type AppLocale } from "@/i18n/config";

type SidebarProfileProps = {
  onNavigate?: () => void;
  compact?: boolean;
};

const LOCALE_FLAG_MAP: Record<AppLocale, { code: string; alt: string }> = {
  en: { code: "gb", alt: "English" },
  th: { code: "th", alt: "Thai" },
  vi: { code: "vn", alt: "Vietnamese" },
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
  const countries = useHarvestingDataStore((s) => s.countries);
  const fetchAllHarvestingReferenceData = useHarvestingDataStore(
    (s) => s.fetchAllHarvestingReferenceData,
  );
  const locale = useLocale() as AppLocale;
  const t = useTranslations("SidebarProfile");
  const [weatherData, setWeatherData] = useState<SidebarWeatherPayload | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [activeWeatherIndex, setActiveWeatherIndex] = useState(0);

  const displayName = getUserDisplayName(user);
  const email = user?.email?.trim() ?? "";
  const avatarSrc = resolveAvatarUrl(getUserAvatarPath(user));

  useEffect(() => {
    void fetchAllHarvestingReferenceData();
  }, [fetchAllHarvestingReferenceData]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const weatherTargets = useMemo((): WeatherTarget[] => {
    const userCountryRaw = String(user?.country ?? user?.country_id ?? "").trim();
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
  }, [countries, farms, user?.country, user?.country_id]);

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

  const switchLocale = (nextLocale: AppLocale) => {
    if (nextLocale === locale) return;
    document.cookie = `NEXT_LOCALE=${nextLocale}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
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
    <div className={`border-gray-200 bg-white shrink-0 ${compact ? "p-3" : "p-4"}`}>
      <div className="hidden mt-2 grid-cols-3 gap-1 pb-3">
        {LOCALES.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => switchLocale(item)}
            className={`group flex cursor-pointer items-center justify-center rounded-md px-2 py-1.5 text-xs font-medium transition-colors`}
            aria-pressed={item === locale}
            title={t(`languages.${item}`)}
          >
            <img
              src={`/flags/${LOCALE_FLAG_MAP[item].code}.svg`}
              alt={LOCALE_FLAG_MAP[item].alt}
              width={22}
              height={16}
              className={`h-4 w-[22px] rounded-sm object-cover transition duration-200 ${
                item === locale
                  ? "brightness-110"
                  : "grayscale group-hover:grayscale-0 group-hover:brightness-110"
              }`}
            />
          </button>
        ))}
      </div>

      {!compact && weatherTarget ? (
        <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-gray-800">{weatherTarget.farmName}</p>
              <p className="text-[11px] text-gray-500">{weatherNowLabel}</p>
            </div>
            <CloudSun className="h-4 w-4 shrink-0 text-gray-400" />
          </div>
          <div className="mt-2 flex items-center justify-between rounded-md bg-white px-2.5 py-2">
            {weatherLoading ? (
              <p className="text-xs text-gray-500">Loading weather...</p>
            ) : weatherByCurrentHour ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-base">{weatherBadge.icon}</span>
                  <span className="text-xs text-gray-700">{weatherBadge.label}</span>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-gray-900">
                    {weatherByCurrentHour.temperature_2m ?? "-"}°
                  </p>
                  <p className="text-[11px] text-gray-500">
                    {weatherByCurrentHour.source === "hourly" ? "Rain % " : "Rain "}
                    {weatherByCurrentHour.precipitation ?? "-"}
                    {weatherByCurrentHour.source === "hourly" ? "%" : " mm"}
                  </p>
                </div>
              </>
            ) : (
              <p className="text-xs text-gray-500">No weather data</p>
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
                className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 hover:bg-gray-100"
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
                      idx === activeWeatherIndex ? "w-3 bg-[#1F7A4C]" : "bg-gray-300"
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
                className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 hover:bg-gray-100"
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
        className={`w-full flex items-center rounded-lg p-2 transition-colors hover:bg-gray-100 ${
          compact ? "justify-center" : "gap-3 text-left -m-2"
        }`}
        title={compact ? displayName : undefined}
      >
        {avatarSrc ? (
          <img
            src={avatarSrc}
            alt={displayName}
            className="w-10 h-10 rounded-full object-cover border border-gray-200 shrink-0 bg-gray-100"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div
            className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-sm font-semibold text-white bg-button-primary border border-[#196A40]"
            aria-hidden
          >
            {getUserInitials(user)}
          </div>
        )}
        {!compact ? (
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-900 truncate">
              {displayName}
            </p>
            {email ? (
              <p className="text-xs text-gray-500 truncate">{email}</p>
            ) : (
              <p className="text-xs text-gray-400">{t("viewProfile")}</p>
            )}
          </div>
        ) : null}
      </button>

      <button
        type="button"
        onClick={logout}
        className={`mt-3 w-full flex items-center justify-center text-sm font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors ${
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
