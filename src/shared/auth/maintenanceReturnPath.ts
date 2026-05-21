const STORAGE_KEY = "sts_maintenance_return_path";

/** Safe in-app path only (no open redirect). */
export function sanitizeMaintenanceReturnPath(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;

  try {
    const url = new URL(trimmed, "http://localhost");
    const path = url.pathname;
    if (path === "/maintenance" || path.startsWith("/maintenance/")) return null;
    if (path.startsWith("/api")) return null;
    return `${path}${url.search}`;
  } catch {
    return null;
  }
}

export function saveMaintenanceReturnPath(path: string): void {
  const safe = sanitizeMaintenanceReturnPath(path);
  if (!safe || typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, safe);
  } catch {
    /* ignore */
  }
}

export function getMaintenanceReturnPath(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sanitizeMaintenanceReturnPath(
      window.sessionStorage.getItem(STORAGE_KEY),
    );
  } catch {
    return null;
  }
}

export function clearMaintenanceReturnPath(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Where to send the user when maintenance mode is off. */
export function resolveMaintenanceExitPath(options: {
  authenticated: boolean;
  fromQuery?: string | null;
}): string {
  const fromQuery = sanitizeMaintenanceReturnPath(options.fromQuery);
  if (fromQuery) return fromQuery;

  const stored = getMaintenanceReturnPath();
  if (stored) return stored;

  return options.authenticated ? "/dashboard" : "/";
}
