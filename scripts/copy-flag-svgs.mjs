/**
 * Copies SVG flags from the flag-icons package into public/flags for offline serving.
 * Run automatically via postinstall (see package.json).
 */
import { cpSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const src = join(root, "node_modules", "flag-icons", "flags", "4x3");
const dest = join(root, "public", "flags");

if (!existsSync(src)) {
  console.warn("copy-flag-svgs: node_modules/flag-icons not found — skip (run npm install)");
  process.exit(0);
}

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log("copy-flag-svgs: copied SVG flags to public/flags");
