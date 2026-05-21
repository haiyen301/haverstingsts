import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "seeds", "alert-feed-config.seed.json");
const targetDir = path.join(root, "data");
const targetPath = path.join(targetDir, "alert-feed-config.json");

async function main() {
  const raw = await readFile(sourcePath, "utf8");
  JSON.parse(raw);
  await mkdir(targetDir, { recursive: true });
  await writeFile(targetPath, `${raw.trim()}\n`, "utf8");
  process.stdout.write(`Seeded alert config to ${targetPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
