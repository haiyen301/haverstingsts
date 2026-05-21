"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  FolderPlus,
  Megaphone,
  Package,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

import RequireAuth from "@/features/auth/RequireAuth";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertFeedItem,
  fetchMyAlerts,
  markAlertRead,
  markAllAlertsRead,
  markAlertTypeRead,
} from "@/features/alerts/api/alertsApi";
import { fetchAlertFeedConfig } from "@/features/alerts/alertFeedConfigApi";
import type { AlertFeedCategory } from "@/features/alerts/alertFeedConfigTypes";
import { DEFAULT_ALERT_FEED_CONFIG } from "@/features/alerts/alertFeedConfigDefaults";
import {
  localizeAlertMessageForDisplay,
  localizeAlertTitleForDisplay,
  localizedFeedCategoryCopy,
} from "@/features/alerts/localizeStoredAlertText";
import { cn } from "@/lib/utils";
import { formatDateDisplayDmy } from "@/shared/lib/format/date";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

type AlertSeverity = "info" | "warning" | "success" | "critical";

const ICON_MAP: Record<string, LucideIcon> = {
  "calendar-days": CalendarDays,
  warehouse: Warehouse,
  "folder-plus": FolderPlus,
  bell: Bell,
  package: Package,
  megaphone: Megaphone,
};

const severityStyles: Record<AlertSeverity, string> = {
  info: "bg-primary/10 text-primary",
  warning: "bg-destructive/10 text-destructive",
  success: "bg-secondary text-secondary-foreground",
  critical: "bg-destructive/15 text-destructive",
};

const ALERT_UTC_WITHOUT_ZONE_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

function parseAlertDate(input: string): Date | null {
  const raw = input.trim();
  if (!raw) return null;
  // STSPortal returns `Y-m-d H:i:s` without zone; treat it as UTC, then let the browser render local time.
  const normalized = ALERT_UTC_WITHOUT_ZONE_RE.test(raw)
    ? `${raw.replace(" ", "T")}Z`
    : raw;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function alertTimestamp(input: string): number {
  return parseAlertDate(input)?.getTime() ?? 0;
}

function formatFeedTime(iso: string, locale: string): string {
  const d = parseAlertDate(iso);
  if (!d) return "";
  const timePart = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
  return `${timePart} ${formatDateDisplayDmy(d)}`;
}

function galleryFor(alert: AlertFeedItem): string[] {
  if (Array.isArray(alert.galleryUrls) && alert.galleryUrls.length > 0) {
    return alert.galleryUrls;
  }
  const fromPayload = alert.actionPayload?.gallery_urls;
  if (Array.isArray(fromPayload)) {
    return fromPayload.filter((u): u is string => typeof u === "string" && u.trim() !== "");
  }
  return [];
}

function thumbFor(alert: AlertFeedItem): string {
  const t = (alert.thumbUrl ?? "").trim();
  if (t) return t;
  return (alert.imageUrl ?? "").trim();
}

export default function MyAlertsPage() {
  const router = useRouter();
  const t = useTranslations("MyAlerts");
  const tHarvest = useTranslations("HarvestForm");
  const tProject = useTranslations("ProjectForm");
  const locale = useLocale();
  const [categories, setCategories] = useState<AlertFeedCategory[]>(DEFAULT_ALERT_FEED_CONFIG.categories);
  const [alerts, setAlerts] = useState<AlertFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<AlertFeedItem | null>(null);

  const relativeLabel = useCallback(
    (iso: string): string => {
      const ts = alertTimestamp(iso);
      if (!ts) return "";
      const diffMs = Date.now() - ts;
      const mins = Math.max(0, Math.round(diffMs / 60000));
      if (mins < 1) return t("relativeJustNow");
      if (mins < 60) return t("relativeMinutes", { count: mins });
      const hours = Math.round(mins / 60);
      if (hours < 24) return t("relativeHours", { count: hours });
      const days = Math.round(hours / 24);
      if (days < 7) return t("relativeDays", { count: days });
      return formatFeedTime(iso, locale);
    },
    [locale, t],
  );

  const alertTitleDisplay = useCallback(
    (title: string) => localizeAlertTitleForDisplay(title, tHarvest, tProject),
    [tHarvest, tProject],
  );

  const alertMessageDisplay = useCallback(
    (message: string) => localizeAlertMessageForDisplay(message, tProject),
    [tProject],
  );

  useEffect(() => {
    void (async () => {
      try {
        const cfg = await fetchAlertFeedConfig();
        if (cfg.categories.length > 0) {
          setCategories(cfg.categories);
        }
      } catch {
        /* keep defaults */
      }
    })();
  }, []);

  const loadAlerts = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchMyAlerts({ limit: 200 });
      setAlerts(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadAlerts();
  }, [loadAlerts]);

  useEffect(() => {
    setSelectedAlert((prev) => {
      if (!prev) return null;
      const fresh = alerts.find((a) => a.id === prev.id);
      return fresh ?? null;
    });
  }, [alerts]);

  const grouped = useMemo(
    () =>
      categories.map((section) => ({
        ...section,
        Icon: ICON_MAP[section.icon] ?? Bell,
        items: alerts
          .filter((alert) => alert.type === section.id)
          .sort((a, b) => alertTimestamp(b.createdAt) - alertTimestamp(a.createdAt)),
      })),
    [alerts, categories],
  );

  const groupedWithAlerts = useMemo(
    () => grouped.filter((section) => section.items.length > 0),
    [grouped],
  );

  const unreadCount = useMemo(() => alerts.filter((alert) => !alert.read).length, [alerts]);
  const unreadByType = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const c of categories) {
      acc[c.id] = alerts.filter((a) => a.type === c.id && !a.read).length;
    }
    return acc;
  }, [alerts, categories]);

  const markRead = async (id: string): Promise<void> => {
    await markAlertRead(id);
    setAlerts((prev) => prev.map((alert) => (alert.id === id ? { ...alert, read: true } : alert)));
  };

  const markAllRead = async (): Promise<void> => {
    await markAllAlertsRead();
    setAlerts((prev) => prev.map((alert) => ({ ...alert, read: true })));
  };

  const markTypeRead = async (type: string): Promise<void> => {
    await markAlertTypeRead(type);
    setAlerts((prev) =>
      prev.map((alert) => (alert.type === type ? { ...alert, read: true } : alert)),
    );
  };

  const openAlert = async (alert: AlertFeedItem): Promise<void> => {
    if (!alert.read) {
      await markRead(alert.id);
    }
    if (alert.href && alert.href.trim() !== "") {
      router.push(alert.href);
      return;
    }
    setSelectedAlert(alert);
  };

  const orphanAlerts = useMemo(() => {
    const ids = new Set(categories.map((c) => c.id));
    return alerts
      .filter((a) => !ids.has(a.type))
      .sort((a, b) => alertTimestamp(b.createdAt) - alertTimestamp(a.createdAt));
  }, [alerts, categories]);

  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="space-y-6 p-4 lg:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
                <Bell className="h-6 w-6 text-primary" />
                {t("title")}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {unreadCount > 0 ? t("unreadSummary", { count: unreadCount }) : t("allCaughtUp")}
              </p>
            </div>
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={markAllRead}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <Check className="h-4 w-4" />
                {t("markAllRead")}
              </button>
            ) : null}
          </div>
          {loading ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="space-y-6">
            {!loading && !error && groupedWithAlerts.length === 0 && orphanAlerts.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center text-sm text-muted-foreground">
                  {t("empty")}
                </CardContent>
              </Card>
            ) : null}

            {groupedWithAlerts.map((section) => {
              const Icon = section.Icon;
              const unread = unreadByType[section.id] ?? 0;
              const { title: sectionTitle, description: sectionDesc } = localizedFeedCategoryCopy(
                section.id,
                section.title,
                section.description,
                t,
              );
              return (
                <section key={section.id} className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                        <Icon className="h-4 w-4 text-foreground" />
                      </div>
                      <div>
                        <h2 className="flex items-center gap-2 font-semibold text-foreground">
                          {sectionTitle}
                          {unread > 0 ? (
                            <Badge className="h-5 px-1.5 text-[10px]">{t("newBadge", { count: unread })}</Badge>
                          ) : null}
                        </h2>
                        <p className="text-xs text-muted-foreground">{sectionDesc}</p>
                      </div>
                    </div>
                    {unread > 0 ? (
                      <button
                        type="button"
                        onClick={() => markTypeRead(section.id)}
                        className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                      >
                        {t("markRead")}
                      </button>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    {section.items.map((alert) => {
                      const thumb = thumbFor(alert);
                      const gallery = galleryFor(alert);
                      return (
                        <Card
                          key={alert.id}
                          className={cn(
                            "cursor-pointer transition-shadow hover:shadow-md",
                            !alert.read && "border-primary/40 bg-primary/3",
                          )}
                          onClick={() => void openAlert(alert)}
                        >
                          <CardContent className="p-3 sm:p-4">
                            <div className="flex gap-3">
                              {thumb ? (
                                <img
                                  src={thumb}
                                  alt=""
                                  className="h-14 w-14 shrink-0 rounded-md border object-cover sm:h-16 sm:w-16"
                                />
                              ) : (
                                <div
                                  className={cn(
                                    "flex h-14 w-14 shrink-0 items-center justify-center rounded-md border sm:h-16 sm:w-16",
                                    severityStyles[(alert.severity as AlertSeverity) ?? "info"],
                                  )}
                                >
                                  <Icon className="h-5 w-5" />
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-start gap-2">
                                  {!alert.read ? (
                                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label={t("unreadAria")} />
                                  ) : null}
                                  <p className="min-w-0 flex-1 text-sm font-semibold uppercase leading-snug tracking-tight text-foreground">
                                    {alertTitleDisplay(alert.title)}
                                  </p>
                                  <span className="shrink-0 text-[11px] text-muted-foreground">
                                    {relativeLabel(alert.createdAt)}
                                  </span>
                                </div>
                                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                                  {alertMessageDisplay(alert.message)}
                                </p>
                                {gallery.length > 0 ? (
                                  <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                                    {gallery.map((url) => (
                                      <img
                                        key={url}
                                        src={url}
                                        alt=""
                                        className="h-20 w-28 shrink-0 rounded-md border object-cover sm:h-24 sm:w-36"
                                      />
                                    ))}
                                  </div>
                                ) : null}
                                <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                                  <span>{formatFeedTime(alert.createdAt, locale)}</span>
                                  {alert.pushMobile ? (
                                    <Badge
                                      variant="secondary"
                                      className="text-[10px] text-[hsl(150_35%_16%)]!"
                                    >
                                      {t("channelMobile")}
                                    </Badge>
                                  ) : null}
                                  {alert.pushWeb ? (
                                    <Badge
                                      variant="secondary"
                                      className="text-[10px] text-[hsl(150_35%_16%)]!"
                                    >
                                      {t("channelWeb")}
                                    </Badge>
                                  ) : null}
                                  {alert.pushEmail ? (
                                    <Badge
                                      variant="secondary"
                                      className="text-[10px] text-[hsl(150_35%_16%)]!"
                                    >
                                      {t("channelEmail")}
                                    </Badge>
                                  ) : null}
                                </div>
                              </div>
                              {alert.href ? (
                                <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-muted-foreground" />
                              ) : null}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </section>
              );
            })}

            {orphanAlerts.length > 0 ? (
              <section className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                    <Bell className="h-4 w-4 text-foreground" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-foreground">{t("otherTitle")}</h2>
                    <p className="text-xs text-muted-foreground">{t("otherDescription")}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  {orphanAlerts.map((alert) => (
                    <Card
                      key={alert.id}
                      className="cursor-pointer hover:shadow-md"
                      onClick={() => void openAlert(alert)}
                    >
                      <CardContent className="p-4">
                        <p className="text-sm font-medium">{alertTitleDisplay(alert.title)}</p>
                        <p className="text-xs text-muted-foreground">{alert.type}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            ) : null}
          </div>

          {selectedAlert ? (
            <Card>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-base font-semibold">{t("alertDetail")}</h3>
                  <button
                    type="button"
                    className="text-sm text-muted-foreground underline"
                    onClick={() => setSelectedAlert(null)}
                  >
                    {t("close")}
                  </button>
                </div>
                <div className="flex gap-3">
                  {thumbFor(selectedAlert) ? (
                    <img
                      src={thumbFor(selectedAlert)}
                      alt=""
                      className="h-20 w-20 shrink-0 rounded-md border object-cover"
                    />
                  ) : null}
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-tight">{alertTitleDisplay(selectedAlert.title)}</p>
                    <p className="text-xs text-muted-foreground">{formatFeedTime(selectedAlert.createdAt, locale)}</p>
                  </div>
                </div>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{alertMessageDisplay(selectedAlert.message)}</p>
                {galleryFor(selectedAlert).length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {galleryFor(selectedAlert).map((url) => (
                      <img
                        key={url}
                        src={url}
                        alt=""
                        className="h-32 w-44 rounded-md border object-cover"
                      />
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </DashboardLayout>
    </RequireAuth>
  );
}
