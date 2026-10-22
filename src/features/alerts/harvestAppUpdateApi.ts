import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import { stsProxyGet, stsProxyPostJson } from "@/shared/api/stsProxyClient";

export const HARVEST_APP_UPDATE_ENABLED_EVENT = "stsrenew-harvest-app-update-enabled";

export type HarvestAppUpdateStatus = {
  enabled: boolean;
  confirmed: boolean;
  laterAt: string | null;
};

export type HarvestAppUpdateAckRow = {
  userId: number;
  name: string;
  at: string;
};

export type HarvestAppUpdateAdminList = {
  enabled: boolean;
  confirmed: HarvestAppUpdateAckRow[];
  later: HarvestAppUpdateAckRow[];
};

export function publishHarvestAppUpdateEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(HARVEST_APP_UPDATE_ENABLED_EVENT, { detail: { enabled } }),
  );
}

export function fetchHarvestAppUpdateStatus(): Promise<HarvestAppUpdateStatus> {
  return stsProxyGet<HarvestAppUpdateStatus>(STS_API_PATHS.harvestAppUpdate);
}

export function saveHarvestAppUpdateChoice(
  action: "confirm" | "later",
): Promise<HarvestAppUpdateStatus> {
  return stsProxyPostJson<HarvestAppUpdateStatus>(STS_API_PATHS.harvestAppUpdateSave, { action });
}

export function fetchHarvestAppUpdateAdminList(): Promise<HarvestAppUpdateAdminList> {
  return stsProxyGet<HarvestAppUpdateAdminList>(STS_API_PATHS.harvestAppUpdateAdmin);
}

export function removeHarvestAppUpdateAck(
  userId: number,
  bucket: "confirmed" | "later",
): Promise<HarvestAppUpdateAdminList> {
  return stsProxyPostJson<HarvestAppUpdateAdminList>(STS_API_PATHS.harvestAppUpdateAdminRemove, {
    userId,
    bucket,
  });
}

export function saveHarvestAppUpdateEnabled(
  enabled: boolean,
): Promise<HarvestAppUpdateAdminList> {
  return stsProxyPostJson<HarvestAppUpdateAdminList>(STS_API_PATHS.harvestAppUpdateAdminEnabled, {
    enabled,
  });
}
