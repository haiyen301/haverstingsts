"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  fetchProjectFormCatalog,
  isArchitectCatalogKey,
  removeProjectFormCatalogRow,
  saveProjectFormCatalogRow,
  type ProjectFormCatalogRow,
} from "@/features/admin/api/adminApi";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const segment = "architect" as const;
const title = "Architects";
const subtitle = "Administration · Architects";
const kindLabel = "Architect";

const inputClass =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-50";
const btnPrimary =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";
const btnGhost =
  "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";
const btnSm =
  "inline-flex h-8 items-center justify-center rounded-md border border-input bg-background px-3 text-xs font-medium shadow-sm transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

function isActiveStatus(status: string | undefined): boolean {
  const s = (status ?? "").toLowerCase();
  return s === "active" || s === "1" || s === "yes";
}

function firstPlainLineFromValue(raw: string | null | undefined): string {
  if (raw == null || !String(raw).trim()) return "";
  const first = String(raw).split(/\r?\n/)[0] ?? "";
  return first.replace(/<[^>]*>/g, "").trim();
}

function catalogDisplayName(row: ProjectFormCatalogRow): string {
  return firstPlainLineFromValue(row.value) || row.setting_key;
}

function applyTitleToValue(prev: string | null | undefined, newTitle: string): string {
  const v = prev == null ? "" : String(prev);
  if (!v.trim()) return newTitle;
  const lines = v.split(/\r?\n/);
  lines[0] = newTitle;
  return lines.join("\n");
}

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
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        checked ? "bg-primary" : "bg-muted",
        disabled && "pointer-events-none opacity-50",
      )}
      onClick={() => !disabled && onCheckedChange(!checked)}
    >
      <span
        className={cn(
          "pointer-events-none block h-5 w-5 rounded-full bg-background shadow-md ring-0 transition-transform",
          checked ? "translate-x-5" : "translate-x-0.5",
        )}
        style={{ marginTop: 1 }}
      />
    </button>
  );
}

export function ArchitectCatalogTab() {
  const [rows, setRows] = useState<ProjectFormCatalogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [editKey, setEditKey] = useState<number | null>(null);
  const [editVal, setEditVal] = useState("");

  const load = useCallback(async () => {
    const data = await fetchProjectFormCatalog();
    setRows(data.filter((r) => isArchitectCatalogKey(r.setting_key)));
  }, []);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        await load();
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : "Failed to load catalog.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [load]);

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = () => {
    if (!newName.trim() || busy) return;
    void withBusy(async () => {
      await saveProjectFormCatalogRow({
        catalog_segment: segment,
        label: "",
        value: newName.trim(),
        route: "",
        active: true,
      });
      setNewName("");
    });
  };

  const persistRow = (
    row: ProjectFormCatalogRow,
    patch: { label?: string; active?: boolean; odoo_id?: string | null; value?: string | null },
  ) => {
    void withBusy(async () => {
      const payload: Parameters<typeof saveProjectFormCatalogRow>[0] = {
        id: row.id,
        catalog_segment: segment,
        label: patch.label !== undefined ? patch.label : (row.label ?? ""),
        route: row.route ?? "",
        sort_order: row.sort_order,
        active: patch.active ?? isActiveStatus(row.status),
        odoo_id: patch.odoo_id !== undefined ? patch.odoo_id : (row.odoo_id ?? null),
      };
      if (patch.value !== undefined) payload.value = patch.value;
      await saveProjectFormCatalogRow(payload);
    });
  };

  return (
    <div className="space-y-6 p-4 text-foreground lg:p-8">
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground lg:text-3xl">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loading ? (
        <>
          <Card>
            <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:gap-2">
              <input
                className={inputClass}
                placeholder={`New ${kindLabel.toLowerCase()} name…`}
                value={newName}
                disabled={busy}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              />
              <button type="button" className={btnPrimary} disabled={busy} onClick={handleAdd}>
                <Plus className="h-4 w-4" />
                Add
              </button>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full caption-bottom text-sm">
                  <thead className="border-b border-border [&_tr]:border-b">
                    <tr className="border-b border-border transition-colors">
                      <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                        Title (from value)
                      </th>
                      <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                        Status
                      </th>
                      <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                        Odoo ID
                      </th>
                      <th className="h-10 px-4 text-right align-middle font-medium text-muted-foreground">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="[&_tr:last-child]:border-0">
                    {rows.map((row) => {
                      const isEditing = editKey === row.id;
                      const active = isActiveStatus(row.status);
                      return (
                        <tr key={row.id} className="border-b border-border transition-colors hover:bg-muted/40">
                          <td className="p-2 px-4 align-middle">
                            {isEditing ? (
                              <input
                                className={cn(inputClass, "h-8")}
                                value={editVal}
                                disabled={busy}
                                onChange={(e) => setEditVal(e.target.value)}
                              />
                            ) : (
                              <span className="text-sm font-medium">{catalogDisplayName(row)}</span>
                            )}
                          </td>
                          <td className="p-2 px-4 align-middle">
                            <div className="flex items-center gap-2">
                              <CatalogSwitch
                                checked={active}
                                disabled={busy}
                                onCheckedChange={(v) => persistRow(row, { active: v })}
                              />
                              <span className="text-xs text-muted-foreground">
                                {active ? "Active" : "Inactive"}
                              </span>
                            </div>
                          </td>
                          <td className="p-2 px-4 align-middle">
                            <input
                              className={cn(inputClass, "h-8 max-w-[160px]")}
                              placeholder="—"
                              disabled={busy}
                              value={row.odoo_id ?? ""}
                              onChange={(e) =>
                                setRows((prev) =>
                                  prev.map((r) => (r.id === row.id ? { ...r, odoo_id: e.target.value } : r)),
                                )
                              }
                              onBlur={(e) => persistRow(row, { odoo_id: e.target.value.trim() || null })}
                            />
                          </td>
                          <td className="p-2 px-4 text-right align-middle">
                            <div className="flex items-center justify-end gap-1">
                              {isEditing ? (
                                <>
                                  <button
                                    type="button"
                                    className={btnSm}
                                    disabled={busy}
                                    onClick={() => {
                                      if (!editVal.trim()) return;
                                      setEditKey(null);
                                      persistRow(row, {
                                        label: "",
                                        value: applyTitleToValue(row.value, editVal.trim()),
                                      });
                                    }}
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    className={cn(btnSm, "border-transparent shadow-none hover:bg-muted")}
                                    disabled={busy}
                                    onClick={() => setEditKey(null)}
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    className={btnGhost}
                                    disabled={busy}
                                    onClick={() => {
                                      setEditKey(row.id);
                                      setEditVal(
                                        firstPlainLineFromValue(row.value ?? row.label) || catalogDisplayName(row),
                                      );
                                    }}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    className={cn(btnGhost, "text-destructive")}
                                    disabled={busy}
                                    onClick={() =>
                                      void withBusy(async () => {
                                        await removeProjectFormCatalogRow(row.id, segment);
                                      })
                                    }
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
