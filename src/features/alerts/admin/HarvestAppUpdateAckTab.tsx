"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";

import { ActiveStatusSwitch } from "@/features/admin/ui/ActiveStatusSwitch";
import {
  fetchHarvestAppUpdateAdminList,
  publishHarvestAppUpdateEnabled,
  removeHarvestAppUpdateAck,
  saveHarvestAppUpdateEnabled,
  type HarvestAppUpdateAckRow,
  type HarvestAppUpdateAdminList,
} from "@/features/alerts/harvestAppUpdateApi";
import { Card, CardContent } from "@/components/ui/card";

const EMPTY: HarvestAppUpdateAdminList = { enabled: true, confirmed: [], later: [] };

function formatWhen(value: string): string {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toLocaleString();
}

function AckTable({
  rows,
  emptyLabel,
  removeLabel,
  canRemove,
  removingId,
  onRemove,
}: {
  rows: HarvestAppUpdateAckRow[];
  emptyLabel: string;
  removeLabel: string;
  canRemove: boolean;
  removingId: number | null;
  onRemove: (userId: number) => void;
}) {
  const t = useTranslations("AdminAlertSettings");

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b border-border">
            <th className="px-3 py-2 font-medium">{t("ackUser")}</th>
            <th className="px-3 py-2 font-medium">{t("ackUserId")}</th>
            <th className="px-3 py-2 font-medium">{t("ackWhen")}</th>
            {canRemove ? <th className="px-3 py-2 font-medium" /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.userId} className="border-b border-border/70">
              <td className="px-3 py-2">{row.name}</td>
              <td className="px-3 py-2 font-mono">{row.userId}</td>
              <td className="px-3 py-2">{formatWhen(row.at)}</td>
              {canRemove ? (
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    disabled={removingId === row.userId}
                    onClick={() => onRemove(row.userId)}
                    className="text-xs font-medium text-destructive hover:underline disabled:opacity-60"
                  >
                    {removeLabel}
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HarvestAppUpdateAckTab() {
  const t = useTranslations("AdminAlertSettings");
  const [list, setList] = useState<HarvestAppUpdateAdminList>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [savingEnabled, setSavingEnabled] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchHarvestAppUpdateAdminList();
      setList({ ...next, enabled: next.enabled !== false });
    } catch (err) {
      const message = err instanceof Error ? err.message : t("ackLoadFailed");
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const setEnabled = async (enabled: boolean) => {
    if (savingEnabled || enabled === list.enabled) return;
    const previous = list;
    setSavingEnabled(true);
    setList({ ...list, enabled });
    try {
      const next = await saveHarvestAppUpdateEnabled(enabled);
      setList(next);
      publishHarvestAppUpdateEnabled(next.enabled);
      toast.success(t("noticeToggleSaved"));
    } catch (err) {
      setList(previous);
      const message = err instanceof Error ? err.message : t("noticeToggleFailed");
      toast.error(message);
    } finally {
      setSavingEnabled(false);
    }
  };

  const remove = async (bucket: "confirmed" | "later", userId: number) => {
    setRemovingId(userId);
    try {
      setList(await removeHarvestAppUpdateAck(userId, bucket));
      toast.success(t("ackRemoved"));
    } catch (err) {
      const message = err instanceof Error ? err.message : t("ackRemoveFailed");
      toast.error(message);
    } finally {
      setRemovingId(null);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">{t("noticeToggleTitle")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("noticeToggleHelp")}</p>
          </div>
          <ActiveStatusSwitch
            checked={list.enabled}
            pending={savingEnabled}
            activeLabel={t("noticeToggleOn")}
            inactiveLabel={t("noticeToggleOff")}
            onCheckedChange={() => void setEnabled(!list.enabled)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div>
            <h2 className="text-lg font-semibold">{t("ackConfirmedTitle")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("ackConfirmedHelp")}</p>
          </div>
          <AckTable
            rows={list.confirmed}
            emptyLabel={t("ackEmpty")}
            removeLabel={t("ackRemove")}
            canRemove
            removingId={removingId}
            onRemove={(userId) => void remove("confirmed", userId)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div>
            <h2 className="text-lg font-semibold">{t("ackLaterTitle")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("ackLaterHelp")}</p>
          </div>
          <AckTable
            rows={list.later}
            emptyLabel={t("ackLaterEmpty")}
            removeLabel={t("ackRemove")}
            canRemove
            removingId={removingId}
            onRemove={(userId) => void remove("later", userId)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
