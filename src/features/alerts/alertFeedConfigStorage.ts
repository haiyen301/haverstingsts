import { promises as fs } from "fs";
import path from "path";

import type { AlertFeedConfig } from "@/features/alerts/alertFeedConfigTypes";

const CONFIG_PATH = path.join(process.cwd(), "data", "alert-feed-config.json");
const SEED_CONFIG_PATH = path.join(process.cwd(), "seeds", "alert-feed-config.seed.json");
const CONFIG_DIR = path.join(process.cwd(), "data");

export async function readAlertFeedConfigFile(
  parseConfig: (raw: unknown) => AlertFeedConfig | null,
): Promise<AlertFeedConfig | null> {
  try {
    const raw = await fs.readFile(/* turbopackIgnore: true */ CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const cfg = parseConfig(parsed);
    if (cfg) return cfg;
  } catch {
    /* try seed */
  }

  try {
    const raw = await fs.readFile(/* turbopackIgnore: true */ SEED_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parseConfig(parsed);
  } catch {
    return null;
  }
}

export async function writeAlertFeedConfigFile(cfg: AlertFeedConfig): Promise<void> {
  await fs.mkdir(/* turbopackIgnore: true */ CONFIG_DIR, { recursive: true });
  await fs.writeFile(
    /* turbopackIgnore: true */ CONFIG_PATH,
    JSON.stringify(cfg, null, 2),
    "utf8",
  );
}
