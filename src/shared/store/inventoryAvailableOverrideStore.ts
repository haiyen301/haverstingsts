import { create } from "zustand";

import {
  fetchInventoryBalanceRows,
  removeInventoryBalance,
  saveInventoryBalance,
  type InventoryBalanceRow,
} from "@/features/admin/api/adminApi";

export type InventoryAvailableOverrideEntry = {
  id: number;
  zoneKey: string;
  zoneConfigurationId: number | null;
  farmId: number;
  grassId: number;
  farmName: string;
  turfgrass: string;
  zone: string;
  /**
   * Manual on-hand / available inventory entered by the user.
   * This temporarily overrides the calculated available value.
   */
  availableKg: number;
  /** Calculated available kg at the moment the manual override was saved. */
  calculatedKg: number;
  /** Effective date (`yyyy-mm-dd`) for the override. */
  date: string;
  updatedAt: string;
};

type InventoryAvailableOverrideState = {
  overridesByZone: Record<string, InventoryAvailableOverrideEntry>;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  fetchOverrides: () => Promise<void>;
  upsertOverrides: (entries: InventoryAvailableOverrideEntry[]) => Promise<void>;
  removeOverride: (entry: InventoryAvailableOverrideEntry) => Promise<void>;
  clearOverrides: () => void;
};

function zoneKeyFromParts(farmId: number, zone: string, grassId: number): string {
  return `${farmId}|${String(zone ?? "").trim().toLowerCase()}|${grassId}`;
}

function mapRowToEntry(row: InventoryBalanceRow): InventoryAvailableOverrideEntry {
  return {
    id: Number(row.id) || 0,
    zoneKey: zoneKeyFromParts(Number(row.farm_id) || 0, String(row.zone ?? ""), Number(row.grass_id) || 0),
    zoneConfigurationId:
      row.zone_configuration_id == null
        ? null
        : Number(row.zone_configuration_id),
    farmId: Number(row.farm_id) || 0,
    grassId: Number(row.grass_id) || 0,
    farmName: String(row.farm_name ?? "").trim(),
    turfgrass: String(row.turfgrass ?? "").trim(),
    zone: String(row.zone ?? "").trim(),
    availableKg: Number(row.available_kg) || 0,
    calculatedKg:
      row.calculated_kg == null || row.calculated_kg === ""
        ? 0
        : Number(row.calculated_kg) || 0,
    date: String(row.balance_date ?? "").trim(),
    updatedAt: String(row.updated_at ?? row.created_at ?? "").trim(),
  };
}

function mapRowsToState(rows: InventoryBalanceRow[]): Record<string, InventoryAvailableOverrideEntry> {
  const next: Record<string, InventoryAvailableOverrideEntry> = {};
  for (const row of rows) {
    const entry = mapRowToEntry(row);
    if (!entry.zoneKey) continue;
    next[entry.zoneKey] = entry;
  }
  return next;
}

export const useInventoryAvailableOverrideStore = create<InventoryAvailableOverrideState>((set) => ({
  overridesByZone: {},
  loading: false,
  loaded: false,
  error: null,
  fetchOverrides: async () => {
    set({ loading: true, error: null });
    try {
      const rows = await fetchInventoryBalanceRows();
      set({
        overridesByZone: mapRowsToState(rows),
        loading: false,
        loaded: true,
        error: null,
      });
    } catch (error) {
      set({
        loading: false,
        loaded: true,
        error: error instanceof Error ? error.message : "Failed to load inventory balance overrides.",
      });
    }
  },
  upsertOverrides: async (entries) => {
    if (entries.length === 0) return;
    set({ loading: true, error: null });
    try {
      const savedRows = await Promise.all(
        entries.map((entry) =>
          saveInventoryBalance({
            id: entry.id > 0 ? entry.id : undefined,
            zone_configuration_id: entry.zoneConfigurationId,
            farm_id: entry.farmId,
            grass_id: entry.grassId,
            zone: entry.zone,
            balance_date: entry.date,
            available_kg: entry.availableKg,
            calculated_kg: entry.calculatedKg,
          }),
        ),
      );
      set((state) => ({
        overridesByZone: {
          ...state.overridesByZone,
          ...mapRowsToState(savedRows),
        },
        loading: false,
        loaded: true,
        error: null,
      }));
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Failed to save inventory balance overrides.",
      });
      throw error;
    }
  },
  removeOverride: async (entry) => {
    if (!entry.id) return;
    set({ loading: true, error: null });
    try {
      await removeInventoryBalance(entry.id);
      set((state) => {
        const next = { ...state.overridesByZone };
        delete next[entry.zoneKey];
        return {
          overridesByZone: next,
          loading: false,
          loaded: true,
          error: null,
        };
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Failed to remove inventory balance override.",
      });
      throw error;
    }
  },
  clearOverrides: () =>
    set({
      overridesByZone: {},
      loading: false,
      loaded: false,
      error: null,
    }),
}));
