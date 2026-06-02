"use client";

import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";

import {
  buildProjectHarvestExportFileName,
  defaultSelectedHarvestPlanExportColumns,
  discoverHarvestPlanExportColumns,
  exportHarvestPlanRowsToXlsx,
  projectDetailHarvestExportColumnLabel,
  type HarvestPlanExportResolveContext,
} from "@/features/project/lib/projectHarvestPlanExport";
import { canAccessModule } from "@/shared/auth/permissions";
import { useAppTranslations } from "@/shared/i18n/useAppTranslations";
import { useAuthUserStore } from "@/shared/store/authUserStore";
import { Checkbox } from "@/shared/ui/checkbox";
import { cn } from "@/lib/utils";
import { bgSurfaceFilter } from "@/shared/lib/surfaceFilter";

type Props = {
  open: boolean;
  onClose: () => void;
  rows: Array<Record<string, unknown>>;
  projectId: string;
  projectLabel: string;
  resolveContext: HarvestPlanExportResolveContext;
};

export function ProjectDetailHarvestExportDialog({
  open,
  onClose,
  rows,
  projectId,
  projectLabel,
  resolveContext,
}: Props) {
  const t = useAppTranslations("ProjectDetail");
  const tCommon = useAppTranslations("Common");
  const user = useAuthUserStore((s) => s.user);
  const canExportHarvest = canAccessModule(user, "harvests", "export");
  const allColumns = useMemo(() => discoverHarvestPlanExportColumns(rows), [rows]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open) return;
    setSelected(defaultSelectedHarvestPlanExportColumns(allColumns));
  }, [open, allColumns]);

  if (!open) return null;

  const selectedColumns = allColumns.filter((col) => selected[col]);

  const columnLabel = (key: string): string =>
    projectDetailHarvestExportColumnLabel(t, key);

  const toggleColumn = (key: string) => {
    setSelected((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const setAll = (value: boolean) => {
    setSelected(
      Object.fromEntries(allColumns.map((col) => [col, value])) as Record<
        string,
        boolean
      >,
    );
  };

  const onExport = () => {
    if (!canExportHarvest) return;
    if (rows.length === 0 || selectedColumns.length === 0) return;
    exportHarvestPlanRowsToXlsx({
      rows,
      selectedColumns,
      fileName: buildProjectHarvestExportFileName(projectLabel, projectId),
      columnLabel,
      resolveContext,
    });
    onClose();
  };

  const actionBtnClass =
    "inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md border border-border px-3 text-sm font-medium text-foreground ring-offset-background transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-card text-card-foreground shadow-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="harvest-export-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-1.5 border-b border-border p-6 pb-4">
          <h2
            id="harvest-export-title"
            className="text-base font-semibold leading-none tracking-tight text-foreground"
          >
            {t("exportExcelTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("exportExcelHint")}</p>
          <p className="text-sm font-medium text-foreground">
            {t("exportExcelRowCount", { count: rows.length })}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6 pt-4">
          <div className="mb-4 flex flex-wrap gap-2">
            <button
              type="button"
              className={cn(actionBtnClass, bgSurfaceFilter(false))}
              onClick={() => setAll(true)}
            >
              {t("exportSelectAll")}
            </button>
            <button
              type="button"
              className={cn(actionBtnClass, bgSurfaceFilter(false))}
              onClick={() => setAll(false)}
            >
              {t("exportDeselectAll")}
            </button>
          </div>
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("exportSelectColumns")}
          </p>
          <ul className="grid max-h-[42vh] gap-2 overflow-y-auto sm:grid-cols-2">
            {allColumns.map((col) => {
              const checked = Boolean(selected[col]);
              return (
                <li key={col}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-muted/50",
                      bgSurfaceFilter(checked),
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onChange={() => toggleColumn(col)}
                    />
                    <span className="min-w-0 flex-1 leading-snug">
                      {columnLabel(col)}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex justify-end gap-2 border-t border-border p-6">
          <button
            type="button"
            className={cn(actionBtnClass, "bg-background")}
            onClick={onClose}
          >
            {tCommon("cancel")}
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"
            disabled={rows.length === 0 || selectedColumns.length === 0}
            onClick={onExport}
          >
            <Download className="h-4 w-4" aria-hidden />
            {t("exportExcelDownload")}
          </button>
        </div>
      </div>
    </div>
  );
}
