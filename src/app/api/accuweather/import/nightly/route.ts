import { NextResponse } from "next/server";
import mysql from "mysql2/promise";

const ACCUWEATHER_BASE_URL = "https://www.accuweather.com";
const DEFAULT_LOCATION = "/en/vn/nghi-son-1/419668";
const DEFAULT_MONTH_START = "/en/vn/nghi-son-1/419668/april-weather/419668";
const MAX_DAILY_DAY = 16;
const MAX_MONTH_PAGES = 4; // current + next months

type ImportStats = {
  todaySnapshots: number;
  hourlySnapshots: number;
  hourlyEntries: number;
  monthlySnapshots: number;
  monthlyEntries: number;
};

function stripTags(raw: string): string {
  return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHtml(raw: string): string {
  return raw
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&nbsp;", " ")
    .trim();
}

function normalizeUrl(value: string): string {
  const cleaned = decodeHtml(value).trim();
  if (!cleaned) return "";
  if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) return cleaned;
  if (cleaned.startsWith("/")) return `${ACCUWEATHER_BASE_URL}${cleaned}`;
  return `${ACCUWEATHER_BASE_URL}/${cleaned}`;
}

function parseLocationMeta(url: string) {
  // /en/vn/nghi-son-1/419668/...
  const match = url.match(/\/([a-z]{2})\/([a-z]{2})\/([^/]+)\/(\d+)\//i);
  return {
    locale: match?.[1]?.toLowerCase() ?? "en",
    countryCode: match?.[2]?.toLowerCase() ?? "vn",
    locationName: match?.[3] ? match[3].replace(/-/g, " ") : null,
    locationKey: match?.[4] ?? null,
  };
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en,vi;q=0.9",
      referer: ACCUWEATHER_BASE_URL,
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${url}`);
  return res.text();
}

function parseCurrentDetailsMap(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const detailRegex =
    /<div class="detail-item spaced-content">\s*<div>([\s\S]*?)<\/div>\s*<div>([\s\S]*?)<\/div>\s*<\/div>/gi;
  for (const match of html.matchAll(detailRegex)) {
    const key = decodeHtml(stripTags(match[1] ?? ""));
    const value = decodeHtml(stripTags(match[2] ?? ""));
    if (key) out[key] = value;
  }
  return out;
}

function parseTodayPayload(html: string, sourceUrl: string) {
  const icon =
    html.match(/<img class="icon" src="([^"]+)" width="62" height="62">/i)?.[1] ?? "";
  const phrase = decodeHtml(
    stripTags(html.match(/<div class="current-weather[^>]*>[\s\S]*?<div class="phrase">([\s\S]*?)<\/div>/i)?.[1] ?? ""),
  );
  const observedTime = decodeHtml(
    stripTags(html.match(/<p class="sub">([\s\S]*?)<\/p>/i)?.[1] ?? ""),
  );
  const temp = decodeHtml(stripTags(html.match(/<div class="display-temp">([\s\S]*?)<\/div>/i)?.[1] ?? ""));
  const realFeel = decodeHtml(
    stripTags(html.match(/RealFeel®\s*([0-9]+°)/i)?.[1] ?? ""),
  );
  const realFeelShade = decodeHtml(
    stripTags(html.match(/RealFeel Shade™\s*([0-9]+°)/i)?.[1] ?? ""),
  );
  const currentDetails = parseCurrentDetailsMap(html);
  const furtherLinks: Record<string, string> = {};
  for (const m of html.matchAll(/<a href="([^"]+)" class="cta-link"[\s\S]*?<h3 class="cta-text">([\s\S]*?)<\/h3>/gi)) {
    const key = decodeHtml(stripTags(m[2] ?? ""));
    const href = normalizeUrl(m[1] ?? "");
    if (key && href) furtherLinks[key] = href;
  }

  return {
    sourceUrl,
    weatherPhrase: phrase || null,
    observedTimeLabel: observedTime || null,
    temperatureText: temp || null,
    realFeelText: realFeel || null,
    realFeelShadeText: realFeelShade || null,
    weatherIconUrl: icon ? normalizeUrl(icon) : null,
    currentDetails,
    furtherLinks,
  };
}

function parseHourlyPayload(html: string) {
  const wrapperMatch = html.match(/<div class="hourly-wrapper content-module">([\s\S]*?)<\/div>\s*<script>/i);
  const wrapper = wrapperMatch?.[1] ?? html;
  const startMatches = [...wrapper.matchAll(/<div id="(\d+)"[^>]*class="accordion-item hour[^"]*"[^>]*>/g)];
  const entries: Array<Record<string, unknown>> = [];
  for (let i = 0; i < startMatches.length; i += 1) {
    const start = startMatches[i].index ?? 0;
    const end = i + 1 < startMatches.length ? (startMatches[i + 1].index ?? wrapper.length) : wrapper.length;
    const chunk = wrapper.slice(start, end);
    const epoch = Number.parseInt(startMatches[i][1] ?? "", 10);
    const timeLabel = decodeHtml(stripTags(chunk.match(/<h2 class="date">\s*<div>([\s\S]*?)<\/div>/i)?.[1] ?? ""));
    const icon = chunk.match(/<img class="icon" src="([^"]+)"/i)?.[1] ?? "";
    const temp = decodeHtml(stripTags(chunk.match(/<div class="temp metric">([\s\S]*?)<\/div>/i)?.[1] ?? ""));
    const realFeel = decodeHtml(stripTags(chunk.match(/RealFeel®\s*([0-9]+°)/i)?.[1] ?? ""));
    const phrase = decodeHtml(stripTags(chunk.match(/<div class="phrase">([\s\S]*?)<\/div>/i)?.[1] ?? ""));
    const precip = decodeHtml(stripTags(chunk.match(/<div class="precip">([\s\S]*?)<\/div>/i)?.[1] ?? "")).match(/([0-9]+%)/)?.[1] ?? "";

    const panelBlocks = [...chunk.matchAll(/<div class="panel[^"]*">([\s\S]*?)<\/div>/gi)];
    const parsePanel = (panelHtml: string) => {
      const out: Record<string, string> = {};
      for (const p of panelHtml.matchAll(/<p>([\s\S]*?)<span class="value">([\s\S]*?)<\/span><\/p>/gi)) {
        const key = decodeHtml(stripTags(p[1] ?? ""));
        const value = decodeHtml(stripTags(p[2] ?? ""));
        if (key) out[key] = value;
      }
      return out;
    };
    const headlinePanel = parsePanel(panelBlocks[0]?.[1] ?? "");
    const detailPanel = parsePanel(panelBlocks[1]?.[1] ?? "");

    entries.push({
      forecastEpoch: Number.isFinite(epoch) ? epoch : null,
      forecastTimeLabel: timeLabel || null,
      temperatureText: temp || null,
      realFeelText: realFeel || null,
      phrase: phrase || null,
      precipitationProbabilityText: precip || null,
      iconUrl: icon ? normalizeUrl(icon) : null,
      realFeelShadeText: headlinePanel["RealFeel Shade™"] ?? null,
      airQualityText: headlinePanel["Air Quality"] ?? null,
      headlinePanel,
      detailPanel,
    });
  }
  return { entries };
}

function parseMonthlyPayload(html: string, sourceUrl: string) {
  const monthLabel = decodeHtml(stripTags(html.match(/<div class="map-dropdown-toggle">\s*<h2>([\s\S]*?)<\/h2>/i)?.[1] ?? ""));
  const yearLabel = decodeHtml(
    stripTags(
      html.match(/<div class="map-dropdown-toggle">\s*<h2>[\s\S]*?<\/h2>[\s\S]*?<div class="map-dropdown-toggle">\s*<h2>([\s\S]*?)<\/h2>/i)?.[1] ?? "",
    ),
  );
  const dayEntries: Array<Record<string, unknown>> = [];
  const calendarMatch = html.match(/<div class="monthly-calendar">([\s\S]*?)<\/div>\s*<\/div>/i);
  const calendarHtml = calendarMatch?.[1] ?? "";
  const dayRegex = /<a class="monthly-daypanel([^"]*)"([^>]*)>([\s\S]*?)<\/a>/gi;
  let index = 0;
  for (const match of calendarHtml.matchAll(dayRegex)) {
    index += 1;
    const classNames = match[1] ?? "";
    const attrs = match[2] ?? "";
    const body = match[3] ?? "";
    const href = attrs.match(/href="([^"]+)"/i)?.[1] ?? "";
    const dayNum = Number.parseInt(decodeHtml(stripTags(body.match(/<div class="date">\s*([\s\S]*?)<\/div>/i)?.[1] ?? "")), 10);
    const high = decodeHtml(stripTags(body.match(/<div class="high[^"]*">\s*([\s\S]*?)<\/div>/i)?.[1] ?? ""));
    const low = decodeHtml(stripTags(body.match(/<div class="low">\s*([\s\S]*?)<\/div>/i)?.[1] ?? ""));
    const iconSrc = body.match(/<img[^>]+src="([^"]+)"/i)?.[1] ?? "";
    const iconAlt = decodeHtml(body.match(/<img[^>]+alt="([^"]*)"/i)?.[1] ?? "");
    dayEntries.push({
      gridIndex: index,
      dayNumber: Number.isFinite(dayNum) ? dayNum : null,
      isInCurrentMonth: !classNames.includes(" is-past "),
      isPast: classNames.includes(" is-past "),
      isToday: classNames.includes(" is-today"),
      isNa: /N\/A/i.test(body),
      highTempText: high || null,
      lowTempText: low || null,
      iconUrl: iconSrc ? normalizeUrl(iconSrc) : null,
      iconAlt: iconAlt || null,
      dayDetailUrl: href ? normalizeUrl(href) : null,
    });
  }

  const furtherLinks: Record<string, string> = {};
  for (const m of html.matchAll(/<a href="([^"]+)" class="cta-link"[\s\S]*?<h3 class="cta-text">([\s\S]*?)<\/h3>/gi)) {
    const key = decodeHtml(stripTags(m[2] ?? ""));
    const href = normalizeUrl(m[1] ?? "");
    if (key && href) furtherLinks[key] = href;
  }

  const nextMonthUrl =
    Object.values(furtherLinks).find((link) => /-weather\/\d+(\?year=\d+)?$/i.test(link)) ?? null;

  return {
    sourceUrl,
    monthLabel: monthLabel || null,
    yearValue: Number.parseInt(yearLabel, 10) || null,
    hasYearQuery: sourceUrl.includes("?year="),
    furtherLinks,
    nextMonthUrl,
    dayEntries,
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

async function importAll(locationBasePath: string, monthStartPath: string) {
  const stats: ImportStats = {
    todaySnapshots: 0,
    hourlySnapshots: 0,
    hourlyEntries: 0,
    monthlySnapshots: 0,
    monthlyEntries: 0,
  };
  const pool = getPool();
  try {
    const locationUrl = normalizeUrl(locationBasePath);
    const locationMeta = parseLocationMeta(locationUrl + "/");

    const todayUrls = [
      `${locationUrl}/current-weather/${locationMeta.locationKey ?? ""}`,
      `${locationUrl}/weather-tomorrow/${locationMeta.locationKey ?? ""}`,
    ];
    for (let d = 3; d <= MAX_DAILY_DAY; d += 1) {
      const url = `${locationUrl}/daily-weather-forecast/${locationMeta.locationKey ?? ""}?day=${d}`;
      todayUrls.push(url);
    }

    for (let i = 0; i < todayUrls.length; i += 1) {
      const sourceUrl = todayUrls[i];
      const html = await fetchHtml(sourceUrl);
      // stop at max available day: requested day returns smaller day param in canonical link
      if (sourceUrl.includes("?day=")) {
        const requested = Number.parseInt(new URL(sourceUrl).searchParams.get("day") ?? "", 10);
        const returned = Number.parseInt(
          html.match(/daily-weather-forecast\/\d+\?day=(\d+)/i)?.[1] ?? String(requested),
          10,
        );
        if (Number.isFinite(requested) && Number.isFinite(returned) && returned < requested) {
          break;
        }
      }

      const parsed = parseTodayPayload(html, sourceUrl);
      await pool.execute(
        `INSERT INTO sts_accuweather_today_snapshots
        (location_key, location_name, country_code, locale, source_forecast_url, more_detail_url, image_base_url,
         observed_time_label, weather_phrase, weather_icon_url, realfeel_value, realfeel_shade_value,
         current_details_json, further_ahead_links_json, parsed_today_json, raw_today_html)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          locationMeta.locationKey,
          locationMeta.locationName,
          locationMeta.countryCode,
          locationMeta.locale,
          sourceUrl,
          sourceUrl,
          ACCUWEATHER_BASE_URL,
          parsed.observedTimeLabel,
          parsed.weatherPhrase,
          parsed.weatherIconUrl,
          Number.parseFloat((parsed.realFeelText ?? "").replace(/[^\d.-]/g, "")) || null,
          Number.parseFloat((parsed.realFeelShadeText ?? "").replace(/[^\d.-]/g, "")) || null,
          JSON.stringify(parsed.currentDetails),
          JSON.stringify(parsed.furtherLinks),
          JSON.stringify(parsed),
          html,
        ],
      );
      stats.todaySnapshots += 1;
    }

    const hourlyUrl = `${locationUrl}/hourly-weather-forecast/${locationMeta.locationKey ?? ""}`;
    const hourlyHtml = await fetchHtml(hourlyUrl);
    const hourly = parseHourlyPayload(hourlyHtml);
    const [hourlyResult] = await pool.execute<mysql.ResultSetHeader>(
      `INSERT INTO sts_accuweather_hourly_snapshots
      (location_key, location_name, country_code, locale, source_hourly_url, parsed_hourly_json, raw_hourly_html)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        locationMeta.locationKey,
        locationMeta.locationName,
        locationMeta.countryCode,
        locationMeta.locale,
        hourlyUrl,
        JSON.stringify(hourly),
        hourlyHtml,
      ],
    );
    const hourlySnapshotId = hourlyResult.insertId;
    stats.hourlySnapshots += 1;

    for (let i = 0; i < hourly.entries.length; i += 1) {
      const row = hourly.entries[i] as Record<string, unknown>;
      await pool.execute(
        `INSERT INTO sts_accuweather_hourly_entries
        (snapshot_id, forecast_epoch, forecast_time_label, sort_order, temperature_text, realfeel_text,
         realfeel_shade_text, phrase, precipitation_probability_text, icon_url, air_quality_text,
         headline_panel_json, detail_panel_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          hourlySnapshotId,
          row.forecastEpoch as number | null,
          row.forecastTimeLabel as string | null,
          i + 1,
          row.temperatureText as string | null,
          row.realFeelText as string | null,
          row.realFeelShadeText as string | null,
          row.phrase as string | null,
          row.precipitationProbabilityText as string | null,
          row.iconUrl as string | null,
          row.airQualityText as string | null,
          JSON.stringify((row.headlinePanel as Record<string, string>) ?? {}),
          JSON.stringify((row.detailPanel as Record<string, string>) ?? {}),
        ],
      );
      stats.hourlyEntries += 1;
    }

    const visitedMonthly = new Set<string>();
    let monthlyUrl = normalizeUrl(monthStartPath);
    for (let m = 0; m < MAX_MONTH_PAGES; m += 1) {
      if (!monthlyUrl || visitedMonthly.has(monthlyUrl)) break;
      visitedMonthly.add(monthlyUrl);
      const monthlyHtml = await fetchHtml(monthlyUrl);
      const monthly = parseMonthlyPayload(monthlyHtml, monthlyUrl);
      const [monthlyResult] = await pool.execute<mysql.ResultSetHeader>(
        `INSERT INTO sts_accuweather_monthly_snapshots
        (location_key, location_name, country_code, locale, month_slug, month_label, year_value, has_year_query,
         source_monthly_url, next_month_url, ten_day_url, further_ahead_links_json, parsed_monthly_json, raw_monthly_html)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          locationMeta.locationKey,
          locationMeta.locationName,
          locationMeta.countryCode,
          locationMeta.locale,
          monthlyUrl.match(/\/([a-z]+-weather)\//i)?.[1] ?? null,
          monthly.monthLabel,
          monthly.yearValue,
          monthly.hasYearQuery ? 1 : 0,
          monthlyUrl,
          monthly.nextMonthUrl,
          monthly.furtherLinks["10-Day"] ?? null,
          JSON.stringify(monthly.furtherLinks),
          JSON.stringify(monthly),
          monthlyHtml,
        ],
      );
      const monthlySnapshotId = monthlyResult.insertId;
      stats.monthlySnapshots += 1;

      for (const row of monthly.dayEntries) {
        await pool.execute(
          `INSERT INTO sts_accuweather_monthly_day_entries
          (snapshot_id, grid_index, day_number, is_in_current_month, is_past, is_today, is_na,
           high_temp_text, low_temp_text, icon_url, icon_alt, day_detail_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            monthlySnapshotId,
            row.gridIndex as number,
            row.dayNumber as number | null,
            (row.isInCurrentMonth ? 1 : 0) as number,
            (row.isPast ? 1 : 0) as number,
            (row.isToday ? 1 : 0) as number,
            (row.isNa ? 1 : 0) as number,
            row.highTempText as string | null,
            row.lowTempText as string | null,
            row.iconUrl as string | null,
            row.iconAlt as string | null,
            row.dayDetailUrl as string | null,
          ],
        );
        stats.monthlyEntries += 1;
      }

      monthlyUrl = monthly.nextMonthUrl ?? "";
    }
  } finally {
    await pool.end();
  }
  return stats;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token") ?? "";
  const expectedToken = process.env.ACCUWEATHER_IMPORT_TOKEN ?? "";
  if (expectedToken && token !== expectedToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const locationBasePath = searchParams.get("location") ?? DEFAULT_LOCATION;
  const monthStartPath = searchParams.get("monthStart") ?? DEFAULT_MONTH_START;
  try {
    const stats = await importAll(locationBasePath, monthStartPath);
    return NextResponse.json(
      {
        ok: true,
        message: "AccuWeather data imported",
        tables: [
          "sts_accuweather_today_snapshots",
          "sts_accuweather_hourly_snapshots",
          "sts_accuweather_hourly_entries",
          "sts_accuweather_monthly_snapshots",
          "sts_accuweather_monthly_day_entries",
        ],
        stats,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Import failed",
      },
      { status: 500 },
    );
  }
}
