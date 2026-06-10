import type { HarvestListGoogleSheetExportPayload } from "@/features/harvest/lib/harvestListExport";
import { DEMO_HARVEST_GOOGLE_SHEET_RETURN_PATH } from "@/features/harvest/lib/harvestExportDemoOAuthPaths";

export { DEMO_HARVEST_GOOGLE_SHEET_RETURN_PATH };

export const PENDING_DEMO_HARVEST_GOOGLE_SHEET_EXPORT_KEY =
  "sts_pending_demo_harvest_google_sheet_export";

export type PendingDemoHarvestGoogleSheetExport = {
  selectedColumns: string[];
  savedAt: number;
};

export function savePendingDemoHarvestGoogleSheetExport(
  pending: Omit<PendingDemoHarvestGoogleSheetExport, "savedAt">,
): void {
  if (typeof window === "undefined") return;
  const payload: PendingDemoHarvestGoogleSheetExport = {
    ...pending,
    savedAt: Date.now(),
  };
  sessionStorage.setItem(
    PENDING_DEMO_HARVEST_GOOGLE_SHEET_EXPORT_KEY,
    JSON.stringify(payload),
  );
}

export function readPendingDemoHarvestGoogleSheetExport(): PendingDemoHarvestGoogleSheetExport | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(PENDING_DEMO_HARVEST_GOOGLE_SHEET_EXPORT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingDemoHarvestGoogleSheetExport;
    if (!Array.isArray(parsed.selectedColumns)) return null;
    if (Date.now() - (parsed.savedAt ?? 0) > 1000 * 60 * 30) {
      clearPendingDemoHarvestGoogleSheetExport();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingDemoHarvestGoogleSheetExport(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(PENDING_DEMO_HARVEST_GOOGLE_SHEET_EXPORT_KEY);
}

export function startDemoHarvestGoogleSheetOAuth(): void {
  const target = `${DEMO_HARVEST_GOOGLE_SHEET_RETURN_PATH}?googleSheetExport=resume`;
  const url = `/api/projects/export/google-sheet/oauth/authorize?returnTo=${encodeURIComponent(target)}`;
  window.location.assign(url);
}

export async function exportDemoHarvestRowsToGoogleSheet(
  payload: HarvestListGoogleSheetExportPayload,
): Promise<{
  ok: boolean;
  message?: string;
  needsAuth?: boolean;
  authorizePath?: string;
  spreadsheetUrl?: string;
}> {
  const res = await fetch("/api/test/harvest-export/google-sheet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    message?: string;
    needsAuth?: boolean;
    authorizePath?: string;
    spreadsheetUrl?: string;
  };
  if (data.needsAuth) {
    return {
      ok: false,
      needsAuth: true,
      authorizePath:
        data.authorizePath ??
        "/api/projects/export/google-sheet/oauth/authorize",
      message: data.message,
    };
  }
  if (!res.ok || !data.ok) {
    return {
      ok: false,
      message: data.message ?? `Google Sheet export failed (${res.status}).`,
    };
  }
  return {
    ok: true,
    message: data.message,
    spreadsheetUrl: data.spreadsheetUrl,
  };
}
