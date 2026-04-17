/**
 * Static AccuWeather “browse Asia” links (same list as the former API fallback).
 * The Next.js routes under `src/app/api/accuweather` were moved to `backup/app-api-accuweather/`.
 */
export type AccuweatherBrowseLink = {
  name: string;
  href: string;
};

export const ACCUWEATHER_ASIA_BROWSE_LINKS: AccuweatherBrowseLink[] = [
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
  {
    name: "Cocos (Keeling) Islands",
    href: "https://www.accuweather.com/en/browse-locations/asi/cc",
  },
  { name: "Georgia", href: "https://www.accuweather.com/en/browse-locations/asi/ge" },
  { name: "South Korea", href: "https://www.accuweather.com/en/browse-locations/asi/kr" },
  { name: "Hong Kong", href: "https://www.accuweather.com/en/browse-locations/asi/hk" },
  { name: "Indonesia", href: "https://www.accuweather.com/en/browse-locations/asi/id" },
  { name: "Kazakhstan", href: "https://www.accuweather.com/en/browse-locations/asi/kz" },
  { name: "Kyrgyzstan", href: "https://www.accuweather.com/en/browse-locations/asi/kg" },
  {
    name: "British Indian Ocean Territory",
    href: "https://www.accuweather.com/en/browse-locations/asi/io",
  },
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
