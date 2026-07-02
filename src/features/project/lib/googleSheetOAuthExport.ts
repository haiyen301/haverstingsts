import type { ProjectListGoogleSheetExportPayload } from "@/features/project/lib/projectListExport";
import type { ProjectListGoogleSheetConfig } from "@/features/project/config/projectListGoogleSheetConfig";
import {
  fetchProjectExportHarvestImageBuffer,
  isPublicHttpsImageUrl,
  mimeTypeToDriveExtension,
  uploadExportImageToGoogleDrive,
} from "@/shared/server/projectListExportHarvestImage";

export type GoogleSheetExportResult = {
  spreadsheetId: string;
  spreadsheetUrl: string;
  sheetTitle: string;
};

function buildSpreadsheetTitle(): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `STS Projects Export ${stamp}`;
}

async function resolveGoogleSheetImageUri(opts: {
  accessToken: string;
  sourceUrl: string;
  stsAuthorization?: string | null;
}): Promise<string | null> {
  const sourceUrl = opts.sourceUrl.trim();
  if (!sourceUrl) return null;
  if (isPublicHttpsImageUrl(sourceUrl)) return sourceUrl;

  const fetched = await fetchProjectExportHarvestImageBuffer(
    sourceUrl,
    opts.stsAuthorization,
  );
  if (!fetched) return null;

  const ext = mimeTypeToDriveExtension(fetched.contentType);
  const fileName = `sts-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  return uploadExportImageToGoogleDrive({
    accessToken: opts.accessToken,
    buffer: fetched.buffer,
    contentType: fetched.contentType,
    fileName,
  });
}

export async function writeProjectListToUserGoogleSheet(opts: {
  accessToken: string;
  config: ProjectListGoogleSheetConfig;
  payload: ProjectListGoogleSheetExportPayload;
  stsAuthorization?: string | null;
}): Promise<GoogleSheetExportResult> {
  const { accessToken, config, payload } = opts;
  const tabName = payload.sheetTabName?.trim() || config.sheetTabName;
  const tabs =
    payload.tabs && payload.tabs.length > 0
      ? payload.tabs
      : [
          {
            sheetTabName: tabName,
            headers: payload.headers,
            rows: payload.rows,
          },
        ];
  const title = payload.spreadsheetTitle?.trim() || buildSpreadsheetTitle();

  const createRes = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      properties: { title },
      sheets: tabs.map((tab) => ({
        properties: { title: tab.sheetTabName.slice(0, 100) },
      })),
    }),
    cache: "no-store",
  });

  const created = (await createRes.json().catch(() => ({}))) as {
    spreadsheetId?: string;
    spreadsheetUrl?: string;
    sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
    error?: { message?: string };
  };

  if (!createRes.ok || !created.spreadsheetId) {
    throw new Error(
      created.error?.message ??
        `Could not create spreadsheet (${createRes.status}).`,
    );
  }

  const spreadsheetId = created.spreadsheetId;
  const createdSheets = created.sheets ?? [];
  const batchData = tabs.map((tab, index) => {
    const sheetTitle =
      createdSheets[index]?.properties?.title?.trim() || tab.sheetTabName;
    return {
      range: `${sheetTitle}!A1`,
      values: [tab.headers, ...tab.rows],
    };
  });

  const batchUpdateRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        valueInputOption: "RAW",
        data: batchData,
      }),
      cache: "no-store",
    },
  );

  const batchUpdated = (await batchUpdateRes.json().catch(() => ({}))) as {
    error?: { message?: string };
  };
  if (!batchUpdateRes.ok) {
    throw new Error(
      batchUpdated.error?.message ??
        `Could not write spreadsheet data (${batchUpdateRes.status}).`,
    );
  }

  const sheetId = createdSheets[0]?.properties?.sheetId ?? 0;

  const layoutRequests: Array<Record<string, unknown>> = [];

  for (const merge of payload.mergeRanges ?? []) {
    layoutRequests.push({
      mergeCells: {
        range: {
          sheetId,
          startRowIndex: merge.startRowIndex + 1,
          endRowIndex: merge.endRowIndex + 1,
          startColumnIndex: merge.startColumnIndex,
          endColumnIndex: merge.endColumnIndex,
        },
        mergeType: "MERGE_ALL",
      },
    });
  }

  for (const fill of payload.cellFills ?? []) {
    layoutRequests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: fill.startRowIndex + 1,
          endRowIndex: fill.endRowIndex + 1,
          startColumnIndex: fill.startColumnIndex,
          endColumnIndex: fill.endColumnIndex,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: {
              red: fill.red,
              green: fill.green,
              blue: fill.blue,
            },
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat.backgroundColor,userEnteredFormat.verticalAlignment",
      },
    });
  }

  if (layoutRequests.length > 0) {
    const layoutRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requests: layoutRequests }),
        cache: "no-store",
      },
    );
    const layoutBody = (await layoutRes.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    if (!layoutRes.ok) {
      throw new Error(
        layoutBody.error?.message ??
          `Could not format spreadsheet (${layoutRes.status}).`,
      );
    }
  }

  const imageCells = payload.imageCells ?? [];
  if (imageCells.length > 0) {
    const requests: Array<Record<string, unknown>> = [];
    for (const cell of imageCells) {
      const uri = await resolveGoogleSheetImageUri({
        accessToken,
        sourceUrl: cell.sourceUrl,
        stsAuthorization: opts.stsAuthorization,
      });
      if (!uri) continue;
      requests.push({
        insertImage: {
          uri,
          sheetId,
          upperLeftRow: cell.rowIndex + 1,
          upperLeftColumn: cell.columnIndex,
          width: 100,
          height: 75,
        },
      });
    }

    if (requests.length > 0) {
      const imageRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ requests }),
          cache: "no-store",
        },
      );
      const imageBody = (await imageRes.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!imageRes.ok) {
        throw new Error(
          imageBody.error?.message ??
            `Could not embed images (${imageRes.status}).`,
        );
      }
    }
  }

  return {
    spreadsheetId,
    spreadsheetUrl:
      created.spreadsheetUrl ??
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    sheetTitle: title,
  };
}
