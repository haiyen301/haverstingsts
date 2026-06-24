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

/** Keep `projectTitle` in sync when returning to project detail after a rename. */
export function withUpdatedDetailProjectTitle(
  target: string,
  projectTitle: string,
): string {
  const name = projectTitle.trim();
  if (!name) return target;
  const { pathname, searchParams, hash } = parseAppHref(target);
  if (!pathname.startsWith("/projects/detail")) return target;
  searchParams.set("projectTitle", name);
  return buildAppHref(pathname, searchParams, hash);
}

/** After project save — return to `returnTo` when present, else detail fallback. */
export function resolvePostProjectSaveReturnHref(opts: {
  isEdit: boolean;
  returnToParam: string;
  returnTarget: string;
  projectName: string;
  detailHrefAfterSave: string;
}): string {
  if (!opts.isEdit) {
    return withRefreshQueryParam(opts.detailHrefAfterSave);
  }

  const target = opts.returnToParam.trim()
    ? opts.returnTarget
    : opts.detailHrefAfterSave;
  const withTitle = withUpdatedDetailProjectTitle(target, opts.projectName);
  const { pathname } = parseAppHref(withTitle);
  if (pathname.startsWith("/projects") || pathname.startsWith("/harvest")) {
    return withRefreshQueryParam(withTitle);
  }
  return withTitle;
}
