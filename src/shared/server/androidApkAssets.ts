import fs from "node:fs";
import path from "node:path";

const APK_SUFFIXES = ["_production.apk", "_staging.apk"] as const;

export type ResolvedAndroidApk = {
  absolutePath: string;
  /** Generic attachment name (does not reveal the file on disk). */
  attachmentName: string;
};

function resolveApkAssetsDir(): string | null {
  const explicit = process.env.STS_APK_ASSETS_DIR?.trim();
  if (explicit && fs.existsSync(explicit)) return explicit;

  const candidates = [
    path.resolve(process.cwd(), "../STSPortal/assets/apk"),
    path.resolve(process.cwd(), "../../STSPortal/assets/apk"),
  ];

  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }

  return explicit || null;
}

function isApkAssetFile(name: string): boolean {
  if (!name.endsWith(".apk") || name.startsWith(".")) return false;
  return APK_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/**
 * Auto-detect the newest APK in STSPortal `assets/apk/` whose name ends with
 * `filenameSuffix` (e.g. `_production.apk` or `_staging.apk`).
 */
export function resolveAndroidApkFile(
  filenameSuffix: string,
): ResolvedAndroidApk | null {
  const apkDir = resolveApkAssetsDir();
  if (!apkDir) return null;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(apkDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const matches = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(filenameSuffix))
    .map((entry) => {
      const fullPath = path.join(apkDir, entry.name);
      const stat = fs.statSync(fullPath);
      return { name: entry.name, fullPath, mtimeMs: stat.mtimeMs };
    })
    .filter((entry) => isApkAssetFile(entry.name));

  if (!matches.length) return null;

  matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const newest = matches[0];
  if (!newest) return null;

  return {
    absolutePath: newest.fullPath,
    attachmentName: "sts-android.apk",
  };
}

/** Whether an APK exists for this host's environment suffix. */
export function hasAndroidApkForSuffix(filenameSuffix: string): boolean {
  return resolveAndroidApkFile(filenameSuffix) != null;
}
