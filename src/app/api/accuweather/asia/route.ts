import { NextResponse } from "next/server";

const ACCUWEATHER_BASE_URL = "https://www.accuweather.com";
const DEFAULT_LANG = "en";

type AsiaLocation = {
  name: string;
  href: string;
};

type BrowseResponse = {
  title: string;
  source: string;
  total: number;
  locations: AsiaLocation[];
  fallback?: boolean;
  warning?: string;
};

type ResolveResponse = {
  source: string;
  finalUrl: string;
};

type ForecastHtmlResponse = {
  tab: "today";
  source: string;
  html: string;
};

const FALLBACK_ASIA_LOCATIONS: AsiaLocation[] = [
  { name: "Afghanistan", href: "https://www.accuweather.com/en/browse-locations/asi/af" },
  { name: "India", href: "https://www.accuweather.com/en/browse-locations/asi/in" },
  { name: "Armenia", href: "https://www.accuweather.com/en/browse-locations/asi/am" },
  { name: "Azerbaijan", href: "https://www.accuweather.com/en/browse-locations/asi/az" },
  { name: "North Korea", href: "https://www.accuweather.com/en/browse-locations/asi/kp" },
  { name: "Bangladesh", href: "https://www.accuweather.com/en/browse-locations/asi/bd" },
  { name: "Bhutan", href: "https://www.accuweather.com/en/browse-locations/asi/bt" },
  { name: "Brunei", href: "https://www.accuweather.com/en/browse-locations/asi/bn" },
  { name: "Cambodia", href: "https://www.accuweather.com/en/browse-locations/asi/kh" },
  { name: "Taiwan", href: "https://www.accuweather.com/en/browse-locations/asi/tw" },
  { name: "Christmas Island", href: "https://www.accuweather.com/en/browse-locations/asi/cx" },
  { name: "Cocos (Keeling) Islands", href: "https://www.accuweather.com/en/browse-locations/asi/cc" },
  { name: "Georgia", href: "https://www.accuweather.com/en/browse-locations/asi/ge" },
  { name: "South Korea", href: "https://www.accuweather.com/en/browse-locations/asi/kr" },
  { name: "Hong Kong", href: "https://www.accuweather.com/en/browse-locations/asi/hk" },
  { name: "Indonesia", href: "https://www.accuweather.com/en/browse-locations/asi/id" },
  { name: "Kazakhstan", href: "https://www.accuweather.com/en/browse-locations/asi/kz" },
  { name: "Kyrgyzstan", href: "https://www.accuweather.com/en/browse-locations/asi/kg" },
  { name: "British Indian Ocean Territory", href: "https://www.accuweather.com/en/browse-locations/asi/io" },
  { name: "Laos", href: "https://www.accuweather.com/en/browse-locations/asi/la" },
  { name: "Macau", href: "https://www.accuweather.com/en/browse-locations/asi/mo" },
  { name: "Malaysia", href: "https://www.accuweather.com/en/browse-locations/asi/my" },
  { name: "Maldives", href: "https://www.accuweather.com/en/browse-locations/asi/mv" },
  { name: "Mongolia", href: "https://www.accuweather.com/en/browse-locations/asi/mn" },
  { name: "Myanmar", href: "https://www.accuweather.com/en/browse-locations/asi/mm" },
  { name: "Nepal", href: "https://www.accuweather.com/en/browse-locations/asi/np" },
  { name: "Russia", href: "https://www.accuweather.com/en/browse-locations/asi/ru" },
  { name: "Japan", href: "https://www.accuweather.com/en/browse-locations/asi/jp" },
  { name: "Pakistan", href: "https://www.accuweather.com/en/browse-locations/asi/pk" },
  { name: "Philippines", href: "https://www.accuweather.com/en/browse-locations/asi/ph" },
  { name: "Spratly Islands", href: "https://www.accuweather.com/en/browse-locations/asi/sp" },
  { name: "Singapore", href: "https://www.accuweather.com/en/browse-locations/asi/sg" },
  { name: "Sri Lanka", href: "https://www.accuweather.com/en/browse-locations/asi/lk" },
  { name: "Tajikistan", href: "https://www.accuweather.com/en/browse-locations/asi/tj" },
  { name: "Thailand", href: "https://www.accuweather.com/en/browse-locations/asi/th" },
  { name: "Turkey", href: "https://www.accuweather.com/en/browse-locations/asi/tr" },
  { name: "Timor-Leste", href: "https://www.accuweather.com/en/browse-locations/asi/tl" },
  { name: "China", href: "https://www.accuweather.com/en/browse-locations/asi/cn" },
  { name: "Turkmenistan", href: "https://www.accuweather.com/en/browse-locations/asi/tm" },
  { name: "Uzbekistan", href: "https://www.accuweather.com/en/browse-locations/asi/uz" },
  { name: "Vietnam", href: "https://www.accuweather.com/en/browse-locations/asi/vn" },
];

const FALLBACK_VIETNAM_LOCATIONS: AsiaLocation[] = [
  { name: "An Giang", href: "https://www.accuweather.com/en/browse-locations/asi/vn/44" },
  { name: "Bắc Ninh", href: "https://www.accuweather.com/en/browse-locations/asi/vn/56" },
  { name: "Cà Mau", href: "https://www.accuweather.com/en/browse-locations/asi/vn/59" },
  { name: "Can Tho", href: "https://www.accuweather.com/en/browse-locations/asi/vn/ct" },
  { name: "Cao Bằng", href: "https://www.accuweather.com/en/browse-locations/asi/vn/04" },
  { name: "Đắk Lắk", href: "https://www.accuweather.com/en/browse-locations/asi/vn/33" },
  { name: "Danang", href: "https://www.accuweather.com/en/browse-locations/asi/vn/dn" },
  { name: "Điện Biên", href: "https://www.accuweather.com/en/browse-locations/asi/vn/71" },
  { name: "Đồng Nai", href: "https://www.accuweather.com/en/browse-locations/asi/vn/39" },
  { name: "Đồng Tháp", href: "https://www.accuweather.com/en/browse-locations/asi/vn/45" },
  { name: "Gia Lai", href: "https://www.accuweather.com/en/browse-locations/asi/vn/30" },
  { name: "Hà Tĩnh", href: "https://www.accuweather.com/en/browse-locations/asi/vn/23" },
  { name: "Haiphong", href: "https://www.accuweather.com/en/browse-locations/asi/vn/hp" },
  { name: "Hanoi", href: "https://www.accuweather.com/en/browse-locations/asi/vn/hn" },
  { name: "Ho Chi Minh", href: "https://www.accuweather.com/en/browse-locations/asi/vn/sg" },
  { name: "Huế", href: "https://www.accuweather.com/en/browse-locations/asi/vn/26" },
  { name: "Hưng Yên", href: "https://www.accuweather.com/en/browse-locations/asi/vn/66" },
  { name: "Khánh Hòa", href: "https://www.accuweather.com/en/browse-locations/asi/vn/34" },
  { name: "Lai Châu", href: "https://www.accuweather.com/en/browse-locations/asi/vn/01" },
  { name: "Lâm Đồng", href: "https://www.accuweather.com/en/browse-locations/asi/vn/35" },
  { name: "Lạng Sơn", href: "https://www.accuweather.com/en/browse-locations/asi/vn/09" },
  { name: "Lào Cai", href: "https://www.accuweather.com/en/browse-locations/asi/vn/02" },
  { name: "Nghệ An", href: "https://www.accuweather.com/en/browse-locations/asi/vn/22" },
  { name: "Ninh Bình", href: "https://www.accuweather.com/en/browse-locations/asi/vn/18" },
  { name: "Phú Thọ", href: "https://www.accuweather.com/en/browse-locations/asi/vn/68" },
  { name: "Quảng Ngãi", href: "https://www.accuweather.com/en/browse-locations/asi/vn/29" },
  { name: "Quảng Ninh", href: "https://www.accuweather.com/en/browse-locations/asi/vn/13" },
  { name: "Quảng Trị", href: "https://www.accuweather.com/en/browse-locations/asi/vn/25" },
  { name: "Sơn La", href: "https://www.accuweather.com/en/browse-locations/asi/vn/05" },
  { name: "Tây Ninh", href: "https://www.accuweather.com/en/browse-locations/asi/vn/37" },
  { name: "Thái Nguyên", href: "https://www.accuweather.com/en/browse-locations/asi/vn/69" },
  { name: "Thanh Hóa", href: "https://www.accuweather.com/en/browse-locations/asi/vn/21" },
  { name: "Tuyên Quang", href: "https://www.accuweather.com/en/browse-locations/asi/vn/07" },
  { name: "Vĩnh Long", href: "https://www.accuweather.com/en/browse-locations/asi/vn/49" },
];

function decodeHtml(raw: string): string {
  const namedEntities: Record<string, string> = {
    amp: "&",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
    nbsp: " ",
  };
  return raw
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(Number.parseInt(dec, 10)),
    )
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&([a-zA-Z]+);/g, (_, name: string) => namedEntities[name] ?? `&${name};`)
    .trim();
}

function parseAsiaLocations(html: string): AsiaLocation[] {
  const blockMatch = html.match(
    /<div class="result-container">([\s\S]*?)<\/div>/i,
  );
  const block = blockMatch?.[1] ?? "";
  if (!block) return [];

  const anchorRegex =
    /<a class="search-result"\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const results: AsiaLocation[] = [];
  let match: RegExpExecArray | null = null;

  while ((match = anchorRegex.exec(block)) !== null) {
    const href = match[1]?.trim() ?? "";
    const name = decodeHtml((match[2] ?? "").replace(/<[^>]+>/g, ""));
    if (!href || !name) continue;
    results.push({
      href: href.startsWith("http")
        ? href
        : `https://www.accuweather.com${href}`,
      name,
    });
  }

  return results;
}

function toAbsoluteAccuWeatherHref(href: string): string {
  if (href.startsWith("http")) return href;
  return `${ACCUWEATHER_BASE_URL}${href}`;
}

function normalizeBrowsePath(pathValue: string | null, lang: string): string {
  const raw = (pathValue ?? "").trim();
  if (!raw) return `/${lang}/browse-locations/asi`;
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    try {
      const url = new URL(raw);
      return url.pathname;
    } catch {
      return `/${lang}/browse-locations/asi`;
    }
  }
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function normalizeTargetUrl(value: string): string {
  const decoded = decodeHtml(value).trim();
  if (!decoded) return "";
  if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
    return decoded;
  }
  if (decoded.startsWith("/")) {
    return `${ACCUWEATHER_BASE_URL}${decoded}`;
  }
  return `${ACCUWEATHER_BASE_URL}/${decoded}`;
}

function extractTodayColumnHtml(html: string): string {
  const startToken = '<div class="page-column-1">';
  const endToken = '<div class="page-column-2">';
  const start = html.indexOf(startToken);
  if (start < 0) return "";
  const end = html.indexOf(endToken, start);
  if (end < 0) {
    return html.slice(start).trim();
  }
  return html.slice(start, end).trim();
}

function titleFromHtml(html: string): string {
  const match = html.match(/<div class="location-title">([\s\S]*?)<\/div>/i);
  const value = match?.[1] ?? "";
  return decodeHtml(value.replace(/<[^>]+>/g, "")) || "Browse Locations";
}

function fallbackForPath(pathname: string): BrowseResponse | null {
  if (pathname === "/en/browse-locations/asi") {
    return {
      title: "Asia",
      source: `${ACCUWEATHER_BASE_URL}${pathname}`,
      total: FALLBACK_ASIA_LOCATIONS.length,
      locations: FALLBACK_ASIA_LOCATIONS,
      fallback: true,
    };
  }
  if (pathname === "/en/browse-locations/asi/vn") {
    return {
      title: "Vietnam",
      source: `${ACCUWEATHER_BASE_URL}${pathname}`,
      total: FALLBACK_VIETNAM_LOCATIONS.length,
      locations: FALLBACK_VIETNAM_LOCATIONS,
      fallback: true,
    };
  }
  if (pathname === "/vi/browse-locations/asi") {
    return {
      title: "Châu Á",
      source: `${ACCUWEATHER_BASE_URL}${pathname}`,
      total: FALLBACK_ASIA_LOCATIONS.length,
      locations: FALLBACK_ASIA_LOCATIONS.map((item) => ({
        ...item,
        href: item.href.replace("/en/", "/vi/"),
      })),
      fallback: true,
    };
  }
  if (pathname === "/vi/browse-locations/asi/vn") {
    return {
      title: "Việt Nam",
      source: `${ACCUWEATHER_BASE_URL}${pathname}`,
      total: FALLBACK_VIETNAM_LOCATIONS.length,
      locations: FALLBACK_VIETNAM_LOCATIONS.map((item) => ({
        ...item,
        href: item.href.replace("/en/", "/vi/"),
      })),
      fallback: true,
    };
  }
  return null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const forecastTargetRaw = (searchParams.get("forecastUrl") ?? "").trim();
  const forecastTabRaw = (searchParams.get("tab") ?? "").trim().toLowerCase();
  if (forecastTargetRaw) {
    if (forecastTabRaw !== "today") {
      return NextResponse.json(
        { error: "Only today tab is supported now" },
        { status: 400 },
      );
    }
    const forecastTarget = normalizeTargetUrl(forecastTargetRaw);
    if (!forecastTarget) {
      return NextResponse.json({ error: "Invalid forecast URL" }, { status: 400 });
    }
    try {
      const res = await fetch(forecastTarget, {
        headers: {
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "accept-language": "vi,en-US;q=0.9,en;q=0.8",
          referer: "https://www.accuweather.com/",
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        },
        cache: "no-store",
      });
      if (!res.ok) {
        return NextResponse.json(
          { error: `Forecast URL responded with ${res.status}` },
          { status: 502 },
        );
      }
      const html = await res.text();
      const extracted = extractTodayColumnHtml(html);
      const output: ForecastHtmlResponse = {
        tab: "today",
        source: forecastTarget,
        html: extracted || html,
      };
      return NextResponse.json(output, { status: 200 });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to fetch forecast HTML",
        },
        { status: 500 },
      );
    }
  }

  const resolveTargetRaw = (searchParams.get("resolve") ?? "").trim();
  if (resolveTargetRaw) {
    const resolveTarget = normalizeTargetUrl(resolveTargetRaw);
    if (!resolveTarget) {
      return NextResponse.json({ error: "Invalid resolve URL" }, { status: 400 });
    }
    try {
      const res = await fetch(resolveTarget, {
        headers: {
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "accept-language": "vi,en-US;q=0.9,en;q=0.8",
          referer: "https://www.accuweather.com/",
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        },
        cache: "no-store",
        redirect: "follow",
      });
      if (!res.ok) {
        return NextResponse.json(
          { error: `Resolve URL responded with ${res.status}` },
          { status: 502 },
        );
      }
      const output: ResolveResponse = {
        source: resolveTarget,
        finalUrl: res.url || resolveTarget,
      };
      return NextResponse.json(output, { status: 200 });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to resolve redirect URL",
        },
        { status: 500 },
      );
    }
  }

  const langRaw = (searchParams.get("lang") ?? DEFAULT_LANG).trim().toLowerCase();
  const lang = langRaw === "vi" ? "vi" : "en";
  const targetPath = normalizeBrowsePath(searchParams.get("path"), lang);
  const sourceUrl = `${ACCUWEATHER_BASE_URL}${targetPath}`;
  try {
    const res = await fetch(sourceUrl, {
      headers: {
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "accept-language": "vi,en-US;q=0.9,en;q=0.8",
        referer: "https://www.accuweather.com/",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      if (res.status === 403) {
        const fallback = fallbackForPath(targetPath);
        if (fallback) {
          return NextResponse.json(fallback, { status: 200 });
        }
      }
      return NextResponse.json(
        { error: `AccuWeather responded with ${res.status}` },
        { status: 502 },
      );
    }

    const html = await res.text();
    const locations = parseAsiaLocations(html);
    const title = titleFromHtml(html);
    const fallback = fallbackForPath(targetPath);
    const finalLocations = locations.length
      ? locations.map((item) => ({ ...item, href: toAbsoluteAccuWeatherHref(item.href) }))
      : (fallback?.locations ?? []);

    return NextResponse.json(
      {
        title,
        source: sourceUrl,
        total: finalLocations.length,
        locations: finalLocations,
        fallback: locations.length === 0,
      },
      { status: 200 },
    );
  } catch (error) {
    const fallback = fallbackForPath(targetPath);
    if (fallback) {
      return NextResponse.json(
        {
          ...fallback,
          warning:
            error instanceof Error
              ? error.message
              : "Failed to fetch AccuWeather locations",
        },
        { status: 200 },
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch AccuWeather locations",
      },
      { status: 500 },
    );
  }
}
