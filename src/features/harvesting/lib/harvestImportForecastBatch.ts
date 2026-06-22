/** Matches `ForecastImportBatch::KIND` on STSPortal. */
export const HARVEST_IMPORT_FORECAST_BATCH_KIND = "harvest_import" as const;

/** Matches `ForecastImportBatch::CLIENT_SOURCE` on STSPortal. */
export const HARVEST_IMPORT_CLIENT_SOURCE = "harvest_import" as const;

export type HarvestImportForecastBatch = {
  kind: typeof HARVEST_IMPORT_FORECAST_BATCH_KIND;
  session_id: string;
  index: number;
  total: number;
};

export type ProjectPaceForecastBatch = {
  kind: "project_pace";
  from_date: string;
  to_date: string;
  index: number;
  total: number;
};

export type HarvestForecastBatch =
  | ProjectPaceForecastBatch
  | HarvestImportForecastBatch;

export function createHarvestImportSessionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `harvest-import-${Date.now()}`;
}

export function createHarvestImportForecastBatch(
  sessionId: string,
  index: number,
  total: number,
): HarvestImportForecastBatch {
  return {
    kind: HARVEST_IMPORT_FORECAST_BATCH_KIND,
    session_id: sessionId.trim(),
    index,
    total: Math.max(1, total),
  };
}
