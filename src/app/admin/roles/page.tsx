"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
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
        setError(e instanceof Error ? e.message : "Failed to load roles.");
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
      my_alerts: "My Alerts",
      projects: "Projects",
      forecasting: "Forecasting",
      inventory: "Inventory",
      harvest_schedule: "Harvest Schedule",
      harvests: "Harvests",
      admin_people: "People",
      admin_project_types: "Project Types",
      admin_architects: "Architects",
      admin_zones: "Zones",
      admin_regrowth: "Regrowth",
      dashboard: "Dashboard",
    }),
    [],
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
            <h1 className="text-2xl font-semibold tracking-tight lg:text-3xl">Role Management</h1>
            <button type="button" className={btnOutline} onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Add Role
            </button>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-4 py-3 text-left font-medium">Role</th>
                      <th className="px-4 py-3 text-left font-medium">Permission Summary</th>
                      <th className="px-4 py-3 text-right font-medium">Actions</th>
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
                            return `${action.replace("can_", "")}: ${count}/${QUICK_ROLE_MODULES.length}`;
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
                          {loading ? "Loading roles..." : error ?? "No roles found."}
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
                <h2 className="text-xl font-semibold">{form.id ? "Edit Role" : "Add Role"}</h2>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Role Name *</label>
                  <input
                    className={inputClass}
                    value={form.title}
                    onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                  />
                </div>

                <div className="space-y-3 rounded-lg border border-border p-4">
                  <p className="text-sm font-medium">Quick Toggle (Selected Modules)</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                    {ROLE_ACTIONS.map((action) => {
                      const label = action.replace("can_", "");
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
                        <th className="px-4 py-3 text-left font-medium">Module</th>
                        {ROLE_ACTIONS.map((action) => (
                          <th key={action} className="w-40 px-4 py-3 text-center font-medium capitalize">
                            {action.replace("can_", "")}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {QUICK_ROLE_MODULES.map((moduleName) => (
                        <tr key={moduleName} className="border-b border-border last:border-b-0">
                          <td className="px-4 py-3">{moduleLabels[moduleName]}</td>
                          {ROLE_ACTIONS.map((action) => {
                            const key = permissionKey(action, moduleName);
                            const checked = form.permissions[key] === "1";
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
                                    {action.replace("can_", "")}
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
                    Cancel
                  </button>
                  <button type="button" className={btnOutline} onClick={() => void handleSave()} disabled={saving}>
                    {saving ? "Saving..." : form.id ? "Save Changes" : "Create Role"}
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
