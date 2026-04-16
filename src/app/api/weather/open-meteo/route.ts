import { NextResponse } from "next/server";
import mysql from "mysql2/promise";

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

function getPool() {
  const host = process.env.STS_DB_HOST;
  const user = process.env.STS_DB_USER;
  const password = process.env.STS_DB_PASSWORD;
  const database = process.env.STS_DB_NAME;
  const port = Number.parseInt(process.env.STS_DB_PORT ?? "3306", 10);
  if (!host || !user || !database) {
    throw new Error("Missing DB env: STS_DB_HOST, STS_DB_USER, STS_DB_NAME");
  }
  return mysql.createPool({
    host,
    user,
    password,
    database,
    port,
    connectionLimit: 5,
    charset: "utf8mb4",
  });
}

async function ensureSummaryTable(pool: mysql.Pool) {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS sts_open_meteo_daily_summaries (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      run_date DATE NOT NULL,
      target_date DATE NOT NULL,
      location_id VARCHAR(64) NOT NULL,
      location_label VARCHAR(255) NOT NULL,
      avg_temperature_c DECIMAL(5,2) NULL,
      precipitation_mm DECIMAL(8,2) NOT NULL DEFAULT 0,
      precipitation_probability_max_pct DECIMAL(5,2) NULL,
      rain_level VARCHAR(32) NOT NULL,
      weather_code INT NULL,
      created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_open_meteo_run_target_loc (run_date, target_date, location_id),
      KEY idx_open_meteo_target_loc (target_date, location_id),
      KEY idx_open_meteo_run_date (run_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensureDetailTables(pool: mysql.Pool) {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS sts_open_meteo_today_snapshots (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      run_date DATE NOT NULL,
      location_id VARCHAR(64) NOT NULL,
      location_label VARCHAR(255) NOT NULL,
      observed_time DATETIME NULL,
      temperature_c DECIMAL(5,2) NULL,
      apparent_temperature_c DECIMAL(5,2) NULL,
      humidity_pct DECIMAL(5,2) NULL,
      precipitation_mm DECIMAL(8,2) NULL,
      wind_speed_kmh DECIMAL(6,2) NULL,
      weather_code INT NULL,
      weather_icon VARCHAR(16) NULL,
      weather_label VARCHAR(255) NULL,
      raw_current_json LONGTEXT NULL,
      created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_open_meteo_today_run_loc (run_date, location_id),
      KEY idx_open_meteo_today_run_date (run_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS sts_open_meteo_hourly_entries (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      run_date DATE NOT NULL,
      location_id VARCHAR(64) NOT NULL,
      location_label VARCHAR(255) NOT NULL,
      forecast_time DATETIME NOT NULL,
      temperature_c DECIMAL(5,2) NULL,
      humidity_pct DECIMAL(5,2) NULL,
      precipitation_probability_pct DECIMAL(5,2) NULL,
      weather_code INT NULL,
      weather_icon VARCHAR(16) NULL,
      weather_label VARCHAR(255) NULL,
      created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_open_meteo_hourly_run_time_loc (run_date, location_id, forecast_time),
      KEY idx_open_meteo_hourly_time_loc (forecast_time, location_id),
      KEY idx_open_meteo_hourly_run_date (run_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS sts_open_meteo_monthly_summaries (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      run_month CHAR(7) NOT NULL,
      location_id VARCHAR(64) NOT NULL,
      location_label VARCHAR(255) NOT NULL,
      avg_temperature_c DECIMAL(5,2) NULL,
      min_temperature_c DECIMAL(5,2) NULL,
      max_temperature_c DECIMAL(5,2) NULL,
      total_precipitation_mm DECIMAL(10,2) NOT NULL DEFAULT 0,
      rainy_days_count INT UNSIGNED NOT NULL DEFAULT 0,
      created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_open_meteo_month_loc (run_month, location_id),
      KEY idx_open_meteo_month (run_month)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function persistSummaries(
  summaries: Array<{
    locationId: string;
    locationLabel: string;
    date: string | null;
    avgTemperatureC: number | null;
    precipitationMm: number;
    precipitationProbabilityMaxPct: number | null;
    rainLevel: string;
    weatherCode: number | null;
  }>,
  retentionDays: number,
) {
  const pool = getPool();
  const today = new Date().toISOString().slice(0, 10);
  try {
    await ensureSummaryTable(pool);
    for (const item of summaries) {
      if (!item.date) continue;
      await pool.execute(
        `INSERT INTO sts_open_meteo_daily_summaries
         (run_date, target_date, location_id, location_label, avg_temperature_c, precipitation_mm,
          precipitation_probability_max_pct, rain_level, weather_code)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          location_label = VALUES(location_label),
          avg_temperature_c = VALUES(avg_temperature_c),
          precipitation_mm = VALUES(precipitation_mm),
          precipitation_probability_max_pct = VALUES(precipitation_probability_max_pct),
          rain_level = VALUES(rain_level),
          weather_code = VALUES(weather_code)`,
        [
          today,
          item.date,
          item.locationId,
          item.locationLabel,
          item.avgTemperatureC,
          item.precipitationMm,
          item.precipitationProbabilityMaxPct,
          item.rainLevel,
          item.weatherCode,
        ],
      );
    }
    await pool.execute(
      `DELETE FROM sts_open_meteo_daily_summaries
       WHERE run_date < DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
      [retentionDays],
    );
  } finally {
    await pool.end();
  }
}

async function persistTodayHourlyMonthly(
  results: Array<{
    location: { id: string; label: string };
    data: OpenMeteoPayload;
  }>,
  retentionDays: number,
) {
  const pool = getPool();
  const today = new Date().toISOString().slice(0, 10);
  try {
    await ensureDetailTables(pool);

    for (const result of results) {
      const current = result.data.current ?? {};
      const currentIcon = weatherIconFromCode(current.weather_code);
      await pool.execute(
        `INSERT INTO sts_open_meteo_today_snapshots
         (run_date, location_id, location_label, observed_time, temperature_c, apparent_temperature_c,
          humidity_pct, precipitation_mm, wind_speed_kmh, weather_code, weather_icon, weather_label, raw_current_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          location_label = VALUES(location_label),
          observed_time = VALUES(observed_time),
          temperature_c = VALUES(temperature_c),
          apparent_temperature_c = VALUES(apparent_temperature_c),
          humidity_pct = VALUES(humidity_pct),
          precipitation_mm = VALUES(precipitation_mm),
          wind_speed_kmh = VALUES(wind_speed_kmh),
          weather_code = VALUES(weather_code),
          weather_icon = VALUES(weather_icon),
          weather_label = VALUES(weather_label),
          raw_current_json = VALUES(raw_current_json)`,
        [
          today,
          result.location.id,
          result.location.label,
          current.time ?? null,
          current.temperature_2m ?? null,
          current.apparent_temperature ?? null,
          current.relative_humidity_2m ?? null,
          current.precipitation ?? null,
          current.wind_speed_10m ?? null,
          current.weather_code ?? null,
          currentIcon.icon,
          currentIcon.label,
          JSON.stringify(current),
        ],
      );

      const hourly = result.data.hourly ?? {};
      const hourlyTimes = hourly.time ?? [];
      for (let i = 0; i < hourlyTimes.length; i += 1) {
        const code = hourly.weather_code?.[i] ?? null;
        const icon = weatherIconFromCode(code);
        await pool.execute(
          `INSERT INTO sts_open_meteo_hourly_entries
           (run_date, location_id, location_label, forecast_time, temperature_c, humidity_pct,
            precipitation_probability_pct, weather_code, weather_icon, weather_label)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
            location_label = VALUES(location_label),
            temperature_c = VALUES(temperature_c),
            humidity_pct = VALUES(humidity_pct),
            precipitation_probability_pct = VALUES(precipitation_probability_pct),
            weather_code = VALUES(weather_code),
            weather_icon = VALUES(weather_icon),
            weather_label = VALUES(weather_label)`,
          [
            today,
            result.location.id,
            result.location.label,
            hourlyTimes[i],
            hourly.temperature_2m?.[i] ?? null,
            hourly.relative_humidity_2m?.[i] ?? null,
            hourly.precipitation_probability?.[i] ?? null,
            code,
            icon.icon,
            icon.label,
          ],
        );
      }

      const daily = result.data.daily ?? {};
      const dailyDates = daily.time ?? [];
      const byMonth = new Map<
        string,
        {
          min: number | null;
          max: number | null;
          sumAvg: number;
          countAvg: number;
          totalPrecip: number;
          rainyDays: number;
        }
      >();

      for (let i = 0; i < dailyDates.length; i += 1) {
        const date = dailyDates[i];
        if (!date) continue;
        const monthKey = date.slice(0, 7);
        const min = daily.temperature_2m_min?.[i] ?? null;
        const max = daily.temperature_2m_max?.[i] ?? null;
        const precip = daily.precipitation_sum?.[i] ?? 0;
        const avg = typeof min === "number" && typeof max === "number" ? (min + max) / 2 : null;
        const currentMonth = byMonth.get(monthKey) ?? {
          min: null,
          max: null,
          sumAvg: 0,
          countAvg: 0,
          totalPrecip: 0,
          rainyDays: 0,
        };
        if (typeof min === "number") {
          currentMonth.min =
            currentMonth.min == null ? min : Math.min(currentMonth.min, min);
        }
        if (typeof max === "number") {
          currentMonth.max =
            currentMonth.max == null ? max : Math.max(currentMonth.max, max);
        }
        if (typeof avg === "number") {
          currentMonth.sumAvg += avg;
          currentMonth.countAvg += 1;
        }
        currentMonth.totalPrecip += precip;
        if (precip > 0) currentMonth.rainyDays += 1;
        byMonth.set(monthKey, currentMonth);
      }

      for (const [runMonth, item] of byMonth) {
        const avgTemperature =
          item.countAvg > 0 ? Number((item.sumAvg / item.countAvg).toFixed(2)) : null;
        await pool.execute(
          `INSERT INTO sts_open_meteo_monthly_summaries
           (run_month, location_id, location_label, avg_temperature_c, min_temperature_c,
            max_temperature_c, total_precipitation_mm, rainy_days_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
            location_label = VALUES(location_label),
            avg_temperature_c = VALUES(avg_temperature_c),
            min_temperature_c = VALUES(min_temperature_c),
            max_temperature_c = VALUES(max_temperature_c),
            total_precipitation_mm = VALUES(total_precipitation_mm),
            rainy_days_count = VALUES(rainy_days_count)`,
          [
            runMonth,
            result.location.id,
            result.location.label,
            avgTemperature,
            item.min,
            item.max,
            Number(item.totalPrecip.toFixed(2)),
            item.rainyDays,
          ],
        );
      }
    }

    await pool.execute(
      `DELETE FROM sts_open_meteo_today_snapshots
       WHERE run_date < DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
      [retentionDays],
    );
    await pool.execute(
      `DELETE FROM sts_open_meteo_hourly_entries
       WHERE run_date < DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
      [retentionDays],
    );
    await pool.execute(
      `DELETE FROM sts_open_meteo_monthly_summaries
       WHERE run_month < DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL ? DAY), '%Y-%m')`,
      [retentionDays],
    );
  } finally {
    await pool.end();
  }
}

async function fetchOpenMeteoFromDb(location: LocationPreset, forecastDays: number) {
  const pool = getPool();
  try {
    const [runRows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT run_date
       FROM sts_open_meteo_today_snapshots
       WHERE location_id = ?
       ORDER BY run_date DESC
       LIMIT 1`,
      [location.id],
    );
    const latestRunDate = runRows[0]?.run_date as string | undefined;
    if (!latestRunDate) {
      throw new Error(`No DB weather data for ${location.id}`);
    }

    const [todayRows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT observed_time, temperature_c, apparent_temperature_c, humidity_pct, precipitation_mm, weather_code, wind_speed_kmh
       FROM sts_open_meteo_today_snapshots
       WHERE location_id = ? AND run_date = ?
       ORDER BY id DESC
       LIMIT 1`,
      [location.id, latestRunDate],
    );
    const today = todayRows[0] ?? {};

    const [hourlyRows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT forecast_time, temperature_c, humidity_pct, precipitation_probability_pct, weather_code
       FROM sts_open_meteo_hourly_entries
       WHERE location_id = ? AND run_date = ?
       ORDER BY forecast_time ASC`,
      [location.id, latestRunDate],
    );

    const [dailyRows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT target_date, avg_temperature_c, precipitation_mm, precipitation_probability_max_pct, weather_code
       FROM sts_open_meteo_daily_summaries
       WHERE location_id = ? AND run_date = ?
       ORDER BY target_date ASC
       LIMIT ?`,
      [location.id, latestRunDate, forecastDays],
    );

    const [monthlyRows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT run_month, avg_temperature_c, min_temperature_c, max_temperature_c, total_precipitation_mm, rainy_days_count
       FROM sts_open_meteo_monthly_summaries
       WHERE location_id = ?
       ORDER BY run_month DESC
       LIMIT 6`,
      [location.id],
    );

    const dailyTimes = dailyRows.map((r) => String(r.target_date));
    const dailyMax = dailyRows.map((r) => {
      const avg = Number(r.avg_temperature_c ?? 0);
      return Number.isFinite(avg) ? avg : null;
    });
    const dailyMin = dailyRows.map((r) => {
      const avg = Number(r.avg_temperature_c ?? 0);
      return Number.isFinite(avg) ? avg : null;
    });

    return {
      location: {
        id: location.id,
        label: location.label,
        latitude: location.latitude,
        longitude: location.longitude,
        timezone: location.timezone,
      },
      source: `db:${latestRunDate}`,
      dbMonthly: monthlyRows,
      data: {
        current: {
          time: today.observed_time ? String(today.observed_time) : undefined,
          temperature_2m: today.temperature_c != null ? Number(today.temperature_c) : undefined,
          relative_humidity_2m: today.humidity_pct != null ? Number(today.humidity_pct) : undefined,
          apparent_temperature: today.apparent_temperature_c != null ? Number(today.apparent_temperature_c) : undefined,
          precipitation: today.precipitation_mm != null ? Number(today.precipitation_mm) : undefined,
          weather_code: today.weather_code != null ? Number(today.weather_code) : undefined,
          wind_speed_10m: today.wind_speed_kmh != null ? Number(today.wind_speed_kmh) : undefined,
        },
        hourly: {
          time: hourlyRows.map((r) => String(r.forecast_time)),
          temperature_2m: hourlyRows.map((r) => (r.temperature_c != null ? Number(r.temperature_c) : null)),
          relative_humidity_2m: hourlyRows.map((r) => (r.humidity_pct != null ? Number(r.humidity_pct) : null)),
          precipitation_probability: hourlyRows.map((r) =>
            r.precipitation_probability_pct != null ? Number(r.precipitation_probability_pct) : null,
          ),
          weather_code: hourlyRows.map((r) => (r.weather_code != null ? Number(r.weather_code) : null)),
        },
        daily: {
          time: dailyTimes,
          temperature_2m_max: dailyMax,
          temperature_2m_min: dailyMin,
          precipitation_sum: dailyRows.map((r) => (r.precipitation_mm != null ? Number(r.precipitation_mm) : null)),
          precipitation_probability_max: dailyRows.map((r) =>
            r.precipitation_probability_max_pct != null ? Number(r.precipitation_probability_max_pct) : null,
          ),
          weather_code: dailyRows.map((r) => (r.weather_code != null ? Number(r.weather_code) : null)),
        },
      } satisfies OpenMeteoPayload,
    };
  } finally {
    await pool.end();
  }
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
  const persist = (searchParams.get("persist") ?? "").trim() === "1";
  const retentionDaysRaw = Number.parseInt(searchParams.get("retentionDays") ?? "60", 10);
  const retentionDays = Number.isFinite(retentionDaysRaw)
    ? Math.min(Math.max(retentionDaysRaw, 1), 365)
    : 60;
  const fromDb =
    (searchParams.get("fromDb") ?? "").trim() === "1" ||
    (searchParams.get("source") ?? "").trim().toLowerCase() === "db";

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
      const result = fromDb
        ? await fetchOpenMeteoFromDb(location, forecastDays)
        : await fetchOpenMeteo(location, forecastDays);
      if (summaryOnly) {
        const daily = ((result.data as { daily?: OpenMeteoDailyData }).daily ?? {}) as OpenMeteoDailyData;
        const maxDayIndex = Math.max((daily.time?.length ?? 1) - 1, 0);
        const selectedDayIndex = Math.min(dayIndex, maxDayIndex);
        const summary = buildDailySummary(location, daily, selectedDayIndex);
        if (persist) {
          await persistSummaries([summary], retentionDays);
          await persistTodayHourlyMonthly(
            [{ location: { id: result.location.id, label: result.location.label }, data: result.data }],
            retentionDays,
          );
        }
        return NextResponse.json(
          {
            success: true,
            persisted: persist,
            retentionDays,
            summary,
          },
          { status: 200 },
        );
      }
      if (persist) {
        await persistTodayHourlyMonthly(
          [{ location: { id: result.location.id, label: result.location.label }, data: result.data }],
          retentionDays,
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
      if (persist) {
        await persistSummaries(summaries, retentionDays);
        await persistTodayHourlyMonthly(
          results.map((item) => ({
            location: { id: item.location.id, label: item.location.label },
            data: item.data,
          })),
          retentionDays,
        );
      }
      return NextResponse.json(
        {
          success: true,
          persisted: persist,
          retentionDays,
          count: summaries.length,
          dayIndex,
          summaries,
        },
        { status: 200 },
      );
    }
    if (persist) {
      await persistTodayHourlyMonthly(
        results.map((item) => ({
          location: { id: item.location.id, label: item.location.label },
          data: item.data,
        })),
        retentionDays,
      );
    }
    return NextResponse.json(
      {
        success: true,
        persisted: persist,
        retentionDays,
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
