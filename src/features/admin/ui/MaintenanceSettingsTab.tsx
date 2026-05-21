"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  fetchMaintenanceStatus,
  saveMaintenanceConfig,
} from "@/features/admin/api/maintenanceApi";
import { broadcastMaintenanceConfigChanged } from "@/shared/auth/maintenanceBroadcast";
import { ActiveStatusSwitch } from "@/features/admin/ui/ActiveStatusSwitch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useMaintenanceConfigStore } from "@/shared/store/maintenanceConfigStore";

const inputClass =
  "flex min-h-[5rem] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";

const textInputClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";

export function MaintenanceSettingsTab() {
  const t = useTranslations("AdminMaintenance");
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");
  const [estimatedReturn, setEstimatedReturn] = useState("");
  const [evictionCountdownSec, setEvictionCountdownSec] = useState(20);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const syncCountdownStore = useMaintenanceConfigStore((s) => s.setEvictionCountdownSec);

  const load = useCallback(async () => {
    const data = await fetchMaintenanceStatus();
    setEnabled(data.enabled);
    setMessage(data.message ?? "");
    setEstimatedReturn(data.estimatedReturn ?? "");
    setEvictionCountdownSec(data.evictionCountdownSec);
    syncCountdownStore(data.evictionCountdownSec);
  }, [syncCountdownStore]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        await load();
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : t("errors.load"));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [load, t]);

  const persist = async (nextEnabled: boolean) => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const saved = await saveMaintenanceConfig({
        enabled: nextEnabled,
        message: message.trim(),
        estimatedReturn: estimatedReturn.trim(),
        evictionCountdownSec,
      });
      setEvictionCountdownSec(saved.evictionCountdownSec);
      syncCountdownStore(saved.evictionCountdownSec);
      broadcastMaintenanceConfigChanged();
      setSuccess(
        nextEnabled
          ? t("savedEnabled", { seconds: saved.evictionCountdownSec })
          : t("savedDisabled"),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.save"));
      await load();
    } finally {
      setSaving(false);
    }
  };

  const onToggleMaintenance = () => {
    const next = !enabled;
    setEnabled(next);
    void persist(next);
  };

  const onSave = async () => {
    await persist(enabled);
  };

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground">{t("loading")}</p>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-lg border border-primary/25 bg-primary/10 px-4 py-3 text-sm text-foreground">
          {success}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldAlert className="h-5 w-5 text-primary" />
            {t("modeTitle")}
          </CardTitle>
          <CardDescription>{t("modeDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 px-4 py-3">
            <div>
              <p className="font-medium text-foreground">{t("toggleLabel")}</p>
              <p className="text-sm text-muted-foreground">{t("toggleHint")}</p>
            </div>
            <ActiveStatusSwitch
              checked={enabled}
              disabled={saving}
              onCheckedChange={onToggleMaintenance}
              activeLabel={t("toggleLabel")}
              inactiveLabel={t("toggleLabel")}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              {t("countdownLabel")}
            </label>
            <input
              type="number"
              min={5}
              max={120}
              step={1}
              value={evictionCountdownSec}
              disabled={saving}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                if (Number.isFinite(n)) setEvictionCountdownSec(n);
              }}
              className={textInputClass}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {t("countdownHint")}
            </p>
          </div>

          {enabled ? (
            <div
              className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground"
              role="status"
            >
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
              <p>
                {t("enableWarning", {
                  seconds: evictionCountdownSec,
                })}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("messageTitle")}</CardTitle>
          <CardDescription>{t("messageDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              {t("messageLabel")}
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className={inputClass}
              placeholder={t("messagePlaceholder")}
              maxLength={500}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              {t("estimatedReturnLabel")}
            </label>
            <input
              type="text"
              value={estimatedReturn}
              onChange={(e) => setEstimatedReturn(e.target.value)}
              className={textInputClass}
              placeholder={t("estimatedReturnPlaceholder")}
              maxLength={120}
            />
          </div>
        </CardContent>
      </Card>

      <button
        type="button"
        disabled={saving}
        onClick={() => void onSave()}
        className={cn(
          "inline-flex h-10 items-center justify-center rounded-lg bg-button-primary px-6 text-sm font-medium text-white transition-colors hover:bg-[#196A40] disabled:opacity-60",
        )}
      >
        {saving ? t("saving") : t("save")}
      </button>
    </div>
  );
}
