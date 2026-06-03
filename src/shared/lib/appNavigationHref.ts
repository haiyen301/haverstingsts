/** Parse an internal app href into pathname, query, and hash. */
export function parseAppHref(href: string): {
  pathname: string;
  searchParams: URLSearchParams;
  hash: string;
} {
  const trimmed = href.trim();
  const hashIdx = trimmed.indexOf("#");
  const withoutHash = hashIdx >= 0 ? trimmed.slice(0, hashIdx) : trimmed;
  const hash = hashIdx >= 0 ? trimmed.slice(hashIdx) : "";
  const qIdx = withoutHash.indexOf("?");
  const pathname = qIdx >= 0 ? withoutHash.slice(0, qIdx) : withoutHash;
  const query = qIdx >= 0 ? withoutHash.slice(qIdx + 1) : "";
  return {
    pathname: pathname || "/",
    searchParams: new URLSearchParams(query),
    hash,
  };
}

/** Rebuild an internal app href with a correctly encoded query string. */
export function buildAppHref(
  pathname: string,
  searchParams: URLSearchParams,
  hash = "",
): string {
  const qs = searchParams.toString();
  return `${pathname}${qs ? `?${qs}` : ""}${hash}`;
}

/** Ensure query values (especially nested `returnTo`) stay URL-safe before navigation. */
export function normalizeAppNavigationHref(href: string): string {
  const { pathname, searchParams, hash } = parseAppHref(href);
  return buildAppHref(pathname, searchParams, hash);
}

/**
 * Resolve a `returnTo` query param from Next.js `searchParams` (already decoded once).
 * Avoid `decodeURIComponent` here — decoding nested list filters breaks `&` in the target URL.
 */
export function resolveReturnToTarget(
  raw: string | null | undefined,
  options: { allowedPrefixes: string[]; fallback: string },
): string {
  const safeTarget = String(raw ?? "").trim();
  if (!safeTarget) return options.fallback;
  if (options.allowedPrefixes.some((prefix) => safeTarget.startsWith(prefix))) {
    return normalizeAppNavigationHref(safeTarget);
  }
  return options.fallback;
}

export function withRefreshQueryParam(target: string, key = "refresh"): string {
  const { pathname, searchParams, hash } = parseAppHref(target);
  searchParams.set(key, String(Date.now()));
  return buildAppHref(pathname, searchParams, hash);
}
