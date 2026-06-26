import { create } from "zustand";

import {
  fetchInventoryBalanceRows,
  removeInventoryBalance,
  saveInventoryBalance,
  type InventoryBalanceRow,
} from "@/features/admin/api/adminApi";
import { forecastZoneKeyFromParts } from "@/features/forecasting/inventoryRegrowthCalculator";

/** Stable map key for one `sts_inventory_balance` row (zone + balance_date). */
export function inventoryBalanceOverrideStorageKey(zoneKey: string, balanceDateYmd: string): string {
  const ymd = String(balanceDateYmd ?? "").trim().slice(0, 10);
  return `${zoneKey}|${ymd}`;
}

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
  /** Keys: `inventoryBalanceOverrideStorageKey(zoneKey, balance_date)`. */
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
  return forecastZoneKeyFromParts(farmId, zone, grassId);
}

/** Normalize API `balance_date` (date, datetime, ISO) to `yyyy-mm-dd` for keys and UI. */
export function normalizeInventoryBalanceDateYmd(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const head = s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(head)) return head;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return head;
  const d = new Date(t);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function mapRowToEntry(row: InventoryBalanceRow): InventoryAvailableOverrideEntry {
  const dateYmd = normalizeInventoryBalanceDateYmd(row.balance_date);
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
    date: dateYmd,
    updatedAt: String(row.updated_at ?? row.created_at ?? "").trim(),
  };
}

function mapRowsToState(rows: InventoryBalanceRow[]): Record<string, InventoryAvailableOverrideEntry> {
  const next: Record<string, InventoryAvailableOverrideEntry> = {};
  for (const row of rows) {
    const entry = mapRowToEntry(row);
    if (!entry.zoneKey || !entry.date) continue;
    next[inventoryBalanceOverrideStorageKey(entry.zoneKey, entry.date)] = entry;
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
      const rows = await fetchInventoryBalanceRows({ scopeModule: "inventory" });
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
      set((state) => {
        const merged = { ...state.overridesByZone };
        for (const row of savedRows) {
          const entry = mapRowToEntry(row);
          if (!entry.zoneKey || !entry.date) continue;
          merged[inventoryBalanceOverrideStorageKey(entry.zoneKey, entry.date)] = entry;
        }
        return {
          overridesByZone: merged,
          loading: false,
          loaded: true,
          error: null,
        };
      });
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
        delete next[inventoryBalanceOverrideStorageKey(entry.zoneKey, entry.date)];
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
