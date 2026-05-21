import { create } from "zustand";

import { DEFAULT_MAINTENANCE_EVICTION_COUNTDOWN_SEC } from "@/shared/config/maintenanceEvictionConfig";
import { normalizeMaintenanceEvictionCountdownSec } from "@/shared/lib/maintenanceCountdown";

type MaintenanceConfigState = {
  evictionCountdownSec: number;
  setEvictionCountdownSec: (raw: unknown) => void;
};

export const useMaintenanceConfigStore = create<MaintenanceConfigState>((set) => ({
  evictionCountdownSec: DEFAULT_MAINTENANCE_EVICTION_COUNTDOWN_SEC,
  setEvictionCountdownSec: (raw) =>
    set({ evictionCountdownSec: normalizeMaintenanceEvictionCountdownSec(raw) }),
}));
