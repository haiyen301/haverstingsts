import { normalizeMaintenanceEvictionCountdownSec } from "@/shared/lib/maintenanceCountdown";

export type MaintenanceStatus = {
  enabled: boolean;
  message: string;
  estimatedReturn: string;
  updatedAt: string | null;
  evictionCountdownSec: number;
};

export type MaintenanceConfigPayload = {
  enabled: boolean;
  message?: string;
  estimatedReturn?: string;
  evictionCountdownSec?: number;
};

function toMaintenanceStatus(data: Record<string, unknown>): MaintenanceStatus {
  const enabled =
    data.enabled === true ||
    data.enabled === 1 ||
    String(data.enabled ?? "").trim() === "1";
  return {
    enabled,
    message: String(data.message ?? "").trim(),
    estimatedReturn: String(
      data.estimated_return ?? data.estimatedReturn ?? "",
    ).trim(),
    updatedAt:
      data.updated_at == null || data.updated_at === ""
        ? null
        : String(data.updated_at).trim(),
    evictionCountdownSec: normalizeMaintenanceEvictionCountdownSec(
      data.eviction_countdown_sec ?? data.evictionCountdownSec,
    ),
  };
}

export async function fetchMaintenanceStatus(): Promise<MaintenanceStatus> {
  const res = await fetch("/api/system/maintenance", { cache: "no-store" });
  const json = (await res.json()) as {
    success?: boolean;
    data?: Record<string, unknown>;
    message?: string;
  };
  if (!res.ok || json.success !== true || !json.data) {
    throw new Error(json.message ?? "Could not load maintenance status.");
  }
  return toMaintenanceStatus(json.data);
}

export async function saveMaintenanceConfig(
  payload: MaintenanceConfigPayload,
): Promise<MaintenanceStatus & { enabledAt?: string | null }> {
  const res = await fetch("/api/system/maintenance", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = (await res.json()) as {
    success?: boolean;
    data?: Record<string, unknown>;
    message?: string;
  };
  if (!res.ok || json.success !== true || !json.data) {
    throw new Error(json.message ?? "Could not save maintenance settings.");
  }
  return toMaintenanceStatus(json.data);
}
