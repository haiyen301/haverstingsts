/**
 * Minimal CSRF mitigation for cookie-authenticated mutation requests.
 * Allows same-origin browser requests and blocks cross-site origins.
 */
export function isTrustedSameOriginRequest(req: Request): boolean {
  const expectedOrigin = deriveExpectedOrigin(req);
  if (!expectedOrigin) return false;

  const origin = req.headers.get("origin")?.trim();
  if (origin) return origin === expectedOrigin;

  const referer = req.headers.get("referer")?.trim();
  if (!referer) return true;
  try {
    return new URL(referer).origin === expectedOrigin;
  } catch {
    return false;
  }
}

function deriveExpectedOrigin(req: Request): string | null {
  const proto =
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    new URL(req.url).protocol.replace(":", "");
  const host =
    req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    req.headers.get("host")?.trim() ||
    new URL(req.url).host;
  if (!proto || !host) return null;
  return `${proto}://${host}`;
}
