export type MaintenanceStatus = {
  enabled: boolean;
  message: string;
  estimatedReturn: string;
  updatedAt: string | null;
};

export type MaintenanceConfigPayload = {
  enabled: boolean;
  message?: string;
  estimatedReturn?: string;
};

export async function fetchMaintenanceStatus(): Promise<MaintenanceStatus> {
  const res = await fetch("/api/system/maintenance", { cache: "no-store" });
  const json = (await res.json()) as {
    success?: boolean;
    data?: MaintenanceStatus;
    message?: string;
  };
  if (!res.ok || json.success !== true || !json.data) {
    throw new Error(json.message ?? "Could not load maintenance status.");
  }
  return json.data;
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
    data?: MaintenanceStatus & { enabledAt?: string | null };
    message?: string;
  };
  if (!res.ok || json.success !== true || !json.data) {
    throw new Error(json.message ?? "Could not save maintenance settings.");
  }
  return json.data;
}
