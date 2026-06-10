"use client";

type ConfirmDeleteDialogProps = {
  open: boolean;
  title: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  deleting?: boolean;
  deletingLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
  titleId?: string;
};

export function ConfirmDeleteDialog({
  open,
  title,
  message,
  cancelLabel,
  confirmLabel,
  deleting = false,
  deletingLabel,
  onCancel,
  onConfirm,
  titleId = "confirm-delete-title",
}: ConfirmDeleteDialogProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onClick={() => {
        if (!deleting) onCancel();
      }}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-muted/80 disabled:opacity-50"
            onClick={onCancel}
            disabled={deleting}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
            onClick={onConfirm}
            disabled={deleting}
          >
            {deleting && deletingLabel ? deletingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
