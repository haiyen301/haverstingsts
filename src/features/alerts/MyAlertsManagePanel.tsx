"use client";

import { FormEvent, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";

import {
  createAlert,
  removeAlert,
  updateAlert,
  type AlertFeedItem,
} from "@/features/alerts/api/alertsApi";
import type { AlertFeedCategory } from "@/features/alerts/alertFeedConfigTypes";
import { buildAlertPushPayload } from "@/features/alerts/buildAlertPushPayload";
import { Checkbox } from "@/shared/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";

type ComposeForm = {
  categoryId: string;
  title: string;
  message: string;
  thumbUrl: string;
  href: string;
  pushMobile: boolean;
};

const EMPTY_FORM: ComposeForm = {
  categoryId: "",
  title: "",
  message: "",
  thumbUrl: "",
  href: "",
  pushMobile: true,
};

type Props = {
  categories: AlertFeedCategory[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  currentUserId?: number;
  selectedAlert: AlertFeedItem | null;
  onCreated: () => Promise<void>;
  onUpdated: () => Promise<void>;
  onDeleted: () => Promise<void>;
  onClearSelected: () => void;
};

export function MyAlertsManagePanel({
  categories,
  canCreate,
  canEdit,
  canDelete,
  currentUserId,
  selectedAlert,
  onCreated,
  onUpdated,
  onDeleted,
  onClearSelected,
}: Props) {
  const t = useTranslations("MyAlerts");
  const [composeOpen, setComposeOpen] = useState(false);
  const [compose, setCompose] = useState<ComposeForm>(EMPTY_FORM);
  const [editForm, setEditForm] = useState<ComposeForm | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const ownsSelected =
    selectedAlert != null &&
    currentUserId != null &&
    selectedAlert.createdByUserId === currentUserId;

  const startEdit = (): void => {
    if (!selectedAlert || !ownsSelected) return;
    setEditForm({
      categoryId: selectedAlert.type,
      title: selectedAlert.title,
      message: selectedAlert.message,
      thumbUrl: (selectedAlert.thumbUrl ?? selectedAlert.imageUrl ?? "").trim(),
      href: (selectedAlert.href ?? "").trim(),
      pushMobile: selectedAlert.pushMobile ?? true,
    });
  };

  const handleCreate = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!canCreate) return;
    const title = compose.title.trim();
    const message = compose.message.trim();
    const type = compose.categoryId.trim();
    if (!title || !message || !type) {
      toast.error(t("formRequired"));
      return;
    }
    setSubmitting(true);
    try {
      await createAlert({
        type,
        title,
        message,
        severity: "info",
        icon: "bell",
        imageUrl: compose.thumbUrl.trim(),
        href: compose.href.trim(),
        pushPayload: buildAlertPushPayload({
          thumbUrl: compose.thumbUrl,
          pushMobile: compose.pushMobile,
          action: "created",
        }),
      });
      toast.success(t("createdSuccess"));
      setCompose(EMPTY_FORM);
      setComposeOpen(false);
      await onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("createFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!canEdit || !selectedAlert || !editForm) return;
    const title = editForm.title.trim();
    const message = editForm.message.trim();
    if (!title || !message) {
      toast.error(t("formRequired"));
      return;
    }
    setSubmitting(true);
    try {
      await updateAlert({
        id: selectedAlert.id,
        title,
        message,
        severity: selectedAlert.severity,
        icon: selectedAlert.icon ?? "bell",
        imageUrl: editForm.thumbUrl.trim(),
        href: editForm.href.trim(),
        pushPayload: buildAlertPushPayload({
          thumbUrl: editForm.thumbUrl,
          pushMobile: editForm.pushMobile,
          action: "updated",
        }),
      });
      toast.success(t("updatedSuccess"));
      setEditForm(null);
      await onUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("updateFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!canDelete || !selectedAlert || !ownsSelected) return;
    if (!window.confirm(t("deleteConfirm"))) return;
    setSubmitting(true);
    try {
      await removeAlert(selectedAlert.id, { pushMobile: selectedAlert.pushMobile ?? true });
      toast.success(t("deletedSuccess"));
      setEditForm(null);
      onClearSelected();
      await onDeleted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("deleteFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  if (!canCreate && !canEdit && !canDelete) {
    return null;
  }

  return (
    <div className="space-y-4">
      {canCreate ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-foreground">{t("composeTitle")}</h2>
              <button
                type="button"
                onClick={() => setComposeOpen((v) => !v)}
                className="inline-flex items-center gap-1 rounded-md border border-input px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
              >
                <Plus className="h-3.5 w-3.5" />
                {composeOpen ? t("composeHide") : t("composeShow")}
              </button>
            </div>
            {composeOpen ? (
              <form className="space-y-3" onSubmit={(e) => void handleCreate(e)}>
                <select
                  value={compose.categoryId}
                  onChange={(e) => setCompose((p) => ({ ...p, categoryId: e.target.value }))}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  required
                >
                  <option value="">{t("categoryPlaceholder")}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
                <input
                  value={compose.title}
                  onChange={(e) => setCompose((p) => ({ ...p, title: e.target.value }))}
                  placeholder={t("titlePlaceholder")}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  required
                />
                <textarea
                  value={compose.message}
                  onChange={(e) => setCompose((p) => ({ ...p, message: e.target.value }))}
                  placeholder={t("messagePlaceholder")}
                  rows={3}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  required
                />
                <input
                  value={compose.thumbUrl}
                  onChange={(e) => setCompose((p) => ({ ...p, thumbUrl: e.target.value }))}
                  placeholder={t("thumbPlaceholder")}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <input
                  value={compose.href}
                  onChange={(e) => setCompose((p) => ({ ...p, href: e.target.value }))}
                  placeholder={t("hrefPlaceholder")}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={compose.pushMobile}
                    onCheckedChange={(v) => setCompose((p) => ({ ...p, pushMobile: v === true }))}
                  />
                  {t("pushMobileLabel")}
                </label>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
                >
                  {submitting ? t("saving") : t("createButton")}
                </button>
              </form>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {selectedAlert && ownsSelected && (canEdit || canDelete) ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              {canEdit && !editForm ? (
                <button
                  type="button"
                  onClick={startEdit}
                  className="inline-flex items-center gap-1 rounded-md border border-input px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  {t("editButton")}
                </button>
              ) : null}
              {canDelete ? (
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={submitting}
                  className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("deleteButton")}
                </button>
              ) : null}
            </div>
            {editForm ? (
              <form className="space-y-3" onSubmit={(e) => void handleUpdate(e)}>
                <input
                  value={editForm.title}
                  onChange={(e) => setEditForm((p) => (p ? { ...p, title: e.target.value } : p))}
                  placeholder={t("titlePlaceholder")}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  required
                />
                <textarea
                  value={editForm.message}
                  onChange={(e) => setEditForm((p) => (p ? { ...p, message: e.target.value } : p))}
                  placeholder={t("messagePlaceholder")}
                  rows={3}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  required
                />
                <input
                  value={editForm.thumbUrl}
                  onChange={(e) => setEditForm((p) => (p ? { ...p, thumbUrl: e.target.value } : p))}
                  placeholder={t("thumbPlaceholder")}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <input
                  value={editForm.href}
                  onChange={(e) => setEditForm((p) => (p ? { ...p, href: e.target.value } : p))}
                  placeholder={t("hrefPlaceholder")}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={editForm.pushMobile}
                    onCheckedChange={(v) =>
                      setEditForm((p) => (p ? { ...p, pushMobile: v === true } : p))
                    }
                  />
                  {t("pushMobileLabel")}
                </label>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
                  >
                    {submitting ? t("saving") : t("saveButton")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditForm(null)}
                    className="rounded-md border border-input px-3 py-2 text-sm"
                  >
                    {t("cancelButton")}
                  </button>
                </div>
              </form>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
