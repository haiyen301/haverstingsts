const STORAGE_KEY = "sts_renew_harvest_duplicate_draft_v1";

const HANDOFF_KEY = "__STS_HARVEST_DUP_ROW__" as const;

type DraftEnvelope = {
  v: 1;
  row: Record<string, unknown>;
};

function win(): Window | undefined {
  return typeof window !== "undefined" ? window : undefined;
}

export function stashHarvestDuplicateFromApiRow(row: Record<string, unknown>): void {
  const w = win();
  if (!w) return;
  const env: DraftEnvelope = { v: 1, row };
  w.localStorage.setItem(STORAGE_KEY, JSON.stringify(env));
}

/**
 * Reads duplicate source row from `localStorage`, clears storage, then supports a
 * second read in React Strict Mode via a short-lived `window` handoff. In production
 * (single effect), a microtask clears the handoff so later visits are not polluted.
 */
export function peelHarvestDuplicateDraftRow(): Record<string, unknown> | null {
  const w = win();
  if (!w) return null;

  const fromHandoff = (w as unknown as Record<string, unknown>)[HANDOFF_KEY] as
    | Record<string, unknown>
    | undefined;
  if (fromHandoff) {
    Reflect.deleteProperty(w as unknown as Record<string, unknown>, HANDOFF_KEY);
    return fromHandoff;
  }

  const raw = w.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DraftEnvelope;
    w.localStorage.removeItem(STORAGE_KEY);
    if (parsed?.v !== 1 || !parsed.row || typeof parsed.row !== "object") {
      return null;
    }
    const row = parsed.row as Record<string, unknown>;
    (w as unknown as Record<string, unknown>)[HANDOFF_KEY] = row;
    queueMicrotask(() => {
      const cur = (w as unknown as Record<string, unknown>)[HANDOFF_KEY];
      if (cur === row) {
        Reflect.deleteProperty(w as unknown as Record<string, unknown>, HANDOFF_KEY);
      }
    });
    return row;
  } catch {
    w.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}
