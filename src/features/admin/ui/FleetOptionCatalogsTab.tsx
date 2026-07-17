"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  FLEET_OPTION_CATALOG_KEYS,
  fetchFleetOptionCatalog,
  removeFleetOptionCatalogRow,
  saveFleetOptionCatalogRow,
  type FleetOptionCatalogKey,
  type FleetOptionCatalogRow,
} from "@/features/fleet/api/fleetOptionCatalogApi";
import { clearFleetOptionCatalogCache } from "@/features/fleet/hooks/useFleetOptionCatalog";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ConfirmDeleteDialog } from "@/shared/ui/ConfirmDeleteDialog";
import { useModuleAccess } from "@/shared/auth/useModuleAccess";

const inputClass =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-50";
const btnPrimary =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";
const btnIcon =
  "inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent transition-colors hover:border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";
const btnSm =
  "inline-flex h-8 items-center justify-center rounded-md border border-input bg-background px-3 text-xs font-medium shadow-sm transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

const CATALOGS: FleetOptionCatalogKey[] = [
  FLEET_OPTION_CATALOG_KEYS.inspectionStatuses,
  FLEET_OPTION_CATALOG_KEYS.equipmentServiceTypes,
  FLEET_OPTION_CATALOG_KEYS.fuelTypes,
];

function CatalogSwitch({
  checked,
  onCheckedChange,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        checked ? "bg-primary" : "bg-muted-foreground/25",
        disabled && "pointer-events-none opacity-50",
      )}
      onClick={() => !disabled && onCheckedChange(!checked)}
    >
      <span
        className={cn(
          "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-sm ring-0 transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5",
        )}
        style={{ marginTop: 1 }}
      />
    </button>
  );
}

function CatalogSection({
  catalog,
  title,
  hint,
  showValueColumn,
}: {
  catalog: FleetOptionCatalogKey;
  title: string;
  hint: string;
  showValueColumn?: boolean;
}) {
  const t = useTranslations("AdminFleetOptionCatalogs");
  const tCommon = useTranslations("Common");
  const { canCreate, canEdit, canDelete } = useModuleAccess("admin_fleet_option_catalogs");
  const [rows, setRows] = useState<FleetOptionCatalogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newValue, setNewValue] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editValue, setEditValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<FleetOptionCatalogRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    const data = await fetchFleetOptionCatalog(catalog, true);
    setRows(data);
  }, [catalog]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        await load();
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : t("loadError"));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [load, t]);

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      clearFleetOptionCatalogCache(catalog);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("requestFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = () => {
    if (!newLabel.trim() || busy) return;
    void withBusy(async () => {
      await saveFleetOptionCatalogRow(catalog, {
        label: newLabel.trim(),
        value: newValue.trim() || undefined,
        active: true,
      });
      setNewLabel("");
      setNewValue("");
    });
  };

  const persistRow = (
    row: FleetOptionCatalogRow,
    patch: { label?: string; value?: string; active?: boolean },
  ) => {
    void withBusy(async () => {
      await saveFleetOptionCatalogRow(catalog, {
        id: row.id,
        label: patch.label ?? row.label,
        value: patch.value ?? row.value,
        sort_order: row.sort_order,
        active: patch.active ?? row.active,
      });
    });
  };

  return (
    <Card>
      <CardHeader className="border-b border-border/60">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
        <CardDescription className="text-sm">{hint}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4 pt-5">
        {loading ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : null}
        {error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {!loading ? (
          <>
            {canCreate ? (
              <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                <div
                  className={cn(
                    "grid gap-2",
                    showValueColumn ? "sm:grid-cols-[1fr_1fr_auto]" : "sm:grid-cols-[1fr_auto]",
                  )}
                >
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">{t("colLabel")}</label>
                    <input
                      className={inputClass}
                      placeholder={t("newLabelPlaceholder")}
                      value={newLabel}
                      disabled={busy}
                      onChange={(e) => setNewLabel(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                    />
                  </div>
                  {showValueColumn ? (
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">{t("colValue")}</label>
                      <input
                        className={inputClass}
                        placeholder={t("newValuePlaceholder")}
                        value={newValue}
                        disabled={busy}
                        onChange={(e) => setNewValue(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                      />
                    </div>
                  ) : null}
                  <div className="flex items-end">
                    <button
                      type="button"
                      className={cn(btnPrimary, "w-full sm:w-auto")}
                      disabled={busy || !newLabel.trim()}
                      onClick={handleAdd}
                    >
                      <Plus className="h-4 w-4" />
                      {t("add")}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full caption-bottom text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t("colLabel")}
                    </th>
                    {showValueColumn ? (
                      <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {t("colValue")}
                      </th>
                    ) : null}
                    <th className="w-24 px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t("colActive")}
                    </th>
                    <th className="w-28 px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t("colActions")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-border/70 transition-colors last:border-b-0 hover:bg-muted/20"
                    >
                      <td className="px-4 py-2.5 align-middle">
                        {editId === row.id ? (
                          <input
                            className={inputClass}
                            value={editLabel}
                            disabled={busy}
                            onChange={(e) => setEditLabel(e.target.value)}
                          />
                        ) : (
                          <span className="font-medium text-foreground">{row.label}</span>
                        )}
                      </td>
                      {showValueColumn ? (
                        <td className="px-4 py-2.5 align-middle">
                          {editId === row.id ? (
                            <input
                              className={inputClass}
                              value={editValue}
                              disabled={busy}
                              onChange={(e) => setEditValue(e.target.value)}
                            />
                          ) : (
                            <code className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                              {row.value}
                            </code>
                          )}
                        </td>
                      ) : null}
                      <td className="px-4 py-2.5 align-middle">
                        <CatalogSwitch
                          checked={row.active !== false}
                          disabled={busy || !canEdit}
                          onCheckedChange={(active) => persistRow(row, { active })}
                        />
                      </td>
                      <td className="px-4 py-2.5 align-middle">
                        {canEdit || canDelete ? (
                          <div className="flex items-center justify-end gap-0.5">
                            {editId === row.id ? (
                              <>
                                <button
                                  type="button"
                                  className={btnSm}
                                  disabled={busy}
                                  onClick={() => setEditId(null)}
                                >
                                  {tCommon("cancel")}
                                </button>
                                {canEdit ? (
                                  <button
                                    type="button"
                                    className={btnSm}
                                    disabled={busy || !editLabel.trim()}
                                    onClick={() => {
                                      persistRow(row, {
                                        label: editLabel.trim(),
                                        value: editValue.trim() || row.value,
                                      });
                                      setEditId(null);
                                    }}
                                  >
                                    {tCommon("save")}
                                  </button>
                                ) : null}
                              </>
                            ) : (
                              <>
                                {canEdit ? (
                                  <button
                                    type="button"
                                    className={btnIcon}
                                    disabled={busy}
                                    aria-label={tCommon("edit")}
                                    onClick={() => {
                                      setEditId(row.id);
                                      setEditLabel(row.label);
                                      setEditValue(row.value);
                                    }}
                                  >
                                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                                  </button>
                                ) : null}
                                {canDelete ? (
                                  <button
                                    type="button"
                                    className={cn(btnIcon, "hover:border-destructive/30 hover:bg-destructive/10")}
                                    disabled={busy}
                                    aria-label={tCommon("delete")}
                                    onClick={() => setDeleteTarget(row)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                  </button>
                                ) : null}
                              </>
                            )}
                          </div>
                        ) : (
                          <span className="block text-right text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={showValueColumn ? 4 : 3}
                        className="px-4 py-10 text-center text-sm text-muted-foreground"
                      >
                        {t("empty")}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        <ConfirmDeleteDialog
          open={deleteTarget != null}
          title={t("deleteTitle")}
          message={t("deleteDescription", { name: deleteTarget?.label ?? "" })}
          cancelLabel={tCommon("cancel")}
          confirmLabel={tCommon("delete")}
          deleting={deleting}
          deletingLabel={tCommon("deleting")}
          onCancel={() => {
            if (!deleting) setDeleteTarget(null);
          }}
          onConfirm={() => {
            if (!deleteTarget || deleting) return;
            void (async () => {
              try {
                setDeleting(true);
                await removeFleetOptionCatalogRow(catalog, deleteTarget.id);
                clearFleetOptionCatalogCache(catalog);
                setDeleteTarget(null);
                await load();
              } catch (e) {
                setError(e instanceof Error ? e.message : t("requestFailed"));
              } finally {
                setDeleting(false);
              }
            })();
          }}
        />
      </CardContent>

      {!loading && rows.length > 0 ? (
        <CardFooter className="border-t border-border/60 bg-muted/10 py-3 text-xs text-muted-foreground">
          {t("optionCount", { count: rows.length })}
        </CardFooter>
      ) : null}
    </Card>
  );
}

export function FleetOptionCatalogsTab() {
  const t = useTranslations("AdminFleetOptionCatalogs");

  return (
    <div className="w-full space-y-6 p-4 lg:p-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="space-y-5">
        {CATALOGS.map((catalog) => (
          <CatalogSection
            key={catalog}
            catalog={catalog}
            title={t(`catalogs.${catalog}.title`)}
            hint={t(`catalogs.${catalog}.hint`)}
            showValueColumn
          />
        ))}
      </div>
    </div>
  );
}
