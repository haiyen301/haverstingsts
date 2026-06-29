export type MaintenanceConfig = {
  version: 1;
  enabled: boolean;
  /** Optional message shown on the public maintenance screen. */
  message?: string;
  /** Optional ISO-ish label, e.g. "2026-05-22 14:00 UTC". */
  estimatedReturn?: string;
  enabledAt?: string | null;
  updatedAt?: string | null;
};

export const DEFAULT_MAINTENANCE_CONFIG: MaintenanceConfig = {
  version: 1,
  enabled: false,
  message: "",
  estimatedReturn: "",
  enabledAt: null,
  updatedAt: null,
};

export function normalizeMaintenancePatch(body: unknown): MaintenanceConfig | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const enabled =
    o.enabled === true ||
    o.enabled === 1 ||
    String(o.enabled ?? "").trim().toLowerCase() === "true" ||
    String(o.enabled ?? "").trim() === "1";
  const message = String(o.message ?? "").trim().slice(0, 500);
  const estimatedReturn = String(o.estimatedReturn ?? "").trim().slice(0, 120);
  const now = new Date().toISOString();
  return {
    version: 1,
    enabled,
    message,
    estimatedReturn,
    enabledAt: enabled ? now : null,
    updatedAt: now,
  };
}
