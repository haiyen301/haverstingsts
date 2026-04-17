"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import RequireAuth from "@/features/auth/RequireAuth";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

type PresetLocation = {
  id: string;
  label: string;
};

const PRESET_LOCATIONS: PresetLocation[] = [
  {
    id: "ban-bueng-th",
    label: "Ban Bueng, Thailand",
  },
  {
    id: "laem-chabang-th",
    label: "Laem Chabang, Thailand",
  },
  {
    id: "semenyih-my",
    label: "Semenyih, Malaysia",
  },
  {
    id: "hoi-an-vn",
    label: "Hoi An, Vietnam",
  },
  {
    id: "phan-thiet-vn",
    label: "Phan Thiet, Vietnam",
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

export default function WeatherPage() {
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [loadingOpenMeteo, setLoadingOpenMeteo] = useState(false);
  const [openMeteoError, setOpenMeteoError] = useState<string | null>(null);
  const [openMeteoData, setOpenMeteoData] = useState<OpenMeteoResponse | null>(null);
  const [showAllHours, setShowAllHours] = useState(false);
  const timelineViewportRef = useRef<HTMLDivElement | null>(null);
  const pageContentRef = useRef<HTMLDivElement | null>(null);
  const lockedMainWidthRef = useRef<number | null>(null);
  const lastWindowInnerWidthRef = useRef(0);
  const isResizingRef = useRef(false);
  const resizeStopTimerRef = useRef<number | null>(null);
  const [mainWidth, setMainWidth] = useState(0);
  const [lockedMainWidth, setLockedMainWidth] = useState(0);
  const [screenWidth, setScreenWidth] = useState(0);
  const [jsNowMs, setJsNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (selectedPresetId || loadingOpenMeteo) return;
    const first = PRESET_LOCATIONS[0];
    if (!first) return;
    handleSelectPreset(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectPreset = (preset: PresetLocation) => {
    setSelectedPresetId(preset.id);
    setOpenMeteoError(null);
    setOpenMeteoData(null);
    setShowAllHours(false);
    void loadOpenMeteoForecast(preset);
  };

  const loadOpenMeteoForecast = async (preset: PresetLocation) => {
    setLoadingOpenMeteo(true);
    setOpenMeteoError(null);
    try {
      const qs = new URLSearchParams({
        locationId: preset.id,
        forecastDays: "16",
      });
      const res = await fetch(
        `/api/weather/db_open_meteo?${qs.toString()}`,
        {
          cache: "no-store",
          credentials: "same-origin",
        },
      );
      if (!res.ok) {
        throw new Error(`STSPortal weather fetch failed (${res.status})`);
      }
      const payload = (await res.json()) as {
        success?: boolean;
        data?: OpenMeteoResponse | null;
        message?: string;
        error?: string;
      };
      if (!payload.success || !payload.data) {
        throw new Error(payload.message ?? payload.error ?? "Open-Meteo response invalid");
      }
      setOpenMeteoData(payload.data);
    } catch (err) {
      setOpenMeteoData(null);
      setOpenMeteoError(err instanceof Error ? err.message : "Load Open-Meteo failed.");
    } finally {
      setLoadingOpenMeteo(false);
    }
  };

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
      const measuredMainWidth =
        viewportWidth > 0 ? viewportWidth : Math.max(contentClientWidth, contentRectWidth, 0);
      const windowWidthChanged =
        lastWindowInnerWidthRef.current !== 0 &&
        lastWindowInnerWidthRef.current !== window.innerWidth;
      const shouldLock = lockedMainWidthRef.current == null || (relock && windowWidthChanged);
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
      setScreenWidth(window.innerWidth);
    };

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
    [timelineContainerWidth],
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
                Weather
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
                      Open-Meteo error: {openMeteoError}
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
                                       
                                        <div className="w-full truncate text-center text-[16px] leading-tight text-gray-600">
                                          {weatherIconFromCode(cell.weatherCode ?? undefined).label}
                                        </div>
                                        <div className="shrink-0 text-[14px] leading-none text-gray-500">
                                          Rain: {cell.precipitationProb ?? "-"}%
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
            </div>
          </div>
        </div>
      </DashboardLayout>
    </RequireAuth>
  );
}
