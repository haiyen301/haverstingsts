"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import RequireAuth from "@/features/auth/RequireAuth";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { CheckBadge } from "@/shared/ui/check-badge";
import {
  fetchRoles,
  QUICK_ROLE_MODULES,
  removeRole,
  ROLE_ACTIONS,
  saveRole,
  type RoleAction,
  type RoleModule,
  type RoleRow,
} from "@/features/admin/api/rolesApi";

const inputClass =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";
const btnOutline =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const btnGhost =
  "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type FormState = {
  id?: number;
  title: string;
  permissions: Record<string, string>;
};

function emptyForm(): FormState {
  return { title: "", permissions: {} };
}

function permissionKey(action: RoleAction, moduleName: RoleModule): string {
  return `${action}_${moduleName}`;
}

export default function AdminRolesPage() {
  const t = useTranslations("AdminRoles");
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchRoles();
        if (!mounted) return;
        setRoles(data);
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : t("loadFailed"));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const moduleLabels = useMemo<Record<RoleModule, string>>(
    () => ({
      my_alerts: t("modules.my_alerts"),
      projects: t("modules.projects"),
      forecasting: t("modules.forecasting"),
      inventory: t("modules.inventory"),
      harvest_schedule: t("modules.harvest_schedule"),
      harvests: t("modules.harvests"),
      admin_people: t("modules.admin_people"),
      admin_project_types: t("modules.admin_project_types"),
      admin_architects: t("modules.admin_architects"),
      admin_zones: t("modules.admin_zones"),
      admin_regrowth: t("modules.admin_regrowth"),
      admin_grasses: t("modules.admin_grasses"),
      admin_countries: t("modules.admin_countries"),
      dashboard: t("modules.dashboard"),
    }),
    [t],
  );

  const openCreate = () => {
    setForm(emptyForm());
    setOpen(true);
  };

  const openEdit = (row: RoleRow) => {
    setForm({
      id: row.id,
      title: row.title,
      permissions: { ...(row.permissions ?? {}) },
    });
    setOpen(true);
  };

  const togglePermission = (action: RoleAction, moduleName: RoleModule, checked: boolean) => {
    const key = permissionKey(action, moduleName);
    setForm((prev) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [key]: checked ? "1" : "",
      },
    }));
  };

  const setActionForAllModules = (action: RoleAction, checked: boolean) => {
    setForm((prev) => {
      const next = { ...prev.permissions };
      QUICK_ROLE_MODULES.forEach((moduleName) => {
        next[permissionKey(action, moduleName)] = checked ? "1" : "";
      });
      return { ...prev, permissions: next };
    });
  };

  const isActionAllChecked = (action: RoleAction): boolean =>
    QUICK_ROLE_MODULES.every((moduleName) => form.permissions[permissionKey(action, moduleName)] === "1");

  const handleSave = async () => {
    const title = form.title.trim();
    if (!title || saving) return;

    try {
      setSaving(true);
      const saved = await saveRole({
        id: form.id,
        title,
        permissions: form.permissions,
      });

      setRoles((prev) => {
        const idx = prev.findIndex((r) => r.id === saved.id);
        if (idx < 0) return [...prev, saved];
        const next = [...prev];
        next[idx] = saved;
        return next;
      });
      setOpen(false);
      setForm(emptyForm());
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    await removeRole(id);
    setRoles((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="space-y-6 p-4 lg:p-8">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold tracking-tight lg:text-3xl">{t("title")}</h1>
            <button type="button" className={btnOutline} onClick={openCreate}>
              <Plus className="h-4 w-4" />
              {t("addRole")}
            </button>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-4 py-3 text-left font-medium">{t("colRole")}</th>
                      <th className="px-4 py-3 text-left font-medium">{t("colPermissionSummary")}</th>
                      <th className="px-4 py-3 text-right font-medium">{t("colActions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roles.map((r) => (
                      <tr key={r.id} className="border-b border-border last:border-b-0">
                        <td className="px-4 py-3 font-medium">{r.title}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {ROLE_ACTIONS.map((action) => {
                            const count = QUICK_ROLE_MODULES.filter(
                              (moduleName) => r.permissions?.[permissionKey(action, moduleName)] === "1",
                            ).length;
                            const actionKey = action.slice(4) as "show" | "edit" | "create" | "delete" | "import";
                            return t("permissionCount", {
                              action: t(`actions.${actionKey}`),
                              count,
                              total: QUICK_ROLE_MODULES.length,
                            });
                          }).join(" | ")}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button type="button" className={btnGhost} onClick={() => openEdit(r)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className={cn(btnGhost, "text-destructive")}
                              onClick={() => void handleDelete(r.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {roles.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                          {loading ? t("loadingRoles") : error ?? t("noRoles")}
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
          <div className="fixed inset-0 z-90 flex items-center justify-center bg-black/40 p-4" onMouseDown={() => setOpen(false)}>
            <Card className="max-h-[90vh] w-full max-w-4xl overflow-y-auto" onMouseDown={(e) => e.stopPropagation()}>
              <CardContent className="space-y-5 p-6">
                <h2 className="text-xl font-semibold">{form.id ? t("editRole") : t("newRole")}</h2>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t("roleNameLabel")}</label>
                  <input
                    className={inputClass}
                    value={form.title}
                    onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                  />
                </div>

                <div className="space-y-3 rounded-lg border border-border p-4">
                  <p className="text-sm font-medium">{t("quickToggle")}</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                    {ROLE_ACTIONS.map((action) => {
                      const actionKey = action.slice(4) as "show" | "edit" | "create" | "delete" | "import";
                      const label = t(`actions.${actionKey}`);
                      const checked = isActionAllChecked(action);
                      return (
                        <label key={action} className="relative block cursor-pointer">
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={checked}
                            onChange={(e) => setActionForAllModules(action, e.target.checked)}
                          />
                          <span
                            className={`flex h-10 w-full items-center justify-center rounded-md border px-3 text-sm font-medium capitalize transition-colors ${
                              checked
                                ? "border-primary bg-primary/5 text-primary"
                                : "border-input bg-card text-foreground shadow-sm"
                            }`}
                          >
                            {label}
                          </span>
                          {checked ? <CheckBadge /> : null}
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/20">
                        <th className="px-4 py-3 text-left font-medium">{t("colModule")}</th>
                        {ROLE_ACTIONS.map((action) => {
                          const actionKey = action.slice(4) as "show" | "edit" | "create" | "delete" | "import";
                          return (
                          <th key={action} className="w-40 px-4 py-3 text-center font-medium capitalize">
                            {t(`actions.${actionKey}`)}
                          </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {QUICK_ROLE_MODULES.map((moduleName) => (
                        <tr key={moduleName} className="border-b border-border last:border-b-0">
                          <td className="px-4 py-3">{moduleLabels[moduleName]}</td>
                          {ROLE_ACTIONS.map((action) => {
                            const key = permissionKey(action, moduleName);
                            const checked = form.permissions[key] === "1";
                            const actionKey = action.slice(4) as "show" | "edit" | "create" | "delete" | "import";
                            return (
                              <td key={key} className="px-4 py-2 text-center align-middle">
                                <label className="relative inline-block cursor-pointer">
                                  <input
                                    type="checkbox"
                                    className="sr-only"
                                    checked={checked}
                                    onChange={(e) => togglePermission(action, moduleName, e.target.checked)}
                                  />
                                  <span
                                    className={`inline-flex h-8 w-20 items-center justify-center rounded-md border px-2 text-xs font-medium capitalize transition-colors ${
                                      checked
                                        ? "border-primary bg-primary/5 text-primary"
                                        : "border-input bg-card text-foreground shadow-sm"
                                    }`}
                                  >
                                    {t(`actions.${actionKey}`)}
                                  </span>
                                  {checked ? (
                                    <CheckBadge
                                      className="left-1 top-1 h-3.5 w-3.5"
                                      iconClassName="h-2.5 w-2.5"
                                    />
                                  ) : null}
                                </label>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end gap-2">
                  <button type="button" className={btnOutline} onClick={() => setOpen(false)}>
                    {t("cancel")}
                  </button>
                  <button type="button" className={btnOutline} onClick={() => void handleSave()} disabled={saving}>
                    {saving ? t("saving") : form.id ? t("saveChanges") : t("createRole")}
                  </button>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </DashboardLayout>
    </RequireAuth>
  );
}
