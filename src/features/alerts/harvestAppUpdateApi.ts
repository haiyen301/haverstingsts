import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import { stsProxyGet, stsProxyPostJson } from "@/shared/api/stsProxyClient";

export type HarvestAppUpdateStatus = {
  confirmed: boolean;
  laterAt: string | null;
};

export type HarvestAppUpdateAckRow = {
  userId: number;
  name: string;
  at: string;
};

export type HarvestAppUpdateAdminList = {
  confirmed: HarvestAppUpdateAckRow[];
  later: HarvestAppUpdateAckRow[];
};

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
