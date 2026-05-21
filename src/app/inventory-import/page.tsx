"use client";

import { useMemo, useState } from "react";
import { Download, Upload } from "lucide-react";
import * as XLSX from "xlsx";

import RequireAuth from "@/features/auth/RequireAuth";
import { useAppTranslations } from "@/shared/i18n/useAppTranslations";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import { cn } from "@/lib/utils";
import { bgSurfaceFilter } from "@/shared/lib/surfaceFilter";

type RowValue = Record<string, unknown>;

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function toNumberString(value: string): string {
  const cleaned = value.trim();
  if (!cleaned) return "";
  return /^\d+$/.test(cleaned) ? cleaned : "";
}

function cellDisplay(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number" && !Number.isFinite(value)) return "";
  return String(value);
}

export default function InventoryImportPage() {
  const tBase = useAppTranslations();
  const t = (
    key: string,
    values?: Record<string, string | number | boolean | null | undefined>,
  ) =>
    values
      ? tBase(`InventoryOnhandImport.${key}`, values as Parameters<typeof tBase>[1])
      : tBase(`InventoryOnhandImport.${key}`);

  const [rawFileName, setRawFileName] = useState("");
  const [rows, setRows] = useState<RowValue[]>([]);
  const [country, setCountry] = useState("");
  const [error, setError] = useState("");

  const rowCount = rows.length;
  const normalizedCountry = useMemo(() => toNumberString(country), [country]);

  const previewRows = useMemo(() => {
    return rows.map((row, index) => ({
      index: index + 1,
      skuSts: cellDisplay(row["Sku STS"]),
      onHand: cellDisplay(row["On Hand"]),
      country: normalizedCountry || "",
    }));
  }, [rows, normalizedCountry]);

  const handleRawFile = async (file: File) => {
    setError("");
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    const firstSheet = workbook.Sheets[firstSheetName];

    if (!firstSheet || !firstSheet["!ref"]) {
      setRows([]);
      setRawFileName(file.name);
      setError(t("invalidSheet"));
      return;
    }

    const range = XLSX.utils.decode_range(firstSheet["!ref"]);
    const headerRow = XLSX.utils.sheet_to_json<(string | undefined)[]>(firstSheet, {
      header: 1,
      range: range.s.r,
      blankrows: false,
    })[0] ?? [];

    const aliasColIndex = headerRow.findIndex((headerCell) => {
      return normalizeHeader(String(headerCell ?? "")) === "alias";
    });
    const quantityColIndex = headerRow.findIndex((headerCell) => {
      return normalizeHeader(String(headerCell ?? "")) === "quantity";
    });

    if (aliasColIndex < 0 || quantityColIndex < 0) {
      setRows([]);
      setRawFileName(file.name);
      setError(t("missingColumns"));
      return;
    }

    const outRows: RowValue[] = [];
    for (let r = range.s.r + 1; r <= range.e.r; r += 1) {
      const aliasCell = firstSheet[XLSX.utils.encode_cell({ r, c: aliasColIndex })];
      const quantityCell = firstSheet[XLSX.utils.encode_cell({ r, c: quantityColIndex })];
      outRows.push({
        "Sku STS": aliasCell?.v ?? "",
        "On Hand": quantityCell?.v ?? "",
      });
    }

    setRows(outRows);
    setRawFileName(file.name);
  };

  const handleExport = () => {
    if (!rows.length) return;
    if (!normalizedCountry) {
      setError(t("countryRequired"));
      return;
    }

    const resultRows = rows.map((row) => ({
      "Sku STS": row["Sku STS"] ?? "",
      "On Hand": row["On Hand"] ?? "",
      Country: normalizedCountry,
    }));
    const worksheet = XLSX.utils.json_to_sheet(resultRows, {
      header: ["Sku STS", "On Hand", "Country"],
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "ImportInventory");
    XLSX.writeFile(workbook, "import-inventory-from-raw.xlsx");
    setError("");
  };

  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="p-4 lg:p-8 space-y-6">
          <div>
            <h1 className="text-2xl lg:text-3xl font-semibold text-gray-900">{t("title")}</h1>
            <p className="mt-2 text-sm text-gray-600">{t("subtitle")}</p>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-button-primary px-4 py-2 text-white hover:bg-[#196A40]">
              <Upload className="h-4 w-4" />
              {t("uploadRaw")}
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleRawFile(file);
                }}
              />
            </label>
            {rawFileName ? (
              <p className="text-sm text-gray-600">
                {t("rawFile")}: {rawFileName}
              </p>
            ) : null}
            <p className="text-sm text-gray-600">
              {t("rowsDetected")}: <span className="font-semibold">{rowCount}</span>
            </p>
          </div>

          {rows.length ? (
            <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{t("previewTitle")}</h2>
                <p className="mt-1 text-sm text-gray-600">{t("previewHint")}</p>
                {!normalizedCountry ? (
                  <p className="mt-1 text-sm text-amber-700">{t("previewCountryPending")}</p>
                ) : null}
              </div>
              <div className="overflow-auto rounded-md border border-gray-200 max-h-[min(720px,75vh)]">
                <table className="min-w-full text-sm text-left">
                  <thead className="bg-gray-50 sticky top-0 z-1">
                    <tr>
                      <th className="px-3 py-2 font-medium text-gray-700 w-14">{t("tableIndex")}</th>
                      <th className="px-3 py-2 font-medium text-gray-700">{t("tableSkuSts")}</th>
                      <th className="px-3 py-2 font-medium text-gray-700">{t("tableOnHand")}</th>
                      <th className="px-3 py-2 font-medium text-gray-700">{t("tableCountry")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row) => (
                      <tr key={row.index} className="border-t border-gray-100">
                        <td className="px-3 py-2 text-gray-500 tabular-nums">{row.index}</td>
                        <td className="px-3 py-2 text-gray-900 max-w-[180px] truncate" title={row.skuSts}>
                          {row.skuSts || "—"}
                        </td>
                        <td className="px-3 py-2 text-gray-900 tabular-nums">{row.onHand || "—"}</td>
                        <td className="px-3 py-2 text-gray-900 tabular-nums">
                          {row.country || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-500">{t("previewAllRows", { total: rowCount })}</p>
            </div>
          ) : null}

          <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
            <label className="block text-sm text-gray-700" htmlFor="country-id-input">
              {t("countryLabel")}
            </label>
            <input
              id="country-id-input"
              type="text"
              inputMode="numeric"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder={t("countryPlaceholder")}
              className={cn(
                "w-full max-w-xs rounded-lg border border-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground",
                bgSurfaceFilter(!!country.trim()),
              )}
            />
            <button
              type="button"
              onClick={handleExport}
              disabled={!rows.length}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {t("download")}
            </button>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
          </div>
        </div>
      </DashboardLayout>
    </RequireAuth>
  );
}
