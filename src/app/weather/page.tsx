"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "next-intl";

import RequireAuth from "@/features/auth/RequireAuth";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

type AsiaLocationItem = {
  name: string;
  href: string;
};

type AsiaApiResponse = {
  title?: string;
  source?: string;
  total?: number;
  locations?: AsiaLocationItem[];
  error?: string;
  fallback?: boolean;
  warning?: string;
};

type ResolveApiResponse = {
  source?: string;
  finalUrl?: string;
  error?: string;
};

type ForecastHtmlApiResponse = {
  tab?: "today";
  source?: string;
  html?: string;
  error?: string;
};

type PresetLocation = {
  id: string;
  label: string;
  weatherUrl: string;
};

const PRESET_LOCATIONS: PresetLocation[] = [
  {
    id: "ban-bueng-th",
    label: "Ban Bueng, Thailand",
    weatherUrl: "https://www.accuweather.com/en/th/ban-bung/479507/weather-forecast/479507",
  },
  {
    id: "laem-chabang-th",
    label: "Laem Chabang, Thailand",
    weatherUrl: "https://www.accuweather.com/en/th/laem-chabang/317589/weather-forecast/317589",
  },
  {
    id: "semenyih-my",
    label: "Semenyih, Malaysia",
    weatherUrl: "https://www.accuweather.com/en/my/semenyih/230491/weather-forecast/230491",
  },
  {
    id: "hoi-an-vn",
    label: "Hoi An, Vietnam",
    weatherUrl: "https://www.accuweather.com/en/vn/hoi-an/355711/weather-forecast/355711",
  },
  {
    id: "phan-thiet-vn",
    label: "Phan Thiet, Vietnam",
    weatherUrl: "https://www.accuweather.com/en/vn/phan-thiet/352262/weather-forecast/352262",
  },
];

type OpenMeteoResponse = {
  current?: {
    time?: string;
    temperature_2m?: number;
    relative_humidity_2m?: number;
    apparent_temperature?: number;
    precipitation?: number;
    weather_code?: number;
    wind_speed_10m?: number;
  };
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    relative_humidity_2m?: number[];
    precipitation_probability?: number[];
    weather_code?: number[];
  };
  daily?: {
    time?: string[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_sum?: number[];
    precipitation_probability_max?: number[];
    weather_code?: number[];
  };
};

function weatherIconFromCode(code?: number): { icon: string; label: string } {
  if (code == null) return { icon: "❔", label: "Unknown" };
  if (code === 0) return { icon: "☀️", label: "Clear sky" };
  if (code === 1) return { icon: "🌤️", label: "Mainly clear" };
  if (code === 2) return { icon: "⛅", label: "Partly cloudy" };
  if (code === 3) return { icon: "☁️", label: "Overcast" };
  if (code === 45 || code === 48) return { icon: "🌫️", label: "Fog" };
  if ([51, 53, 55, 56, 57].includes(code)) return { icon: "🌦️", label: "Drizzle" };
  if ([61, 63, 65, 66, 67].includes(code)) return { icon: "🌧️", label: "Rain" };
  if ([71, 73, 75, 77].includes(code)) return { icon: "🌨️", label: "Snow" };
  if ([80, 81, 82].includes(code)) return { icon: "🌧️", label: "Rain showers" };
  if ([85, 86].includes(code)) return { icon: "🌨️", label: "Snow showers" };
  if (code === 95 || code === 96 || code === 99) return { icon: "⛈️", label: "Thunderstorm" };
  return { icon: "🌡️", label: "Other weather" };
}

function rainBgClass(precipMm?: number | null): string {
  const v = typeof precipMm === "number" ? precipMm : 0;
  if (v <= 0) return "bg-emerald-50 border-emerald-100";
  if (v <= 2) return "bg-sky-50 border-sky-100";
  if (v <= 10) return "bg-blue-50 border-blue-100";
  return "bg-indigo-50 border-indigo-100";
}

export default function WeatherPage() {
  const locale = useLocale();
  const [loadingCountries, setLoadingCountries] = useState(false);
  const [loadingRegions, setLoadingRegions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asiaTitle, setAsiaTitle] = useState("Asia");
  const [countries, setCountries] = useState<AsiaLocationItem[]>([]);
  const [selectedCountryPath, setSelectedCountryPath] = useState("");
  const [regionTitle, setRegionTitle] = useState("");
  const [regions, setRegions] = useState<AsiaLocationItem[]>([]);
  const [selectedRegionPath, setSelectedRegionPath] = useState("");
  const [childTitle, setChildTitle] = useState("");
  const [childLocations, setChildLocations] = useState<AsiaLocationItem[]>([]);
  const [selectedLeafHref, setSelectedLeafHref] = useState("");
  const [loadingChild, setLoadingChild] = useState(false);
  const [resolvingLink, setResolvingLink] = useState(false);
  const [resolvedFinalUrl, setResolvedFinalUrl] = useState("");
  const [activeForecastTab, setActiveForecastTab] = useState<
    "today" | "hours" | "10days" | "monthly"
  >("today");
  const [loadingTodayHtml, setLoadingTodayHtml] = useState(false);
  const [todayHtml, setTodayHtml] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [loadingOpenMeteo, setLoadingOpenMeteo] = useState(false);
  const [openMeteoError, setOpenMeteoError] = useState<string | null>(null);
  const [openMeteoData, setOpenMeteoData] = useState<OpenMeteoResponse | null>(null);
  const [openMeteoRunDate, setOpenMeteoRunDate] = useState("");
  const [showAllHours, setShowAllHours] = useState(false);
  const timelineViewportRef = useRef<HTMLDivElement | null>(null);
  const pageContentRef = useRef<HTMLDivElement | null>(null);
  const lockedMainWidthRef = useRef<number | null>(null);
  const lastWindowInnerWidthRef = useRef(0);
  const isResizingRef = useRef(false);
  const resizeStopTimerRef = useRef<number | null>(null);
  const [mainWidth, setMainWidth] = useState(0);
  const [lockedMainWidth, setLockedMainWidth] = useState(0);
  const [debugTimelineContentWidth, setDebugTimelineContentWidth] = useState(0);
  const [screenWidth, setScreenWidth] = useState(0);
  const [jsNowMs, setJsNowMs] = useState(() => Date.now());

  const loadFromPath = async (path: string) => {
    const lang = locale === "vi" ? "vi" : "en";
    const res = await fetch(
      `/api/accuweather/asia?lang=${lang}&path=${encodeURIComponent(path)}`,
      { cache: "no-store" },
    );
    const payload = (await res.json()) as AsiaApiResponse;
    if (!res.ok || payload.error) {
      throw new Error(payload.error ?? `Request failed (${res.status})`);
    }
    return payload;
  };

  useEffect(() => {
    if (selectedPresetId || loadingOpenMeteo) return;
    const first = PRESET_LOCATIONS[0];
    if (!first) return;
    handleSelectPreset(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadingCountries(true);
    setError(null);
    void (async () => {
      try {
        const payload = await loadFromPath(
          locale === "vi" ? "/vi/browse-locations/asi" : "/en/browse-locations/asi",
        );
        if (cancelled) return;
        setAsiaTitle(payload.title?.trim() || "Asia");
        setCountries(Array.isArray(payload.locations) ? payload.locations : []);
      } catch (err) {
        if (cancelled) return;
        setCountries([]);
        setError(err instanceof Error ? err.message : "Load failed");
      } finally {
        if (!cancelled) setLoadingCountries(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locale]);

  useEffect(() => {
    if (!selectedCountryPath) {
      setRegions([]);
      setRegionTitle("");
      setSelectedRegionPath("");
      setChildLocations([]);
      setChildTitle("");
      setResolvedFinalUrl("");
      setTodayHtml("");
      setSelectedLeafHref("");
      return;
    }
    let cancelled = false;
    setLoadingRegions(true);
    setError(null);
    void (async () => {
      try {
        const payload = await loadFromPath(selectedCountryPath);
        if (cancelled) return;
        setRegionTitle(payload.title?.trim() || "Details");
        setRegions(Array.isArray(payload.locations) ? payload.locations : []);
        setSelectedRegionPath("");
        setChildLocations([]);
        setChildTitle("");
        setResolvedFinalUrl("");
        setTodayHtml("");
        setSelectedLeafHref("");
      } catch (err) {
        if (cancelled) return;
        setRegions([]);
        setRegionTitle("");
        setError(err instanceof Error ? err.message : "Load failed");
      } finally {
        if (!cancelled) setLoadingRegions(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCountryPath]);

  useEffect(() => {
    if (!selectedRegionPath) {
      setChildLocations([]);
      setChildTitle("");
      setResolvedFinalUrl("");
      setTodayHtml("");
      setSelectedLeafHref("");
      return;
    }
    let cancelled = false;
    setLoadingChild(true);
    setError(null);
    void (async () => {
      try {
        const payload = await loadFromPath(selectedRegionPath);
        if (cancelled) return;
        setChildTitle(payload.title?.trim() || "Locations");
        setChildLocations(Array.isArray(payload.locations) ? payload.locations : []);
        setResolvedFinalUrl("");
        setTodayHtml("");
        setSelectedLeafHref("");
      } catch (err) {
        if (cancelled) return;
        setChildLocations([]);
        setChildTitle("");
        setError(err instanceof Error ? err.message : "Load failed");
      } finally {
        if (!cancelled) setLoadingChild(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedRegionPath]);

  const resolveRedirectLink = async (href: string) => {
    setResolvingLink(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/accuweather/asia?resolve=${encodeURIComponent(href)}`,
        { cache: "no-store" },
      );
      const payload = (await res.json()) as ResolveApiResponse;
      if (!res.ok || payload.error || !payload.finalUrl) {
        throw new Error(payload.error ?? `Resolve failed (${res.status})`);
      }
      setResolvedFinalUrl(payload.finalUrl);
      setTodayHtml("");
    } catch (err) {
      setResolvedFinalUrl("");
      setError(err instanceof Error ? err.message : "Resolve failed");
    } finally {
      setResolvingLink(false);
    }
  };

  const handleSelectPreset = (preset: PresetLocation) => {
    setSelectedPresetId(preset.id);
    setSelectedCountryPath("");
    setSelectedRegionPath("");
    setSelectedLeafHref("");
    setChildLocations([]);
    setRegions([]);
    setRegionTitle("");
    setChildTitle("");
    setError(null);
    setOpenMeteoError(null);
    setTodayHtml("");
    setOpenMeteoData(null);
    setOpenMeteoRunDate("");
    setShowAllHours(false);
    setResolvedFinalUrl(preset.weatherUrl);
    void loadOpenMeteoForecast(preset);
  };

  const loadOpenMeteoForecast = async (preset: PresetLocation) => {
    setLoadingOpenMeteo(true);
    setOpenMeteoError(null);
    try {
      const res = await fetch(
        `/api/sts/weather/db_open_meteo?location_id=${encodeURIComponent(preset.id)}&forecast_days=16`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        throw new Error(`DB weather fetch failed (${res.status})`);
      }
      const payload = (await res.json()) as {
        success?: boolean;
        run_date?: string;
        data?: OpenMeteoResponse;
        message?: string;
        error?: string;
      };
      if (!payload.success || !payload.data) {
        throw new Error(payload.message ?? payload.error ?? "Open-Meteo response invalid");
      }
      setOpenMeteoData(payload.data);
      setOpenMeteoRunDate(payload.run_date ?? "");
    } catch (err) {
      setOpenMeteoData(null);
      setOpenMeteoError(
        err instanceof Error ? err.message : "Load from DB failed. Run cron_open_meteo first.",
      );
    } finally {
      setLoadingOpenMeteo(false);
    }
  };

  const loadTodayHtmlFromFinalUrl = async () => {
    if (!resolvedFinalUrl) return;
    setLoadingTodayHtml(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/accuweather/asia?tab=today&forecastUrl=${encodeURIComponent(resolvedFinalUrl)}`,
        { cache: "no-store" },
      );
      const payload = (await res.json()) as ForecastHtmlApiResponse;
      if (!res.ok || payload.error) {
        throw new Error(payload.error ?? `Load today HTML failed (${res.status})`);
      }
      setTodayHtml(payload.html?.trim() ?? "");
    } catch (err) {
      setTodayHtml("");
      setError(err instanceof Error ? err.message : "Load today HTML failed");
    } finally {
      setLoadingTodayHtml(false);
    }
  };

  const getPathFromHref = (href: string): string => {
    try {
      return new URL(href).pathname;
    } catch {
      return href;
    }
  };

  const selectedRegionItem = useMemo(
    () =>
      regions.find((item) => getPathFromHref(item.href) === selectedRegionPath) ?? null,
    [regions, selectedRegionPath],
  );

  const leafLocations = useMemo(() => {
    if (childLocations.length > 0) return childLocations;
    if (selectedRegionItem) return [selectedRegionItem];
    return [];
  }, [childLocations, selectedRegionItem]);

  const openMeteoTodayDate = useMemo(() => {
    return openMeteoData?.current?.time?.split("T")[0] ?? openMeteoData?.daily?.time?.[0] ?? "";
  }, [openMeteoData]);

  const openMeteoTodayHourlyRows = useMemo(() => {
    const hours = openMeteoData?.hourly;
    if (!hours?.time?.length || !openMeteoTodayDate) return [];
    const rows: Array<{
      time: string;
      temp: number | null;
      humidity: number | null;
      precipitationProb: number | null;
      weatherCode: number | null;
    }> = [];
    for (let i = 0; i < hours.time.length; i += 1) {
      const timestamp = hours.time[i];
      if (!timestamp?.startsWith(openMeteoTodayDate)) continue;
      rows.push({
        time: timestamp,
        temp: hours.temperature_2m?.[i] ?? null,
        humidity: hours.relative_humidity_2m?.[i] ?? null,
        precipitationProb: hours.precipitation_probability?.[i] ?? null,
        weatherCode: hours.weather_code?.[i] ?? null,
      });
    }
    return rows;
  }, [openMeteoData, openMeteoTodayDate]);

  const openMeteoHourlyRows = useMemo(() => {
    const hours = openMeteoData?.hourly;
    if (!hours?.time?.length) return [];
    return hours.time.map((timestamp, i) => ({
      time: timestamp,
      date: timestamp.slice(0, 10),
      hour: timestamp.slice(11, 13),
      temp: hours.temperature_2m?.[i] ?? null,
      humidity: hours.relative_humidity_2m?.[i] ?? null,
      precipitationProb: hours.precipitation_probability?.[i] ?? null,
      weatherCode: hours.weather_code?.[i] ?? null,
    }));
  }, [openMeteoData]);

  const openMeteoDailyRows = useMemo(() => {
    const daily = openMeteoData?.daily;
    if (!daily?.time?.length) return [];
    return daily.time.map((date, i) => ({
      date,
      max: daily.temperature_2m_max?.[i] ?? null,
      min: daily.temperature_2m_min?.[i] ?? null,
      precipitation: daily.precipitation_sum?.[i] ?? null,
      precipitationProbMax: daily.precipitation_probability_max?.[i] ?? null,
      weatherCode: daily.weather_code?.[i] ?? null,
    }));
  }, [openMeteoData]);

  const openMeteoMonthlyRows = useMemo(() => {
    const dailyRows = openMeteoDailyRows;
    if (dailyRows.length === 0) return [];
    const map = new Map<
      string,
      {
        sumAvg: number;
        count: number;
        min: number | null;
        max: number | null;
        totalPrecip: number;
        rainyDays: number;
      }
    >();
    for (const row of dailyRows) {
      const month = row.date.slice(0, 7);
      const bucket = map.get(month) ?? {
        sumAvg: 0,
        count: 0,
        min: null,
        max: null,
        totalPrecip: 0,
        rainyDays: 0,
      };
      if (typeof row.max === "number" && typeof row.min === "number") {
        bucket.sumAvg += (row.max + row.min) / 2;
        bucket.count += 1;
      }
      if (typeof row.min === "number") {
        bucket.min = bucket.min === null ? row.min : Math.min(bucket.min, row.min);
      }
      if (typeof row.max === "number") {
        bucket.max = bucket.max === null ? row.max : Math.max(bucket.max, row.max);
      }
      const precip = typeof row.precipitation === "number" ? row.precipitation : 0;
      bucket.totalPrecip += precip;
      if (precip > 0) bucket.rainyDays += 1;
      map.set(month, bucket);
    }
    return Array.from(map.entries()).map(([month, bucket]) => ({
      month,
      avgTemp: bucket.count > 0 ? Number((bucket.sumAvg / bucket.count).toFixed(1)) : null,
      min: bucket.min,
      max: bucket.max,
      totalPrecip: Number(bucket.totalPrecip.toFixed(1)),
      rainyDays: bucket.rainyDays,
    }));
  }, [openMeteoDailyRows]);

  const hourlyDateColumns = useMemo(() => {
    const s = new Set<string>();
    for (const row of openMeteoHourlyRows) s.add(row.date);
    return Array.from(s).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }, [openMeteoHourlyRows]);

  const hourlyByDateHour = useMemo(() => {
    const m = new Map<string, (typeof openMeteoHourlyRows)[number]>();
    for (const row of openMeteoHourlyRows) {
      m.set(`${row.date}_${row.hour}`, row);
    }
    return m;
  }, [openMeteoHourlyRows]);

  const hourAxis = useMemo(
    () => Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")),
    [],
  );

  const monthYearLabel = useMemo(() => {
    if (!hourlyDateColumns.length) return "";
    const [y, m] = hourlyDateColumns[0].split("-").map((x) => Number(x));
    if (!y || !m) return "";
    return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
  }, [hourlyDateColumns]);

  const currentHourKey = useMemo(() => {
    const now = new Date(jsNowMs);
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const h = String(now.getHours()).padStart(2, "0");
    return `${y}-${m}-${d}_${h}`;
  }, [jsNowMs]);

  const currentDateStr = useMemo(() => currentHourKey.slice(0, 10), [currentHourKey]);
  const currentHourStr = useMemo(() => currentHourKey.slice(11, 13), [currentHourKey]);
  const hourRowsToRender = useMemo(() => {
    if (showAllHours) return hourAxis;
    if (currentHourStr) return [currentHourStr];
    return ["00"];
  }, [showAllHours, hourAxis, currentHourStr]);

  useEffect(() => {
    const tick = () => setJsNowMs(Date.now());
    const intervalId = window.setInterval(tick, 30 * 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  useLayoutEffect(() => {
    const contentEl = pageContentRef.current;
    if (!contentEl) return;

    const update = (relock = false) => {
      const contentClientWidth = contentEl.clientWidth;
      const contentRectWidth = Math.floor(contentEl.getBoundingClientRect().width);
      const viewportWidth = timelineViewportRef.current?.clientWidth ?? 0;
      // Lock width must track visible timeline viewport to avoid inflated max-content numbers.
      const measuredMainWidth =
        viewportWidth > 0 ? viewportWidth : Math.max(contentClientWidth, contentRectWidth, 0);
      const windowWidthChanged =
        lastWindowInnerWidthRef.current !== 0 &&
        lastWindowInnerWidthRef.current !== window.innerWidth;
      const shouldLock =
        lockedMainWidthRef.current == null || (relock && windowWidthChanged);
      if (shouldLock && measuredMainWidth > 0) {
        lockedMainWidthRef.current = measuredMainWidth;
        setLockedMainWidth(measuredMainWidth);
        console.warn("[timeline-content-width][locked]", {
          value: lockedMainWidthRef.current,
          relock,
          windowInnerWidth: window.innerWidth,
        });
      }
      lastWindowInnerWidthRef.current = window.innerWidth;
      console.warn("[timeline-content-width]", measuredMainWidth);
      setMainWidth(measuredMainWidth);
      setDebugTimelineContentWidth(measuredMainWidth);
      setScreenWidth(window.innerWidth);
    };

    // Measure immediately on first paint cycle before timeline data rows are shown.
    update();
    const rafId = window.requestAnimationFrame(() => update());

    const cleanup: Array<() => void> = [];
    const onResize = () => {
      isResizingRef.current = true;
      update(true);
      if (resizeStopTimerRef.current != null) {
        window.clearTimeout(resizeStopTimerRef.current);
      }
      resizeStopTimerRef.current = window.setTimeout(() => {
        isResizingRef.current = false;
        update(true);
        resizeStopTimerRef.current = null;
      }, 150);
    };
    window.addEventListener("resize", onResize);
    cleanup.push(() => window.removeEventListener("resize", onResize));
    cleanup.push(() => window.cancelAnimationFrame(rafId));
    cleanup.push(() => {
      if (resizeStopTimerRef.current != null) {
        window.clearTimeout(resizeStopTimerRef.current);
        resizeStopTimerRef.current = null;
      }
    });

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => update(false));
      observer.observe(contentEl);
      const viewportEl = timelineViewportRef.current;
      if (viewportEl) observer.observe(viewportEl);
      cleanup.push(() => observer.disconnect());
    }

    return () => {
      for (const fn of cleanup) fn();
    };
  }, [selectedPresetId, showAllHours, openMeteoData, loadingOpenMeteo]);

  const hourAxisWidth = 90;
  // Easy-to-change responsive day-column settings.
  const DAY_COLUMNS_DESKTOP = 7;
  const DAY_COLUMNS_TABLET = 5;
  const DAY_COLUMNS_MOBILE = 3;
  const DAY_COLUMNS_XS = 1;
  const visibleDayColumns = useMemo(() => {
    if (screenWidth > 0 && screenWidth < 420) return DAY_COLUMNS_XS;
    if (screenWidth > 0 && screenWidth < 768) return DAY_COLUMNS_MOBILE;
    if (screenWidth > 0 && screenWidth < 991) return DAY_COLUMNS_TABLET;
    return DAY_COLUMNS_DESKTOP;
  }, [screenWidth]);
  const timelineContentPx4Total = 64;
  const mainHorizontalPaddingTotal = 88;
  const baseMainWidth = lockedMainWidth || mainWidth;
  const timelineContainerWidth = useMemo(() => Math.max(baseMainWidth, 0), [baseMainWidth]);
  const computedAvailableWidth = useMemo(
    () =>
      Math.max(
        timelineContainerWidth -
          timelineContentPx4Total -
          mainHorizontalPaddingTotal -
          hourAxisWidth,
        0,
      ),
    [timelineContainerWidth, timelineContentPx4Total, mainHorizontalPaddingTotal],
  );
  const computedDayColWidth = useMemo(() => {
    const fit = Math.floor(computedAvailableWidth / visibleDayColumns);
    return Math.max(1, fit || 1);
  }, [computedAvailableWidth, visibleDayColumns]);

  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="min-h-screen overflow-x-hidden bg-gray-50 pb-10 lg:pb-14">
          <div
            ref={pageContentRef}
            className="timeline-content w-full max-w-full px-4 pt-4 lg:px-8 lg:pt-8"
          >
            <div className="mb-4">
              <h1 className="text-2xl font-semibold text-gray-900 lg:text-3xl">
                Weather - {asiaTitle}
              </h1>
              
            </div>
            <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-lg">
              <div className="border-b border-gray-100 p-4 lg:p-5">
                <div className="flex flex-wrap gap-2">
                  {PRESET_LOCATIONS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleSelectPreset(preset)}
                      className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                        selectedPresetId === preset.id
                          ? "border-[#1F7A4C] bg-[#1F7A4C] text-white"
                          : "border-gray-300 bg-white text-gray-700"
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="border-b border-gray-100 p-4 lg:p-5">
                
                {selectedPresetId ? (
                  loadingOpenMeteo ? (
                    <p className="mt-2 text-sm text-gray-600">Loading Open-Meteo forecast...</p>
                  ) : openMeteoError ? (
                    <p className="mt-2 text-sm text-red-600">
                      Open-Meteo error: {openMeteoError}. You can use AccuWeather backup below.
                    </p>
                  ) : openMeteoData?.current ? (
                    <div className="mt-2 overflow-x-auto">
                      <div className="grid min-w-[780px] gap-2 text-sm text-gray-700 sm:grid-cols-2 lg:grid-cols-3">
                        <p>
                          Weather: {weatherIconFromCode(openMeteoData.current.weather_code).icon}{" "}
                          {weatherIconFromCode(openMeteoData.current.weather_code).label}
                        </p>
                        <p>Temp: {openMeteoData.current.temperature_2m ?? "-"} °C</p>
                        <p>Feels like: {openMeteoData.current.apparent_temperature ?? "-"} °C</p>
                        <p>Humidity: {openMeteoData.current.relative_humidity_2m ?? "-"} %</p>
                        <p>Precipitation: {openMeteoData.current.precipitation ?? "-"} mm</p>
                        <p>Wind: {openMeteoData.current.wind_speed_10m ?? "-"} km/h</p>
                        <p>Weather code: {openMeteoData.current.weather_code ?? "-"}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-gray-500">
                      Select one quick location to load Open-Meteo forecast.
                    </p>
                  )
                ) : (
                  <p className="mt-2 text-sm text-gray-500">
                    Select one quick location to load Open-Meteo forecast.
                  </p>
                )}
                <div className="mt-4 rounded-xl border border-gray-200 bg-white p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm font-semibold text-gray-800">
                        Weather Timeline (hourly)
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setShowAllHours(false)}
                          disabled={!showAllHours}
                          className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40"
                        >
                          -
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowAllHours(true)}
                          disabled={showAllHours}
                          className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    {!openMeteoData || loadingOpenMeteo ? (
                      <p className="text-xs text-gray-500">
                        {loadingOpenMeteo
                          ? "Loading timeline data..."
                          : "Select one quick location to display timeline."}
                      </p>
                    ) : openMeteoError ? (
                      <p className="text-xs text-red-600">
                        Timeline unavailable: {openMeteoError}
                      </p>
                    ) : (
                      <div className="min-w-0 max-w-full overflow-hidden rounded border border-gray-100 bg-gray-50 p-3">
                        <div
                          ref={timelineViewportRef}
                          className="min-w-0 max-w-full overflow-x-auto overflow-y-hidden"
                        >
                        <div className="w-max" style={{ width: `${timelineContainerWidth}px` }}>
                          <div
                            className="mb-1 grid"
                            style={{
                              gridTemplateColumns: `${hourAxisWidth}px repeat(${hourlyDateColumns.length}, ${computedDayColWidth}px)`,
                            }}
                          >
                            <div />
                            {hourlyDateColumns.map((d) => (
                              <div
                                key={`day-${d}`}
                                className={`border px-2 py-2 text-center text-sm ${
                                  d === currentDateStr
                                    ? "border-red-300 bg-red-50 font-semibold text-red-700"
                                    : "border-gray-200 bg-white text-gray-700"
                                }`}
                              >
                                {d.slice(8, 10)}
                              </div>
                            ))}
                          </div>
                          {hourRowsToRender.map((h) => (
                            <div
                              key={`row-${h}`}
                              className="grid"
                              style={{
                                gridTemplateColumns: `${hourAxisWidth}px repeat(${hourlyDateColumns.length}, ${computedDayColWidth}px)`,
                              }}
                            >
                              <div
                                className={`border px-2 py-3 text-center text-sm font-semibold ${
                                  h === currentHourStr
                                    ? "border-red-300 bg-red-50 text-red-700"
                                    : "border-gray-200 bg-white text-gray-600"
                                }`}
                              >
                                {h}:00
                              </div>
                              {hourlyDateColumns.map((d) => {
                                const key = `${d}_${h}`;
                                const cell = hourlyByDateHour.get(key);
                                const isCurrentHour = currentHourKey === key;
                                return (
                                  <div
                                    key={`cell-${key}`}
                                    className={`snap-start overflow-hidden border px-1 py-1 text-xs ${
                                      isCurrentHour
                                        ? "border-red-300 bg-red-50"
                                        : "border-gray-200 bg-white"
                                    }`}
                                  >
                                    {cell ? (
                                      <div className="flex flex-col items-center gap-[10px] overflow-hidden">
                                        <div className="flex h-[60px] w-[60px] shrink-0 items-center justify-center text-[40px] leading-none">
                                          {weatherIconFromCode(cell.weatherCode ?? undefined).icon}
                                        </div>
                                        <div className="shrink-0 text-[30px] font-semibold leading-none text-gray-700">
                                          {cell.temp ?? "-"}°
                                        </div>
                                        <div className="shrink-0 text-[30px] leading-none text-gray-500">
                                          {cell.precipitationProb ?? "-"}%
                                        </div>
                                        <div className="w-full truncate text-center text-[14px] leading-tight text-gray-600">
                                          {weatherIconFromCode(cell.weatherCode ?? undefined).label}
                                        </div>
                                      </div>
                                    ) : (
                                      <span className="text-gray-300">-</span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                        </div>
                      </div>
                    )}
                  </div>
              </div>
              {/* <div className="grid gap-4 p-4 lg:grid-cols-2 lg:p-5">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Country
                  </label>
                  <select
                    value={selectedCountryPath}
                    onChange={(e) => setSelectedCountryPath(e.target.value)}
                    disabled={loadingCountries}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-transparent focus:ring-2 focus:ring-[#1F7A4C] disabled:bg-gray-100"
                  >
                    <option value="">
                      {loadingCountries ? "Loading countries..." : "Select a country"}
                    </option>
                    {countries.map((item) => (
                      <option key={`${item.name}-${item.href}`} value={getPathFromHref(item.href)}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    {regionTitle || "Province / City"}
                  </label>
                  <select
                    value={selectedRegionPath}
                    onChange={(e) => setSelectedRegionPath(e.target.value)}
                    disabled={!selectedCountryPath || loadingRegions}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-transparent focus:ring-2 focus:ring-[#1F7A4C] disabled:bg-gray-100 disabled:text-gray-500"
                  >
                    <option value="">
                      {loadingRegions
                        ? "Loading locations..."
                        : !selectedCountryPath
                          ? "Choose country first"
                          : "Select a province/city"}
                    </option>
                    {regions.map((item) => (
                      <option key={`${item.name}-${item.href}`} value={getPathFromHref(item.href)}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="lg:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    {childTitle || "Location"}
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <select
                      value={selectedLeafHref}
                      onChange={(e) => setSelectedLeafHref(e.target.value)}
                      disabled={!selectedRegionPath || loadingChild || leafLocations.length === 0}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-transparent focus:ring-2 focus:ring-[#1F7A4C] disabled:bg-gray-100 disabled:text-gray-500"
                    >
                      <option value="">
                        {!selectedRegionPath
                          ? "Choose province/city first"
                          : loadingChild
                            ? "Loading final locations..."
                            : leafLocations.length > 0
                              ? "Select final location"
                              : "No sub-location, use current province/city"}
                      </option>
                      {leafLocations.map((item) => (
                        <option key={`${item.name}-${item.href}`} value={item.href}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!selectedLeafHref || resolvingLink}
                      onClick={() => void resolveRedirectLink(selectedLeafHref)}
                      className="rounded-lg bg-[#1F7A4C] px-4 py-2 text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {resolvingLink ? "Resolving..." : "Resolve location"}
                    </button>
                  </div>
                </div>
              </div>
              <div className="border-t border-gray-100 p-4 lg:p-5">
                <p className="mb-2 text-sm font-medium text-gray-700">
                  AccuWeather (backup source)
                </p>
                {error ? (
                  <p className="text-sm text-red-600">Loi: {error}</p>
                ) : loadingRegions || loadingChild ? (
                  <p className="text-sm text-gray-600">Dang tai danh sach dia diem...</p>
                ) : leafLocations.length > 0 ? (
                  <>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {leafLocations.map((item) => (
                        <button
                          key={`${item.name}-${item.href}`}
                          type="button"
                          onClick={() => {
                            setSelectedLeafHref(item.href);
                            void resolveRedirectLink(item.href);
                          }}
                          className="rounded-lg border border-gray-200 px-3 py-2 text-left text-sm text-[#1F7A4C] hover:bg-[#F4FBF7]"
                        >
                          {item.name}
                        </button>
                      ))}
                    </div>
                    <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <p className="text-xs font-medium text-gray-700">
                        Redirected final link
                      </p>
                      {resolvingLink ? (
                        <p className="mt-1 text-sm text-gray-600">Dang resolve link...</p>
                      ) : resolvedFinalUrl ? (
                        <>
                          <a
                            href={resolvedFinalUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 block break-all text-sm text-[#1F7A4C] underline"
                          >
                            {resolvedFinalUrl}
                          </a>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {[
                              { key: "today", label: "Today" },
                              { key: "hours", label: "Hours" },
                              { key: "10days", label: "10 Days" },
                              { key: "monthly", label: "Monthly" },
                            ].map((tab) => (
                              <button
                                key={tab.key}
                                type="button"
                                onClick={() => {
                                  setActiveForecastTab(
                                    tab.key as "today" | "hours" | "10days" | "monthly",
                                  );
                                  if (tab.key === "today") {
                                    void loadTodayHtmlFromFinalUrl();
                                  }
                                }}
                                className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                                  activeForecastTab === tab.key
                                    ? "bg-[#1F7A4C] text-white"
                                    : "bg-white text-gray-700 border border-gray-300"
                                }`}
                              >
                                {tab.label}
                              </button>
                            ))}
                          </div>
                          {activeForecastTab === "today" ? (
                            <div className="mt-3">
                              {loadingTodayHtml ? (
                                <p className="text-sm text-gray-600">Dang tai Today HTML...</p>
                              ) : todayHtml ? (
                                <pre className="max-h-[440px] overflow-auto rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-700 whitespace-pre-wrap">
                                  {todayHtml}
                                </pre>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => void loadTodayHtmlFromFinalUrl()}
                                  className="rounded-md bg-[#1F7A4C] px-3 py-1.5 text-xs font-medium text-white"
                                >
                                  Load today HTML
                                </button>
                              )}
                            </div>
                          ) : (
                            <p className="mt-3 text-xs text-gray-500">
                              Tab {activeForecastTab} se lam tiep sau. Hien tai moi ho tro Today.
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="mt-1 text-sm text-gray-500">
                          Chon mot dia diem de lay link redirect cuoi cung.
                        </p>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-gray-600">
                    {childTitle
                      ? `Khong co du lieu ben trong ${childTitle}.`
                      : "Chon country va location de goi du lieu."}
                  </p>
                )}
              </div> */}
            </div>
          </div>
        </div>
      </DashboardLayout>
    </RequireAuth>
  );
}
