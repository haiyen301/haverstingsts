"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { GripVertical, Pencil, Plus, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import RequireAuth from "@/features/auth/RequireAuth";
import {
  fetchKeyAreas,
  keyAreaListInAlphaOrder,
  removeKeyArea,
  saveKeyArea,
  sortKeyAreaRows,
  type KeyAreaRow,
} from "@/features/admin/api/adminApi";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const inputClass =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";
const btnOutline =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const btnPrimary =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const btnGhost =
  "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type FormState = {
  id?: number;
  title: string;
};

function emptyForm(): FormState {
  return { title: "" };
}

function withSortOrders(list: KeyAreaRow[]): KeyAreaRow[] {
  return list.map((row, index) => ({
    ...row,
    sort_order: (index + 1) * 10,
  }));
}

function reorderKeyAreaList(
  list: KeyAreaRow[],
  sourceId: number,
  insertAt: number,
): KeyAreaRow[] {
  const next = [...list];
  const fromIndex = next.findIndex((r) => Number(r.id) === sourceId);
  if (fromIndex < 0) return list;
  const n = next.length;
  const clamped = Math.max(0, Math.min(insertAt, n));
  let insert = clamped;
  if (fromIndex < insert) insert -= 1;
  const [removed] = next.splice(fromIndex, 1);
  next.splice(insert, 0, removed);
  return next;
}

function DropInsertionLine({ colSpan }: { colSpan: number }) {
  return (
    <tr aria-hidden className="border-0 bg-transparent">
      <td colSpan={colSpan} className="p-0">
        <div className="mx-2 my-0.5 h-0.5 rounded-full bg-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.35)]" />
      </td>
    </tr>
  );
}

export default function AdminKeyAreasPage() {
  const t = useTranslations("AdminKeyAreas");
  const [rows, setRows] = useState<KeyAreaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [dragRowId, setDragRowId] = useState<number | null>(null);
  const [dropInsertPreview, setDropInsertPreview] = useState<number | null>(null);
  const dropInsertRef = useRef<number | null>(null);

  const setDropSlot = useCallback((index: number | null) => {
    dropInsertRef.current = index;
    setDropInsertPreview(index);
  }, []);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchKeyAreas();
      setRows(sortKeyAreaRows(data));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.load"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const persistSortOrder = useCallback(
    async (ordered: KeyAreaRow[], previousRows?: KeyAreaRow[]) => {
      const baseline = previousRows ?? ordered;
      const withOrder = withSortOrders(ordered);
      const prevById = new Map(
        baseline.map((r) => [Number(r.id), Number(r.sort_order ?? 0)]),
      );
      const changed = withOrder.filter(
        (row) => prevById.get(Number(row.id)) !== Number(row.sort_order ?? 0),
      );
      if (!changed.length) {
        setRows(withOrder);
        return;
      }
      setReordering(true);
      setError(null);
      try {
        await Promise.all(
          changed.map((row) =>
            saveKeyArea({
              id: Number(row.id),
              title: String(row.title ?? "").trim(),
              sort_order: Number(row.sort_order ?? 0),
            }),
          ),
        );
        setRows(withOrder);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("errors.reorder"));
        await loadRows();
      } finally {
        setReordering(false);
      }
    },
    [loadRows, t],
  );

  const openCreate = () => {
    setForm(emptyForm());
    setError(null);
    setOpen(true);
  };

  const openEdit = (row: KeyAreaRow) => {
    setForm({
      id: Number(row.id),
      title: String(row.title ?? ""),
    });
    setError(null);
    setOpen(true);
  };

  const handleSave = async () => {
    const title = form.title.trim();
    if (!title) {
      setError(t("errors.titleRequired"));
      return;
    }
    const existing = form.id
      ? rows.find((r) => Number(r.id) === Number(form.id))
      : undefined;
    const titleChanged =
      !!existing &&
      String(existing.title ?? "").trim().toLowerCase() !== title.toLowerCase();

    try {
      setSaving(true);
      setError(null);
      const previousRows = rows;
      const saved = await saveKeyArea({
        id: form.id,
        title,
        sort_order: Number(existing?.sort_order ?? 0),
      });

      if (!form.id || titleChanged) {
        const merged = form.id
          ? rows.map((r) => (Number(r.id) === Number(saved.id) ? saved : r))
          : [...rows, saved];
        const ordered = keyAreaListInAlphaOrder(merged, saved);
        setRows(withSortOrders(ordered));
        await persistSortOrder(ordered, previousRows);
      } else {
        const next = rows.map((r) =>
          Number(r.id) === Number(saved.id)
            ? { ...saved, sort_order: r.sort_order }
            : r,
        );
        setRows(sortKeyAreaRows(next));
      }

      setOpen(false);
      setForm(emptyForm());
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.save"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: KeyAreaRow) => {
    const id = Number(row.id);
    if (!Number.isFinite(id) || id <= 0) return;
    if (!window.confirm(t("deleteConfirm"))) return;
    try {
      setSaving(true);
      setError(null);
      await removeKeyArea(id);
      const remaining = rows.filter((r) => Number(r.id) !== id);
      await persistSortOrder(remaining, rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.delete"));
    } finally {
      setSaving(false);
    }
  };

  const handleDragStart = useCallback(
    (e: DragEvent, id: number) => {
      setDragRowId(id);
      setDropSlot(null);
      e.dataTransfer.setData("text/plain", String(id));
      e.dataTransfer.effectAllowed = "move";
    },
    [setDropSlot],
  );

  const handleDragEnd = useCallback(() => {
    setDragRowId(null);
    setDropSlot(null);
  }, [setDropSlot]);

  const handleDragOverRow = useCallback(
    (e: DragEvent, rowIndex: number) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      const tr = e.currentTarget;
      if (!(tr instanceof HTMLTableRowElement)) return;
      const rect = tr.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      setDropSlot(before ? rowIndex : rowIndex + 1);
    },
    [setDropSlot],
  );

  const handleDragOverAfterLast = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDropSlot(rows.length);
    },
    [rows.length, setDropSlot],
  );

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      const sourceRaw =
        e.dataTransfer.getData("text/plain").trim() || String(dragRowId ?? "");
      const sourceId = Number.parseInt(sourceRaw, 10);
      const insertAt = dropInsertRef.current;
      setDragRowId(null);
      setDropSlot(null);
      if (!Number.isFinite(sourceId) || insertAt == null) return;

      const reordered = reorderKeyAreaList(rows, sourceId, insertAt);
      if (reordered === rows) return;
      setRows(withSortOrders(reordered));
      void persistSortOrder(reordered, rows);
    },
    [dragRowId, persistSortOrder, rows, setDropSlot],
  );

  const busy = saving || reordering;

  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="space-y-6 p-4 lg:p-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold">{t("title")}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("dragHint")}</p>
            </div>
            <button
              type="button"
              className={btnPrimary}
              onClick={openCreate}
              disabled={busy}
            >
              <Plus className="h-4 w-4" />
              {t("add")}
            </button>
          </div>

          {loading ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : null}
          {reordering ? (
            <p className="text-sm text-muted-foreground">{t("reordering")}</p>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th
                        className="w-10 px-2 py-3 text-center font-medium text-muted-foreground"
                        title={t("table.dragTitle")}
                      >
                        <span className="sr-only">{t("table.reorder")}</span>
                        <GripVertical className="mx-auto h-4 w-4 opacity-50" aria-hidden />
                      </th>
                      <th className="px-4 py-3 text-left font-medium">{t("table.title")}</th>
                      <th className="px-4 py-3 text-left font-medium">{t("table.sortOrder")}</th>
                      <th className="px-4 py-3 text-right font-medium">{t("table.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, rowIndex) => (
                      <Fragment key={row.id}>
                        {dragRowId != null && dropInsertPreview === rowIndex ? (
                          <DropInsertionLine colSpan={4} />
                        ) : null}
                        <tr
                          className={cn(
                            "border-b border-border last:border-b-0 transition-colors hover:bg-muted/30",
                            dragRowId === Number(row.id) && "bg-muted/25 opacity-80",
                          )}
                          onDragOver={(e) => handleDragOverRow(e, rowIndex)}
                          onDrop={handleDrop}
                        >
                          <td className="w-10 px-2 py-3 text-center align-middle">
                            <div
                              draggable={!busy}
                              role="button"
                              tabIndex={0}
                              aria-label={t("table.dragRowAria", { title: row.title })}
                              title={t("table.dragRowTitle")}
                              onDragStart={(e) => handleDragStart(e, Number(row.id))}
                              onDragEnd={handleDragEnd}
                              className={cn(
                                "inline-flex touch-manipulation rounded-md p-1.5 text-muted-foreground",
                                busy
                                  ? "cursor-not-allowed opacity-40"
                                  : "cursor-grab hover:bg-muted active:cursor-grabbing",
                              )}
                            >
                              <GripVertical className="h-4 w-4 shrink-0" />
                            </div>
                          </td>
                          <td className="px-4 py-3 font-medium">{row.title}</td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {row.sort_order ?? 0}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                className={btnGhost}
                                disabled={busy}
                                onClick={() => openEdit(row)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                className={cn(
                                  btnGhost,
                                  "text-destructive hover:bg-destructive/10",
                                )}
                                disabled={busy}
                                onClick={() => void handleDelete(row)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      </Fragment>
                    ))}
                    {dragRowId != null && dropInsertPreview === rows.length ? (
                      <DropInsertionLine colSpan={4} />
                    ) : null}
                    {!loading && rows.length > 0 ? (
                      <tr
                        className="h-2 border-0 bg-transparent"
                        onDragOver={handleDragOverAfterLast}
                        onDrop={handleDrop}
                      >
                        <td colSpan={4} className="p-0" aria-hidden />
                      </tr>
                    ) : null}
                    {!loading && rows.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                          {t("empty")}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        {open ? (
          <Modal
            title={form.id ? t("edit") : t("add")}
            onClose={() => {
              if (saving) return;
              setOpen(false);
              setForm(emptyForm());
            }}
          >
            <Field label={t("form.title")}>
              <input
                className={inputClass}
                value={form.title}
                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              />
            </Field>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                className={btnOutline}
                onClick={() => {
                  if (saving) return;
                  setOpen(false);
                  setForm(emptyForm());
                }}
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={saving}
                onClick={() => void handleSave()}
              >
                {saving ? t("saving") : t("save")}
              </button>
            </div>
          </Modal>
        ) : null}
      </DashboardLayout>
    </RequireAuth>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-80 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-lg">
        <CardContent className="max-h-[90vh] space-y-5 overflow-y-auto p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{title}</h2>
            <button type="button" className={btnGhost} onClick={onClose}>
              <X className="h-4 w-4" />
            </button>
          </div>
          {children}
        </CardContent>
      </Card>
    </div>
  );
}
