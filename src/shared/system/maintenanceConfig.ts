import { promises as fs } from "fs";
import path from "path";

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

const CONFIG_PATH = path.join(process.cwd(), "data", "maintenance-config.json");
const SEED_CONFIG_PATH = path.join(process.cwd(), "seeds", "maintenance-config.seed.json");

function parseMaintenanceConfig(raw: unknown): MaintenanceConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (Number(o.version) !== 1) return null;
  const enabled = o.enabled === true || o.enabled === 1 || String(o.enabled).trim() === "1";
  const message = String(o.message ?? "").trim();
  const estimatedReturn = String(o.estimatedReturn ?? "").trim();
  const enabledAt =
    o.enabledAt == null || o.enabledAt === ""
      ? null
      : String(o.enabledAt).trim();
  const updatedAt =
    o.updatedAt == null || o.updatedAt === ""
      ? null
      : String(o.updatedAt).trim();
  return {
    version: 1,
    enabled,
    message,
    estimatedReturn,
    enabledAt,
    updatedAt,
  };
}

export async function readMaintenanceConfigFromDisk(): Promise<MaintenanceConfig> {
  for (const candidate of [CONFIG_PATH, SEED_CONFIG_PATH]) {
    try {
      const raw = await fs.readFile(candidate, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      const cfg = parseMaintenanceConfig(parsed);
      if (cfg) return cfg;
    } catch {
      /* try next */
    }
  }
  return { ...DEFAULT_MAINTENANCE_CONFIG };
}

export async function writeMaintenanceConfigToDisk(
  config: MaintenanceConfig,
): Promise<void> {
  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

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
