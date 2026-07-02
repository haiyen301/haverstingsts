import { promises as fs } from "fs";

import type { AlertFeedConfig } from "@/features/alerts/alertFeedConfigTypes";

/** Relative to process cwd at runtime. */
const CONFIG_PATH = "data/alert-feed-config.json";
const SEED_CONFIG_PATH = "seeds/alert-feed-config.seed.json";
const CONFIG_DIR = "data";

export async function readAlertFeedConfigFile(
  parseConfig: (raw: unknown) => AlertFeedConfig | null,
): Promise<AlertFeedConfig | null> {
  for (const candidate of [CONFIG_PATH, SEED_CONFIG_PATH]) {
    try {
      const raw = await fs.readFile(candidate, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      const cfg = parseConfig(parsed);
      if (cfg) return cfg;
    } catch {
      /* try next source */
    }
  }
  return null;
}

export async function writeAlertFeedConfigFile(cfg: AlertFeedConfig): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
}
