import fs from "node:fs";
import path from "node:path";

import {
  getAndroidApkFilenameSuffixesFromEnv,
  getAndroidApkPublicBaseUrl,
} from "@/shared/config/deploymentEnvironment";

const APK_SUFFIXES = ["_production.apk", "_staging.apk"] as const;

export type ResolvedAndroidApk = {
  absolutePath: string;
  /** Generic attachment name (does not reveal the file on disk). */
  attachmentName: string;
};

function getApkAssetsDirCandidates(): string[] {
  const explicit = process.env.STS_APK_ASSETS_DIR?.trim();
  const stsPortalDir = process.env.STSPORTAL_DIR?.trim();

  const candidates: string[] = [];
  if (explicit) candidates.push(explicit);
  if (stsPortalDir) candidates.push(path.join(stsPortalDir, "assets", "apk"));

  candidates.push(
    // Production VPS — STSPortal docroot (see scripts/cron_open_meteo_scan.sh).
    "/var/www/STSPortal/assets/apk",
    // Local dev — stsrenew and STSPortal are sibling folders under phpzone/src.
    path.resolve(process.cwd(), "../STSPortal/assets/apk"),
    path.resolve(process.cwd(), "../../STSPortal/assets/apk"),
  );

  return [...new Set(candidates)];
}

function resolveApkAssetsDir(): string | null {
  for (const dir of getApkAssetsDirCandidates()) {
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

function isApkAssetFile(name: string): boolean {
  if (!name.endsWith(".apk") || name.startsWith(".")) return false;
  return APK_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function resolveAndroidApkFileForSuffixes(
  filenameSuffixes: readonly string[],
): ResolvedAndroidApk | null {
  const apkDir = resolveApkAssetsDir();
  if (!apkDir) return null;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(apkDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const suffixSet = new Set(filenameSuffixes);
  const matches = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        [...suffixSet].some((suffix) => entry.name.endsWith(suffix)),
    )
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

/**
 * Auto-detect the newest APK in STSPortal `assets/apk/` whose name ends with
 * one of `filenameSuffixes` (e.g. `_production.apk`, `-production-release.apk`).
 */
export function resolveAndroidApkFile(
  filenameSuffixOrSuffixes: string | readonly string[],
): ResolvedAndroidApk | null {
  const suffixes = Array.isArray(filenameSuffixOrSuffixes)
    ? filenameSuffixOrSuffixes
    : [filenameSuffixOrSuffixes];
  return resolveAndroidApkFileForSuffixes(suffixes);
}

/** Direct browser download URL on STSPortal `assets/apk/` for the current deploy env. */
export function resolveAndroidApkFilename(): string | null {
  const resolved = resolveAndroidApkFile(getAndroidApkFilenameSuffixesFromEnv());
  if (resolved) return path.basename(resolved.absolutePath);

  const fromEnv = process.env.STS_ANDROID_APK_FILENAME?.trim();
  const suffix = getAndroidApkFilenameSuffixesFromEnv()[0];
  if (fromEnv && suffix && fromEnv.endsWith(suffix)) return fromEnv;

  return null;
}

/** Direct browser download URL on STSPortal `assets/apk/` for the current deploy env. */
export function resolveAndroidApkPublicUrl(): string | null {
  const filename = resolveAndroidApkFilename();
  if (!filename) return null;

  const base = getAndroidApkPublicBaseUrl();
  if (!base) return null;

  return `${base.replace(/\/$/, "")}/${filename}`;
}

/** Whether an APK exists for the current deploy env (`NEXT_PUBLIC_STS_API_BASE_URLS`). */
export function hasAndroidApkForEnv(): boolean {
  return resolveAndroidApkPublicUrl() != null;
}

/** @deprecated Prefer {@link hasAndroidApkForEnv}. */
export function hasAndroidApkForHost(_host: string): boolean {
  return hasAndroidApkForEnv();
}

/** Whether an APK exists for the given filename suffix(es). */
export function hasAndroidApkForSuffix(
  filenameSuffixOrSuffixes: string | readonly string[],
): boolean {
  return resolveAndroidApkFile(filenameSuffixOrSuffixes) != null;
}
