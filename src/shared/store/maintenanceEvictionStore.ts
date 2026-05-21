import { create } from "zustand";

export { MAINTENANCE_EVICTION_COUNTDOWN_SEC } from "@/shared/config/maintenanceEvictionConfig";

type MaintenanceEvictionState = {
  evicting: boolean;
  startEviction: () => void;
  resetEviction: () => void;
};

export const useMaintenanceEvictionStore = create<MaintenanceEvictionState>((set, get) => ({
  evicting: false,
  startEviction: () => {
    if (get().evicting) return;
    set({ evicting: true });
  },
  resetEviction: () => set({ evicting: false }),
}));
