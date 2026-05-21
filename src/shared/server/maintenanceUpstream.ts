import { getStsApiUrlCandidates } from "@/shared/api/stsLogin";
import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import {
  DEFAULT_MAINTENANCE_CONFIG,
  type MaintenanceConfig,
} from "@/shared/system/maintenanceConfig";
import { normalizeMaintenanceEvictionCountdownSec } from "@/shared/lib/maintenanceCountdown";
import { DEFAULT_MAINTENANCE_EVICTION_COUNTDOWN_SEC } from "@/shared/config/maintenanceEvictionConfig";
import {
  fetchJsonWithBaseUrlFallback,
} from "@/shared/server/stsUpstreamFetch";

export type MaintenanceStatusDto = {
  enabled: boolean;
  message: string;
  estimatedReturn: string;
  updatedAt: string | null;
  evictionCountdownSec: number;
};

function parseMaintenanceData(raw: unknown): MaintenanceStatusDto | null {
  if (!raw || typeof raw !== "object") return null;
  const root = raw as { success?: boolean; data?: unknown };
  if (root.success !== true || !root.data || typeof root.data !== "object") {
    return null;
  }
  const d = root.data as Record<string, unknown>;
  const enabled =
    d.enabled === true ||
    d.enabled === 1 ||
    String(d.enabled ?? "").trim() === "1";
  return {
    enabled,
    message: String(d.message ?? "").trim(),
    estimatedReturn: String(d.estimated_return ?? d.estimatedReturn ?? "").trim(),
    updatedAt:
      d.updated_at == null || d.updated_at === ""
        ? null
        : String(d.updated_at).trim(),
    evictionCountdownSec: normalizeMaintenanceEvictionCountdownSec(
      d.eviction_countdown_sec ?? d.evictionCountdownSec,
    ),
  };
}

/** Public read — no Bearer required. */
export async function fetchMaintenanceStatusFromUpstream(): Promise<MaintenanceStatusDto> {
  const candidates = getStsApiUrlCandidates(STS_API_PATHS.maintenanceGet);
  const upstream = await fetchJsonWithBaseUrlFallback(candidates, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!upstream.ok) {
    return {
      enabled: DEFAULT_MAINTENANCE_CONFIG.enabled,
      message: DEFAULT_MAINTENANCE_CONFIG.message ?? "",
      estimatedReturn: DEFAULT_MAINTENANCE_CONFIG.estimatedReturn ?? "",
      updatedAt: DEFAULT_MAINTENANCE_CONFIG.updatedAt ?? null,
      evictionCountdownSec: DEFAULT_MAINTENANCE_EVICTION_COUNTDOWN_SEC,
    };
  }
  const parsed = parseMaintenanceData(upstream.data);
  if (parsed) return parsed;
  return {
    enabled: false,
    message: "",
    estimatedReturn: "",
    updatedAt: null,
    evictionCountdownSec: DEFAULT_MAINTENANCE_EVICTION_COUNTDOWN_SEC,
  };
}

export async function saveMaintenanceConfigToUpstream(
  token: string,
  payload: {
    enabled: boolean;
    message?: string;
    estimatedReturn?: string;
    evictionCountdownSec?: number;
  },
): Promise<(MaintenanceConfig & { evictionCountdownSec: number }) | null> {
  const candidates = getStsApiUrlCandidates(STS_API_PATHS.maintenanceSave);
  const upstream = await fetchJsonWithBaseUrlFallback(candidates, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!upstream.ok) return null;
  const root = upstream.data as { success?: boolean; data?: Record<string, unknown> };
  if (root?.success !== true || !root.data) return null;
  const d = root.data;
  const enabled =
    d.enabled === true ||
    d.enabled === 1 ||
    String(d.enabled ?? "").trim() === "1";
  const now = String(d.updated_at ?? d.updatedAt ?? new Date().toISOString());
  return {
    version: 1,
    enabled,
    message: String(d.message ?? "").trim(),
    estimatedReturn: String(d.estimated_return ?? d.estimatedReturn ?? "").trim(),
    enabledAt: enabled ? now : null,
    updatedAt: now,
    evictionCountdownSec: normalizeMaintenanceEvictionCountdownSec(
      d.eviction_countdown_sec ?? d.evictionCountdownSec,
    ),
  };
}
