"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, useId } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "react-toastify";

import { createAlert } from "@/features/alerts/api/alertsApi";
import { applyRecipientToCreateAlert } from "@/features/alerts/alertRecipientDispatch";
import {
  fetchAlertFeedConfig,
  saveAlertFeedConfig,
} from "@/features/alerts/alertFeedConfigApi";
import {
  ALERT_CATEGORY_ICON_KEYS,
  ALERT_ROUTE_KEYS,
  type AlertCategoryIconKey,
  type AlertFeedCategory,
  type AlertFeedConfig,
  type AlertRecipientMode,
  type AlertRecipientRule,
  type AlertRouteBinding,
  type AlertRouteKey,
  isValidCategoryId,
  normalizeRecipientRule,
} from "@/features/alerts/alertFeedConfigTypes";
import {
  DEFAULT_ALERT_FEED_CONFIG,
  mergeAlertFeedConfigWithDefaults,
} from "@/features/alerts/alertFeedConfigDefaults";
import { useModuleAccess } from "@/shared/auth/useModuleAccess";
import { Checkbox } from "@/shared/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { fetchRoles, type RoleRow } from "@/features/admin/api/rolesApi";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";

function slugFromTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function randomId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Date.now().toString(36)}`;
}

type StaffPickerOption = { id: number; label: string };

function RecipientRuleEditor({
  idPrefix,
  rule,
  onChange,
  disabled,
  roles,
  staffOptions,
  refDirectoryLoading,
  heading,
  compact = false,
}: {
  idPrefix: string;
  rule: AlertRecipientRule;
  onChange: (next: AlertRecipientRule) => void;
  disabled: boolean;
  roles: RoleRow[];
  staffOptions: StaffPickerOption[];
  refDirectoryLoading: boolean;
  heading: string;
  compact?: boolean;
}) {
  const t = useTranslations("AdminAlertSettings");
  const r = normalizeRecipientRule(rule);
  const [staffQuery, setStaffQuery] = useState("");
  const staffSearchId = useId();

  const staffOptionsWithSaved = useMemo(() => {
    const byId = new Map(staffOptions.map((s) => [s.id, s] as const));
    for (const id of r.userIds ?? []) {
      if (!byId.has(id)) {
        byId.set(id, { id, label: `#${id}` });
      }
    }
    return Array.from(byId.values()).sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
    );
  }, [staffOptions, r.userIds]);

  const filteredStaff = useMemo(() => {
    const q = staffQuery.trim().toLowerCase();
    if (!q) return staffOptionsWithSaved;
    return staffOptionsWithSaved.filter(
      (s) => s.label.toLowerCase().includes(q) || String(s.id).includes(q),
    );
  }, [staffOptionsWithSaved, staffQuery]);

  return (
    <div className={compact ? "space-y-2" : "space-y-2 border-t border-border/80 pt-3"}>
      <p
        className={
          compact
            ? "text-xs font-medium text-muted-foreground"
            : "text-xs font-semibold text-foreground"
        }
      >
        {heading}
      </p>
      <div>
        <label className="mb-1 block text-[11px] text-muted-foreground" htmlFor={`${idPrefix}-mode`}>
          {t("recipientMode")}
        </label>
        <select
          id={`${idPrefix}-mode`}
          disabled={disabled}
          className="w-full max-w-xs rounded-md border border-input px-3 py-1.5 text-xs"
          value={r.mode}
          onChange={(e) => {
            const mode = e.target.value as AlertRecipientMode;
            if (mode === "self") onChange({ mode: "self" });
            else if (mode === "all_users") onChange({ mode: "all_users" });
            else if (mode === "user_ids") onChange({ mode: "user_ids", userIds: r.userIds ?? [] });
            else onChange({ mode: "role_ids", roleIds: r.roleIds ?? [] });
          }}
        >
          <option value="self">{t("recipientSelf")}</option>
          <option value="user_ids">{t("recipientUserIds")}</option>
          <option value="role_ids">{t("recipientRoles")}</option>
          <option value="all_users">{t("recipientAllUsers")}</option>
        </select>
      </div>
      {r.mode === "user_ids" ? (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">{t("recipientUserIdsHelp")}</p>
          {refDirectoryLoading && staffOptions.length === 0 && (r.userIds?.length ?? 0) === 0 ? (
            <p className="text-[11px] text-muted-foreground">{t("recipientStaffsLoading")}</p>
          ) : staffOptionsWithSaved.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">{t("recipientStaffsEmpty")}</p>
          ) : (
            <>
              <label className="sr-only" htmlFor={staffSearchId}>
                {t("recipientUserSearchLabel")}
              </label>
              <input
                id={staffSearchId}
                type="search"
                disabled={disabled}
                placeholder={t("recipientUserSearchPh")}
                value={staffQuery}
                onChange={(e) => setStaffQuery(e.target.value)}
                className="w-full max-w-md rounded-md border border-input px-3 py-1.5 text-xs"
              />
              <div className="max-h-48 max-w-full overflow-y-auto rounded-md border border-input p-2">
                <div className="flex flex-wrap gap-2">
                  {filteredStaff.map((row) => {
                    const checked = (r.userIds ?? []).includes(row.id);
                    return (
                      <label
                        key={row.id}
                        className="flex max-w-full cursor-pointer items-center gap-1.5 rounded-md border border-input px-2 py-1 text-[11px]"
                      >
                        <Checkbox
                          disabled={disabled}
                          checked={checked}
                          onChange={(e) => {
                            const next = new Set(r.userIds ?? []);
                            if (e.target.checked) {
                              if (next.size < 100) next.add(row.id);
                            } else {
                              next.delete(row.id);
                            }
                            onChange({
                              mode: "user_ids",
                              userIds: Array.from(next).sort((a, b) => a - b),
                            });
                          }}
                          rootClassName="h-3.5 w-3.5"
                          boxClassName="h-3.5 w-3.5"
                          iconClassName="h-2.5 w-2.5"
                        />
                        <span className="truncate" title={`${row.label} (${row.id})`}>
                          {row.label}{" "}
                          <span className="font-mono text-muted-foreground">({row.id})</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {filteredStaff.length === 0 ? (
                  <p className="py-2 text-center text-[11px] text-muted-foreground">
                    {t("recipientUserSearchNoMatch")}
                  </p>
                ) : null}
              </div>
            </>
          )}
        </div>
      ) : null}
      {r.mode === "role_ids" ? (
        roles.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {roles.map((role) => {
              const checked = (r.roleIds ?? []).includes(role.id);
              return (
                <label
                  key={role.id}
                  className="flex cursor-pointer items-center gap-1.5 rounded-md border border-input px-2 py-1 text-[11px]"
                >
                  <Checkbox
                    disabled={disabled}
                    checked={checked}
                    onChange={(e) => {
                      const next = new Set(r.roleIds ?? []);
                      if (e.target.checked) next.add(role.id);
                      else next.delete(role.id);
                      onChange({
                        mode: "role_ids",
                        roleIds: Array.from(next).sort((a, b) => a - b),
                      });
                    }}
                    rootClassName="h-3.5 w-3.5"
                    boxClassName="h-3.5 w-3.5"
                    iconClassName="h-2.5 w-2.5"
                  />
                  {role.title} ({role.id})
                </label>
              );
            })}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">{t("recipientRolesEmpty")}</p>
        )
      ) : null}
    </div>
  );
}

export function AlertFeedSettingsView() {
  const t = useTranslations("AdminAlertSettings");
  const { canCreate, canEdit } = useModuleAccess("admin_people");
  const canSaveLayout = canEdit || canCreate;
  const { canCreate: canCreateAlert } = useModuleAccess("my_alerts");

  const [config, setConfig] = useState<AlertFeedConfig>(DEFAULT_ALERT_FEED_CONFIG);
  const [loading, setLoading] = useState(true);
  const [savingLayout, setSavingLayout] = useState(false);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [pushSubmitting, setPushSubmitting] = useState(false);
  const [roleRows, setRoleRows] = useState<RoleRow[]>([]);

  const staffs = useHarvestingDataStore((s) => s.staffs);
  const refDirectoryLoading = useHarvestingDataStore((s) => s.loading);
  const fetchAllHarvestingReferenceData = useHarvestingDataStore(
    (s) => s.fetchAllHarvestingReferenceData,
  );

  const staffPickerOptions = useMemo((): StaffPickerOption[] => {
    return (staffs as unknown[])
      .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
      .map((s) => {
        const id = Number(s.id);
        if (!Number.isInteger(id) || id <= 0) return null;
        const firstName = String(s.first_name ?? "").trim();
        const lastName = String(s.last_name ?? "").trim();
        const fullNameFromParts = [firstName, lastName].filter(Boolean).join(" ").trim();
        const label =
          fullNameFromParts || String(s.full_name ?? s.name ?? "").trim() || `User ${id}`;
        return { id, label };
      })
      .filter((x): x is StaffPickerOption => x !== null)
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  }, [staffs]);

  const configRef = useRef(config);
  configRef.current = config;
  const ignoreNextAutosaveRef = useRef(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [newCat, setNewCat] = useState({
    id: "",
    title: "",
    description: "",
    icon: "bell" as AlertCategoryIconKey,
  });

  const [pushForm, setPushForm] = useState({
    categoryId: "",
    title: "",
    message: "",
    thumbUrl: "",
    galleryLines: "",
    pushMobile: true,
    pushWeb: true,
    pushEmail: false,
    href: "",
  });
  const [composeRecipient, setComposeRecipient] = useState<AlertRecipientRule>({ mode: "self" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAlertFeedConfig();
      ignoreNextAutosaveRef.current = true;
      setConfig(data);
      setComposeRecipient(normalizeRecipientRule(data.defaultRecipient));
      setPushForm((p) => ({
        ...p,
        categoryId: p.categoryId || data.categories[0]?.id || "",
      }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void fetchAllHarvestingReferenceData();
  }, [fetchAllHarvestingReferenceData]);

  useEffect(() => {
    if (loading) return;
    void fetchRoles()
      .then(setRoleRows)
      .catch(() => setRoleRows([]));
  }, [loading]);

  const toastOpts = useMemo(() => ({ position: "bottom-right" as const }), []);

  useEffect(() => {
    if (loading || !canSaveLayout) return;
    if (ignoreNextAutosaveRef.current) {
      ignoreNextAutosaveRef.current = false;
      return;
    }
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      void (async () => {
        setSavingLayout(true);
        setLayoutError(null);
        try {
          await saveAlertFeedConfig(configRef.current);
          toast.success(t("toastLayoutSaved"), toastOpts);
        } catch (err) {
          const msg = err instanceof Error ? err.message : t("saveFailed");
          setLayoutError(msg);
          toast.error(msg, toastOpts);
        } finally {
          setSavingLayout(false);
        }
      })();
    }, 450);
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [config, loading, canSaveLayout, t, toastOpts]);

  const routeLabels: Record<AlertRouteKey, string> = useMemo(
    () => ({
      harvest_new: t("routes.harvest_new"),
      harvest_import: t("routes.harvest_import"),
      projects_new: t("routes.projects_new"),
      projects_import: t("routes.projects_import"),
    }),
    [t],
  );

  const mergedConfig = useMemo(() => mergeAlertFeedConfigWithDefaults(config), [config]);
  const bindingByRoute = useMemo(() => {
    const m = new Map<AlertRouteKey, AlertRouteBinding>();
    for (const b of mergedConfig.routeBindings) {
      m.set(b.routeKey, b);
    }
    return m;
  }, [mergedConfig]);

  const setBindingRecipient = (routeKey: AlertRouteKey, rule: AlertRecipientRule): void => {
    setConfig((prev) => {
      const others = prev.routeBindings.filter((b) => b.routeKey !== routeKey);
      const existing = prev.routeBindings.find((b) => b.routeKey === routeKey);
      const merged = mergeAlertFeedConfigWithDefaults(prev);
      const defB = merged.routeBindings.find((x) => x.routeKey === routeKey)!;
      const nextBinding: AlertRouteBinding = {
        id: existing?.id ?? defB.id,
        routeKey,
        categoryId: existing?.categoryId ?? defB.categoryId,
        push_mobile: existing?.push_mobile ?? defB.push_mobile ?? true,
        push_web: existing?.push_web ?? defB.push_web ?? true,
        push_email: existing?.push_email ?? defB.push_email ?? false,
        recipient: normalizeRecipientRule(rule),
      };
      return { ...prev, routeBindings: [...others, nextBinding] };
    });
  };

  const setBindingCategory = (routeKey: AlertRouteKey, categoryId: string): void => {
    setConfig((prev) => {
      const others = prev.routeBindings.filter((b) => b.routeKey !== routeKey);
      const existing = prev.routeBindings.find((b) => b.routeKey === routeKey);
      const merged = mergeAlertFeedConfigWithDefaults(prev);
      const defB = merged.routeBindings.find((x) => x.routeKey === routeKey)!;
      const nextBinding: AlertRouteBinding = {
        id: existing?.id ?? defB.id,
        routeKey,
        categoryId,
        push_mobile: existing?.push_mobile ?? defB.push_mobile ?? true,
        push_web: existing?.push_web ?? defB.push_web ?? true,
        push_email: existing?.push_email ?? defB.push_email ?? false,
        ...(existing?.recipient ? { recipient: existing.recipient } : {}),
      };
      return { ...prev, routeBindings: [...others, nextBinding] };
    });
  };

  const setBindingChannel = (
    routeKey: AlertRouteKey,
    key: "push_mobile" | "push_web" | "push_email",
    value: boolean,
  ): void => {
    setConfig((prev) => ({
      ...prev,
      routeBindings: prev.routeBindings.map((b) =>
        b.routeKey === routeKey ? { ...b, [key]: value } : b,
      ),
    }));
  };

  const removeCategory = (id: string): void => {
    setConfig((prev) => {
      if (prev.categories.length <= 1) {
        return prev;
      }
      const first = prev.categories.find((c) => c.id !== id)?.id ?? "";
      const categories = prev.categories.filter((c) => c.id !== id);
      const routeBindings = prev.routeBindings.map((b) =>
        b.categoryId === id ? { ...b, categoryId: first } : b,
      );
      return { ...prev, categories, routeBindings };
    });
  };

  const addCategory = (e: FormEvent): void => {
    e.preventDefault();
    const title = newCat.title.trim();
    let id = newCat.id.trim().toLowerCase();
    if (!id && title) id = slugFromTitle(title);
    if (!isValidCategoryId(id) || title === "") {
      setLayoutError(t("categoryInvalid"));
      return;
    }
    setLayoutError(null);
    let duplicate = false;
    setConfig((prev) => {
      if (prev.categories.some((c) => c.id === id)) {
        duplicate = true;
        return prev;
      }
      const row: AlertFeedCategory = {
        id,
        title,
        description: newCat.description.trim(),
        icon: newCat.icon,
      };
      return { ...prev, categories: [...prev.categories, row] };
    });
    if (duplicate) {
      setLayoutError(t("categoryDuplicate"));
      return;
    }
    setNewCat({ id: "", title: "", description: "", icon: "bell" });
  };

  const sendPush = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!canCreateAlert) return;
    const title = pushForm.title.trim();
    const message = pushForm.message.trim();
    const type = pushForm.categoryId.trim();
    if (!title || !message || !type) {
      setPushError(t("pushRequired"));
      return;
    }
    const gallery_urls = pushForm.galleryLines
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 12);

    setPushSubmitting(true);
    setPushError(null);
    try {
      const base = {
        type,
        title,
        message,
        severity: "info" as const,
        icon: "bell",
        imageUrl: pushForm.thumbUrl.trim(),
        href: pushForm.href.trim(),
        pushPayload: {
          thumb_url: pushForm.thumbUrl.trim(),
          gallery_urls,
          push_mobile: pushForm.pushMobile,
          push_web: pushForm.pushWeb,
          push_email: pushForm.pushEmail,
        },
      };
      await createAlert(applyRecipientToCreateAlert(base, composeRecipient));
      toast.success(t("pushCreated"), toastOpts);
      setPushForm((p) => ({
        ...p,
        title: "",
        message: "",
        thumbUrl: "",
        galleryLines: "",
        href: "",
      }));
      setComposeRecipient({ mode: "self" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("pushFailed");
      setPushError(msg);
      toast.error(msg, toastOpts);
    } finally {
      setPushSubmitting(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t("description")}</p>
        <p className="mt-2 text-sm text-muted-foreground">{t("hint")}</p>
        <div className="mt-3">
          <Link
            href="/my-alerts"
            className="text-sm font-medium text-primary underline"
          >
            {t("viewFeed")}
          </Link>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t("sectionCategories")}</h2>
          {canSaveLayout && savingLayout ? (
            <span className="text-xs text-muted-foreground">{t("saving")}</span>
          ) : null}
        </div>
        {layoutError ? <p className="text-sm text-destructive">{layoutError}</p> : null}

        <div className="grid gap-3 md:grid-cols-2">
          {config.categories.map((cat) => (
            <Card key={cat.id}>
              <CardContent className="space-y-1 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs text-muted-foreground">{cat.id}</p>
                    <p className="font-semibold text-foreground">{cat.title}</p>
                    <p className="text-xs text-muted-foreground">{cat.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("iconLabel")}: {cat.icon}
                    </p>
                  </div>
                  {canSaveLayout ? (
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label={t("removeCategory")}
                      onClick={() => removeCategory(cat.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {canSaveLayout ? (
          <Card>
            <CardContent className="space-y-3 p-4">
              <h3 className="text-sm font-semibold">{t("addCategory")}</h3>
              <form className="grid gap-2 md:grid-cols-2" onSubmit={addCategory}>
                <input
                  value={newCat.title}
                  onChange={(e) => setNewCat((p) => ({ ...p, title: e.target.value }))}
                  placeholder={t("categoryTitlePh")}
                  className="rounded-md border border-input px-3 py-2 text-sm md:col-span-2"
                />
                <input
                  value={newCat.id}
                  onChange={(e) => setNewCat((p) => ({ ...p, id: e.target.value }))}
                  placeholder={t("categoryIdPh")}
                  className="rounded-md border border-input px-3 py-2 text-sm"
                />
                <select
                  value={newCat.icon}
                  onChange={(e) =>
                    setNewCat((p) => ({ ...p, icon: e.target.value as AlertCategoryIconKey }))
                  }
                  className="rounded-md border border-input px-3 py-2 text-sm"
                >
                  {ALERT_CATEGORY_ICON_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                <textarea
                  value={newCat.description}
                  onChange={(e) => setNewCat((p) => ({ ...p, description: e.target.value }))}
                  placeholder={t("categoryDescPh")}
                  className="min-h-16 rounded-md border border-input px-3 py-2 text-sm md:col-span-2"
                />
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-md border border-input px-3 py-2 text-sm md:col-span-2"
                >
                  <Plus className="h-4 w-4" />
                  {t("addCategory")}
                </button>
              </form>
            </CardContent>
          </Card>
        ) : null}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t("sectionRoutes")}</h2>
          {canSaveLayout && savingLayout ? (
            <span className="text-xs text-muted-foreground">{t("saving")}</span>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">{t("routesHelp")}</p>
        <p className="text-sm text-muted-foreground">{t("recipientsHelp")}</p>

        <Card>
          <CardContent className="divide-y p-0">
            {ALERT_ROUTE_KEYS.map((rk) => {
              const b = bindingByRoute.get(rk);
              const pm = b?.push_mobile ?? true;
              const pw = b?.push_web ?? true;
              const pe = b?.push_email ?? false;
              const recipientRule = normalizeRecipientRule(
                b?.recipient ?? mergedConfig.defaultRecipient ?? { mode: "self" },
              );
              return (
                <div key={rk} className="space-y-2 px-4 py-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-sm font-medium text-foreground">{routeLabels[rk]}</span>
                    <select
                      disabled={!canSaveLayout}
                      value={b?.categoryId ?? config.categories[0]?.id ?? ""}
                      onChange={(e) => setBindingCategory(rk, e.target.value)}
                      className="max-w-full rounded-md border border-input px-3 py-2 text-sm sm:max-w-xs"
                    >
                      {config.categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title} ({c.id})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <Checkbox
                        disabled={!canSaveLayout}
                        checked={pm}
                        onChange={(e) => setBindingChannel(rk, "push_mobile", e.target.checked)}
                        rootClassName="h-3.5 w-3.5"
                        boxClassName="h-3.5 w-3.5"
                        iconClassName="h-2.5 w-2.5"
                      />
                      {t("channelMobile")}
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <Checkbox
                        disabled={!canSaveLayout}
                        checked={pw}
                        onChange={(e) => setBindingChannel(rk, "push_web", e.target.checked)}
                        rootClassName="h-3.5 w-3.5"
                        boxClassName="h-3.5 w-3.5"
                        iconClassName="h-2.5 w-2.5"
                      />
                      {t("channelWeb")}
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <Checkbox
                        disabled={!canSaveLayout}
                        checked={pe}
                        onChange={(e) => setBindingChannel(rk, "push_email", e.target.checked)}
                        rootClassName="h-3.5 w-3.5"
                        boxClassName="h-3.5 w-3.5"
                        iconClassName="h-2.5 w-2.5"
                      />
                      {t("channelEmail")}
                    </label>
                  </div>
                  <RecipientRuleEditor
                    idPrefix={`rb-${rk}`}
                    rule={recipientRule}
                    onChange={(next) => setBindingRecipient(rk, next)}
                    disabled={!canSaveLayout}
                    roles={roleRows}
                    staffOptions={staffPickerOptions}
                    refDirectoryLoading={refDirectoryLoading}
                    heading={t("recipientRouteHeading", { screen: routeLabels[rk] })}
                  />
                </div>
              );
            })}
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("sectionPush")}</h2>
        <p className="text-sm text-muted-foreground">{t("pushHelp")}</p>

        {!canCreateAlert ? (
          <p className="text-sm text-destructive">{t("pushNoPermission")}</p>
        ) : (
          <Card>
            <CardContent className="space-y-3 p-4">
              <form className="space-y-3" onSubmit={sendPush}>
                <div className="grid gap-2 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      {t("pushCategory")}
                    </label>
                    <select
                      value={pushForm.categoryId}
                      onChange={(e) =>
                        setPushForm((p) => ({ ...p, categoryId: e.target.value }))
                      }
                      className="w-full rounded-md border border-input px-3 py-2 text-sm"
                    >
                      {config.categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      {t("pushTitle")}
                    </label>
                    <input
                      value={pushForm.title}
                      onChange={(e) => setPushForm((p) => ({ ...p, title: e.target.value }))}
                      className="w-full rounded-md border border-input px-3 py-2 text-sm font-semibold uppercase tracking-tight"
                      placeholder={t("pushTitlePh")}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      {t("pushThumb")}
                    </label>
                    <input
                      value={pushForm.thumbUrl}
                      onChange={(e) => setPushForm((p) => ({ ...p, thumbUrl: e.target.value }))}
                      className="w-full rounded-md border border-input px-3 py-2 text-sm"
                      placeholder="https://…"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      {t("pushBody")}
                    </label>
                    <textarea
                      value={pushForm.message}
                      onChange={(e) => setPushForm((p) => ({ ...p, message: e.target.value }))}
                      className="min-h-28 w-full rounded-md border border-input px-3 py-2 text-sm"
                      placeholder={t("pushBodyPh")}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      {t("pushGallery")}
                    </label>
                    <textarea
                      value={pushForm.galleryLines}
                      onChange={(e) =>
                        setPushForm((p) => ({ ...p, galleryLines: e.target.value }))
                      }
                      className="min-h-20 w-full rounded-md border border-input px-3 py-2 text-sm font-mono"
                      placeholder={t("pushGalleryPh")}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      {t("pushHref")}
                    </label>
                    <input
                      value={pushForm.href}
                      onChange={(e) => setPushForm((p) => ({ ...p, href: e.target.value }))}
                      className="w-full rounded-md border border-input px-3 py-2 text-sm"
                      placeholder="/inventory"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-4">
                  {(
                    [
                      ["pushMobile", t("channelMobile")] as const,
                      ["pushWeb", t("channelWeb")] as const,
                      ["pushEmail", t("channelEmail")] as const,
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="flex cursor-pointer items-center gap-2 text-sm">
                      <Checkbox
                        checked={pushForm[key]}
                        onChange={(e) =>
                          setPushForm((p) => ({ ...p, [key]: e.target.checked }))
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>

                <RecipientRuleEditor
                  idPrefix="push-compose-recipient"
                  rule={composeRecipient}
                  onChange={setComposeRecipient}
                  disabled={false}
                  roles={roleRows}
                  staffOptions={staffPickerOptions}
                  refDirectoryLoading={refDirectoryLoading}
                  heading={t("pushRecipientHeading")}
                  compact
                />

                {pushError ? <p className="text-sm text-destructive">{pushError}</p> : null}

                <button
                  type="submit"
                  disabled={pushSubmitting}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
                >
                  {pushSubmitting ? t("pushSending") : t("pushSubmit")}
                </button>
              </form>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
