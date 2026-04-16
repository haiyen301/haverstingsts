import { NextResponse } from "next/server";

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";

type LocationPreset = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  timezone: string;
};

type OpenMeteoDailyData = {
  time?: string[];
  temperature_2m_max?: number[];
  temperature_2m_min?: number[];
  precipitation_sum?: number[];
  precipitation_probability_max?: number[];
  weather_code?: number[];
};

type OpenMeteoCurrentData = {
  time?: string;
  temperature_2m?: number;
  relative_humidity_2m?: number;
  apparent_temperature?: number;
  precipitation?: number;
  weather_code?: number;
  wind_speed_10m?: number;
};

type OpenMeteoHourlyData = {
  time?: string[];
  temperature_2m?: number[];
  relative_humidity_2m?: number[];
  precipitation_probability?: number[];
  weather_code?: number[];
};

type OpenMeteoPayload = {
  current?: OpenMeteoCurrentData;
  hourly?: OpenMeteoHourlyData;
  daily?: OpenMeteoDailyData;
};

const LOCATION_PRESETS: LocationPreset[] = [
  {
    id: "ban-bueng-th",
    label: "Ban Bueng, Thailand",
    latitude: 13.25,
    longitude: 101.0,
    timezone: "Asia/Bangkok",
  },
  {
    id: "laem-chabang-th",
    label: "Laem Chabang, Thailand",
    latitude: 13.088,
    longitude: 100.883,
    timezone: "Asia/Bangkok",
  },
  {
    id: "semenyih-my",
    label: "Semenyih, Malaysia",
    latitude: 2.95,
    longitude: 101.85,
    timezone: "Asia/Kuala_Lumpur",
  },
  {
    id: "hoi-an-vn",
    label: "Hoi An, Vietnam",
    latitude: 15.88,
    longitude: 108.33,
    timezone: "Asia/Ho_Chi_Minh",
  },
  {
    id: "phan-thiet-vn",
    label: "Phan Thiet, Vietnam",
    latitude: 10.93,
    longitude: 108.1,
    timezone: "Asia/Ho_Chi_Minh",
  },
];

function getLocationById(id: string): LocationPreset | null {
  return LOCATION_PRESETS.find((item) => item.id === id) ?? null;
}

function buildOpenMeteoUrl(location: LocationPreset, forecastDays: number): string {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    timezone: location.timezone,
    current: [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "precipitation",
      "weather_code",
      "wind_speed_10m",
    ].join(","),
    hourly:
      "temperature_2m,relative_humidity_2m,precipitation_probability,weather_code",
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max",
    forecast_days: String(forecastDays),
  });
  return `${OPEN_METEO_URL}?${params.toString()}`;
}

async function fetchOpenMeteo(location: LocationPreset, forecastDays: number) {
  const upstreamUrl = buildOpenMeteoUrl(location, forecastDays);
  const res = await fetch(upstreamUrl, {
    cache: "no-store",
    headers: {
      accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Open-Meteo upstream responded with ${res.status}`);
  }
  const payload = (await res.json()) as OpenMeteoPayload;
  return {
    location: {
      id: location.id,
      label: location.label,
      latitude: location.latitude,
      longitude: location.longitude,
      timezone: location.timezone,
    },
    source: upstreamUrl,
    data: payload,
  };
}

function classifyRain(precipitationMm: number): string {
  if (precipitationMm <= 0) return "no_rain";
  if (precipitationMm <= 2) return "light_rain";
  if (precipitationMm <= 10) return "moderate_rain";
  return "heavy_rain";
}

function weatherIconFromCode(code: number | null | undefined): { icon: string; label: string } {
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
  if (code === 95) return { icon: "⛈️", label: "Thunderstorm" };
  if ([96, 99].includes(code)) return { icon: "⛈️", label: "Thunderstorm with hail" };
  return { icon: "🌡️", label: "Other weather" };
}

function buildDailySummary(
  location: LocationPreset,
  daily: OpenMeteoDailyData,
  dayIndex: number,
) {
  const max = daily.temperature_2m_max?.[dayIndex];
  const min = daily.temperature_2m_min?.[dayIndex];
  const precipitationMm = daily.precipitation_sum?.[dayIndex] ?? 0;
  const precipitationProbability = daily.precipitation_probability_max?.[dayIndex] ?? null;
  const avgTemperatureC =
    typeof max === "number" && typeof min === "number"
      ? Number(((max + min) / 2).toFixed(1))
      : null;
  const weatherCode = daily.weather_code?.[dayIndex] ?? null;
  const weatherIcon = weatherIconFromCode(weatherCode);
  return {
    locationId: location.id,
    locationLabel: location.label,
    date: daily.time?.[dayIndex] ?? null,
    avgTemperatureC,
    precipitationMm,
    precipitationProbabilityMaxPct: precipitationProbability,
    rainLevel: classifyRain(precipitationMm),
    weatherCode,
    weatherIcon: weatherIcon.icon,
    weatherLabel: weatherIcon.label,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const locationId = (searchParams.get("locationId") ?? "").trim();
  const all = (searchParams.get("all") ?? "").trim() === "1";
  const idsRaw = (searchParams.get("locationIds") ?? "").trim();
  const forecastDaysRaw = Number.parseInt(searchParams.get("forecastDays") ?? "7", 10);
  const forecastDays = Number.isFinite(forecastDaysRaw)
    ? Math.min(Math.max(forecastDaysRaw, 1), 16)
    : 7;
  const summaryOnly = (searchParams.get("summary") ?? "").trim() === "1";
  const dayIndexRaw = Number.parseInt(searchParams.get("dayIndex") ?? "0", 10);
  const dayIndex = Number.isFinite(dayIndexRaw) ? Math.max(dayIndexRaw, 0) : 0;

  const token = (searchParams.get("token") ?? searchParams.get("import_token") ?? "").trim();
  const expectedToken = (process.env.OPEN_METEO_PULL_TOKEN ?? "").trim();
  if (expectedToken && token !== expectedToken) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    if (locationId) {
      const location = getLocationById(locationId);
      if (!location) {
        return NextResponse.json(
          {
            success: false,
            error: `Unknown locationId: ${locationId}`,
            availableLocationIds: LOCATION_PRESETS.map((item) => item.id),
          },
          { status: 400 },
        );
      }
      const result = await fetchOpenMeteo(location, forecastDays);
      if (summaryOnly) {
        const daily = ((result.data as { daily?: OpenMeteoDailyData }).daily ?? {}) as OpenMeteoDailyData;
        const maxDayIndex = Math.max((daily.time?.length ?? 1) - 1, 0);
        const selectedDayIndex = Math.min(dayIndex, maxDayIndex);
        const summary = buildDailySummary(location, daily, selectedDayIndex);
        return NextResponse.json(
          {
            success: true,
            summary,
          },
          { status: 200 },
        );
      }
      return NextResponse.json({ success: true, ...result }, { status: 200 });
    }

    const requestedIds = idsRaw
      ? idsRaw
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : [];
    const targetLocations =
      all || requestedIds.length === 0
        ? LOCATION_PRESETS
        : LOCATION_PRESETS.filter((item) => requestedIds.includes(item.id));

    if (targetLocations.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "No valid target location",
          availableLocationIds: LOCATION_PRESETS.map((item) => item.id),
        },
        { status: 400 },
      );
    }

    const results = await Promise.all(
      targetLocations.map((location) => fetchOpenMeteo(location, forecastDays)),
    );
    if (summaryOnly) {
      const summaries = results.map((result) => {
        const location = targetLocations.find((item) => item.id === result.location.id) ?? targetLocations[0];
        const daily = ((result.data as { daily?: OpenMeteoDailyData }).daily ?? {}) as OpenMeteoDailyData;
        const maxDayIndex = Math.max((daily.time?.length ?? 1) - 1, 0);
        const selectedDayIndex = Math.min(dayIndex, maxDayIndex);
        return buildDailySummary(location, daily, selectedDayIndex);
      });
      return NextResponse.json(
        {
          success: true,
          count: summaries.length,
          dayIndex,
          summaries,
        },
        { status: 200 },
      );
    }
    return NextResponse.json(
      {
        success: true,
        count: results.length,
        forecastDays,
        results,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch Open-Meteo",
      },
      { status: 500 },
    );
  }
}
