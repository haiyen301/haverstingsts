"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  Eye,
  EyeOff,
  Loader2,
  Mail,
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { canAccessModule } from "@/shared/auth/permissions";
import RequireAuth from "@/features/auth/RequireAuth";
import { useAuthUserStore } from "@/shared/store/authUserStore";
import { fetchRoles } from "@/features/admin/api/rolesApi";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { MultiSelect } from "@/shared/ui/multi-select";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/shared/ui/checkbox";
import { CheckBadge } from "@/shared/ui/check-badge";
import { ConfirmDeleteDialog } from "@/shared/ui/ConfirmDeleteDialog";
import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import { INTERNAL_API } from "@/shared/api/stsLogin";
import {
  stsProxyGet,
  stsProxyGetWithParams,
  stsProxyPostJson,
} from "@/shared/api/stsProxyClient";

type PersonType = "staff" | "customer_contact" | "architect" | "other";

type RoleOption = {
  id: string;
  title: string;
};

const PROFILE_IMAGE_BASE_URL =
  firstNonEmptyString(
    process.env.NEXT_PUBLIC_STS_DOMAIN_URL,
    process.env.NEXT_PUBLIC_STS_API_BASE_URLS?.split(",")[0],
    process.env.NEXT_PUBLIC_STS_API_BASE_URL,
  ).replace(/\/+$/, "");

type Person = {
  id: string;
  createdAt: string;
  fullName: string;
  email: string;
  phone?: string;
  jobTitle?: string;
  company?: string;
  type: PersonType;
  location?: string;
  isStsPic?: boolean;
  isAdmin?: boolean;
  hasLogin: boolean;
  role?: string;
  roleId?: string | null;
  status: "Active" | "Inactive";
  odooId?: string | null;
  /** Comma-separated `sts_farms.id` from `sts_users_meta.farm_user_id`. */
  farmUserId?: string | null;
  lastOnline?: string | null;
  avatarUrl?: string | null;
  password?: string;
  passwordConfirm?: string;
  resetPassword?: boolean;
};

type FarmOption = {
  id: string;
  label: string;
};

function parseFarmIdsFromMeta(value: string | null | undefined): string[] {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function normalizeFarmsPayload(raw: unknown): FarmOption[] {
  const rows = asArray(raw);
  const out: FarmOption[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const id = firstNonEmptyString(o.id);
    if (!id) continue;
    const name =
      firstNonEmptyString(o.name, o.title, o.farm_name) || `Farm #${id}`;
    const country = firstNonEmptyString(o.country_name);
    const label = country ? `${name} (${country})` : name;
    out.push({ id, label });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

const roleColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  "Super Admin": "destructive",
  Administrator: "destructive",
  "Turf Farm Manager": "default",
  "Farm Staff": "secondary",
  "Operations Manager": "outline",
  Viewer: "secondary",
};

function getRoleBadgeVariant(
  role?: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (!role) return "secondary";
  return roleColors[role] ?? "outline";
}

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (!v || typeof v !== "object") return [];
  const obj = v as Record<string, unknown>;
  const candidates = [obj.data, obj.rows, obj.items, obj.results, obj.list];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return [];
}

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function resolveProfileImageUrl(rawImage: unknown): string | null {
  const raw = String(rawImage ?? "").trim();
  if (!raw) return null;

  // Legacy PHP serialized format, e.g.:
  // a:1:{s:9:"file_name";s:29:"_file677cabd63237f-avatar.png";}
  const serializedMatch = raw.match(/file_name";s:\d+:"([^"]+)"/);
  if (serializedMatch?.[1]) {
    const rel = `/files/profile_images/${serializedMatch[1]}`;
    return PROFILE_IMAGE_BASE_URL ? `${PROFILE_IMAGE_BASE_URL}${rel}` : rel;
  }

  // Fallback for cases where API already returns plain file name.
  if (!raw.includes("{") && !raw.includes("}")) {
    const rel = `/files/profile_images/${raw}`;
    return PROFILE_IMAGE_BASE_URL ? `${PROFILE_IMAGE_BASE_URL}${rel}` : rel;
  }

  return null;
}

function mapStaffToPerson(raw: unknown): Person | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = firstNonEmptyString(row.id, row.user_id, row.staff_id);
  if (!id) return null;

  const firstName = String(row.first_name ?? "").trim();
  const lastName = String(row.last_name ?? "").trim();
  const fullName = firstNonEmptyString(
    row.full_name,
    row.name,
    `${firstName} ${lastName}`.trim(),
  );
  const statusRaw = firstNonEmptyString(row.status, row.user_status, row.active);
  const inactiveValues = new Set(["0", "inactive", "disabled", "false", "no"]);
  const isAdmin = Boolean(Number(row.is_admin ?? 0));
  const roleTitle = firstNonEmptyString(row.role_title) || undefined;

  return {
    id,
    createdAt: firstNonEmptyString(row.created_at, row.createdAt, new Date().toISOString()),
    fullName: fullName || `Staff #${id}`,
    email: firstNonEmptyString(row.email, row.user_email),
    phone: firstNonEmptyString(row.phone, row.phone_number, row.mobile),
    jobTitle: firstNonEmptyString(row.job_title, row.jobTitle, row.designation),
    company: firstNonEmptyString(row.company, row.company_name),
    type: "staff",
    location: firstNonEmptyString(row.location, row.address, row.farm_name),
    isStsPic: Boolean(Number(row.is_sts_pic ?? row.is_pic ?? 0)),
    isAdmin,
    hasLogin: !Boolean(Number(row.disable_login ?? 0)),
    role: isAdmin ? "Super Admin" : roleTitle,
    roleId: firstNonEmptyString(row.role_id) || null,
    status: inactiveValues.has(statusRaw.toLowerCase()) ? "Inactive" : "Active",
    odooId: firstNonEmptyString(row.odoo_id, row.odooId) || null,
    farmUserId: firstNonEmptyString(row.farm_user_id, row.farmUserId) || null,
    lastOnline: firstNonEmptyString(row.last_online, row.lastOnline) || null,
    avatarUrl: resolveProfileImageUrl(row.image),
  };
}

function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const normalized = fullName.trim().replace(/\s+/g, " ");
  if (!normalized) return { firstName: "", lastName: "" };
  const parts = normalized.split(" ");
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

type PersonForm = Omit<Person, "id" | "createdAt"> & {
  /** Selected farm ids (persisted as comma-separated meta `farm_user_id`). */
  farmIds: string[];
};

function emptyPerson(): PersonForm {
  return {
    fullName: "",
    email: "",
    phone: "",
    jobTitle: "",
    company: "",
    type: "staff",
    location: "",
    isStsPic: false,
    isAdmin: false,
    hasLogin: false,
    role: undefined,
    status: "Active",
    odooId: null,
    farmUserId: null,
    lastOnline: null,
    password: "",
    passwordConfirm: "",
    resetPassword: false,
    farmIds: [],
  };
}

function formatLastOnline(value: string | null | undefined, neverLabel: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return neverLabel;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString();
}

function personTypeLabel(
  t: ReturnType<typeof useTranslations<"AdminPeople">>,
  type: PersonType,
): string {
  switch (type) {
    case "staff":
      return t("types.staff");
    case "customer_contact":
      return t("types.customerContact");
    case "architect":
      return t("types.architect");
    case "other":
      return t("types.other");
    default:
      return type;
  }
}

export default function AdminPeoplePage() {
  const t = useTranslations("AdminPeople");
  const [people, setPeople] = useState<Person[]>([]);
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        setLoading(true);
        setLoadError(null);
        const [staffResult, rolesResult] = await Promise.allSettled([
          stsProxyGet<unknown>(STS_API_PATHS.staffs),
          fetchRoles(),
        ]);
        if (staffResult.status === "rejected") {
          throw staffResult.reason;
        }
        if (!mounted) return;
        const rolesFromTable =
          rolesResult.status === "fulfilled"
            ? rolesResult.value.map((row) => ({
                id: String(row.id),
                title: String(row.title ?? "").trim(),
              }))
            : [];
        const roleTitleById = new Map(
          rolesFromTable
            .filter((row) => row.id && row.title)
            .map((row) => [row.id, row.title]),
        );

        const mapped = asArray(staffResult.value)
          .map(mapStaffToPerson)
          .filter((row): row is Person => row !== null)
          .map((row) => {
            if (row.isAdmin) return { ...row, role: "Super Admin" };
            if (!row.roleId) return row;
            const roleTitle = roleTitleById.get(row.roleId);
            if (!roleTitle) return row;
            return { ...row, role: roleTitle };
          });
        const fallbackRoleOptions = Array.from(
          new Set(mapped.map((row) => row.role).filter((v): v is string => Boolean(v))),
        ).map((title) => ({ id: title, title }));
        setRoleOptions(rolesFromTable.length > 0 ? rolesFromTable : fallbackRoleOptions);
        setPeople(mapped);
      } catch (error) {
        if (!mounted) return;
        const message =
          error instanceof Error ? error.message : t("errors.loadStaffFailed");
        setLoadError(message);
        setPeople([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const savePerson = async (id: string | null, payload: PersonForm) => {
    const { firstName, lastName } = splitFullName(payload.fullName);
    const saved = await stsProxyPostJson<unknown>(STS_API_PATHS.staffSave, {
      id: id ? Number(id) : undefined,
      user_type: "staff",
      first_name: firstName,
      last_name: lastName,
      email: payload.email,
      phone: payload.phone ?? "",
      job_title: payload.jobTitle ?? "",
      address: payload.location ?? "",
      disable_login: payload.hasLogin ? 0 : 1,
      role_id: payload.hasLogin
        ? payload.isAdmin
          ? 0
          : Number(payload.roleId ?? 0)
        : 0,
      ...(payload.hasLogin ? { is_admin: payload.isAdmin ? 1 : 0 } : {}),
      status: payload.status === "Active" ? "active" : "inactive",
      is_sts_pic: payload.isStsPic ? 1 : 0,
      odoo_id: payload.odooId ?? null,
      ...(payload.isAdmin ? {} : { farm_user_ids: payload.farmIds }),
      password:
        payload.hasLogin &&
        (!id || payload.resetPassword) &&
        payload.password
          ? payload.password
          : undefined,
    });
    const mappedRaw = mapStaffToPerson(saved);
    const mapped =
      mappedRaw && !mappedRaw.isAdmin && mappedRaw.roleId
        ? {
            ...mappedRaw,
            role:
              roleOptions.find((r) => r.id === mappedRaw.roleId)?.title ??
              mappedRaw.role,
          }
        : mappedRaw;
    if (!mapped) return;
    setPeople((prev) => {
      const exists = prev.some((p) => p.id === mapped.id);
      if (!exists) return [...prev, mapped];
      return prev.map((p) => (p.id === mapped.id ? mapped : p));
    });
  };

  const deletePerson = async (id: string) => {
    try {
      await stsProxyPostJson(STS_API_PATHS.staffDelete, {
        user_id: Number(id),
      });
      setPeople((prev) => prev.filter((p) => p.id !== id));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to delete user.";
      setLoadError(message);
    }
  };

  const togglePersonStatus = async (id: string) => {
    const target = people.find((p) => p.id === id);
    if (!target) return;
    const nextStatus: Person["status"] =
      target.status === "Active" ? "Inactive" : "Active";
    const disableLogin = nextStatus === "Inactive" ? 1 : 0;

    await stsProxyPostJson(STS_API_PATHS.staffToggleLogin, {
      user_id: Number(id),
      disable_login: disableLogin,
    });

    setPeople((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              status: nextStatus,
              hasLogin: disableLogin === 0,
            }
          : p,
      ),
    );
  };

  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="space-y-6 p-4 lg:p-8">
          <h1 className="text-2xl font-semibold tracking-tight lg:text-3xl">
            {t("title")}
          </h1>
          <PeopleSection
            people={people}
            roleOptions={roleOptions}
            loading={loading}
            loadError={loadError}
            savePerson={savePerson}
            deletePerson={deletePerson}
            togglePersonStatus={togglePersonStatus}
          />
        </div>
      </DashboardLayout>
    </RequireAuth>
  );
}

const inputClass =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";
const btnOutline =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const btnPrimary =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-transparent bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
const btnGhost =
  "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const farmSelectTriggerClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm hover:bg-muted/50";

const farmSelectChevron = (
  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
);
const badgeBaseClass =
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold";
const badgeVariantClass = {
  default: "border-transparent bg-primary text-primary-foreground",
  secondary: "border-transparent bg-secondary text-secondary-foreground",
  destructive: "border-transparent bg-destructive text-destructive-foreground",
  outline: "text-foreground",
} as const;

function PeopleSection({
  people,
  roleOptions,
  loading,
  loadError,
  savePerson,
  deletePerson,
  togglePersonStatus,
}: {
  people: Person[];
  roleOptions: RoleOption[];
  loading: boolean;
  loadError: string | null;
  savePerson: (id: string | null, payload: PersonForm) => Promise<void>;
  deletePerson: (id: string) => Promise<void>;
  togglePersonStatus: (id: string) => Promise<void>;
}) {
  const t = useTranslations("AdminPeople");
  const tCommon = useTranslations("Common");
  const user = useAuthUserStore((s) => s.user);
  const canCreatePeople = canAccessModule(user, "admin_people", "create");
  const canEditPeople = canAccessModule(user, "admin_people", "edit");
  const canDeletePeople = canAccessModule(user, "admin_people", "delete");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | PersonType>("all");
  const [accessFilter, setAccessFilter] = useState<"all" | "login" | "directory">("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PersonForm>(emptyPerson());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusPendingId, setStatusPendingId] = useState<string | null>(null);
  const [farmOptions, setFarmOptions] = useState<FarmOption[]>([]);
  const [farmsLoadError, setFarmsLoadError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Person | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [resetEmailSending, setResetEmailSending] = useState(false);
  const [resetEmailFeedback, setResetEmailFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);

  const closePeopleDialog = () => {
    setDialogOpen(false);
    setSaveError(null);
    setResetEmailFeedback(null);
    setShowPassword(false);
    setShowPasswordConfirm(false);
  };

  useEffect(() => {
    if (!dialogOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setDialogOpen(false);
      setSaveError(null);
      setResetEmailFeedback(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialogOpen]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const refParams: Record<string, string | number | undefined> = {};
        if (typeof window !== "undefined") {
          const { getSessionUser } = await import("@/shared/store/authUserStore");
          const uid = getSessionUser()?.id;
          if (uid != null && Number.isFinite(Number(uid)) && Number(uid) > 0) {
            refParams.react_client_user_id = Number(uid);
          }
        }
        const data = await stsProxyGetWithParams<unknown>(
          STS_API_PATHS.farms,
          refParams,
        );
        if (!mounted) return;
        setFarmOptions(normalizeFarmsPayload(data));
        setFarmsLoadError(null);
      } catch (e) {
        if (!mounted) return;
        setFarmOptions([]);
        setFarmsLoadError(
          e instanceof Error ? e.message : t("errors.loadFarmsFailed"),
        );
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const filtered = useMemo(
    () =>
      people.filter((p) => {
        if (typeFilter !== "all" && p.type !== typeFilter) return false;
        if (accessFilter === "login" && !p.hasLogin) return false;
        if (accessFilter === "directory" && p.hasLogin) return false;
        if (roleFilter !== "all") {
          if (roleFilter === "__super_admin__") {
            if (!p.isAdmin) return false;
          } else if ((p.roleId ?? "") !== roleFilter) {
            return false;
          }
        }
        if (search) {
          const s = search.toLowerCase();
          if (
            !p.fullName.toLowerCase().includes(s) &&
            !p.email.toLowerCase().includes(s)
          ) {
            return false;
          }
        }
        return true;
      }),
    [accessFilter, people, roleFilter, search, typeFilter],
  );

  const farmMultiOptions = useMemo(
    () => farmOptions.map((f) => ({ value: f.id, label: f.label })),
    [farmOptions],
  );

  const stats = useMemo(
    () => ({
      total: people.length,
      staff: people.filter((p) => p.type === "staff").length,
      pics: people.filter((p) => p.isStsPic).length,
      logins: people.filter((p) => p.hasLogin).length,
    }),
    [people],
  );

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyPerson());
    setSaveError(null);
    setResetEmailFeedback(null);
    setShowPassword(false);
    setShowPasswordConfirm(false);
    setDialogOpen(true);
  };

  const openEdit = (p: Person) => {
    const { id: _id, createdAt: _createdAt, farmUserId, ...rest } = p;
    setEditingId(p.id);
    setForm({
      ...rest,
      odooId: rest.odooId ?? null,
      farmIds: parseFarmIdsFromMeta(farmUserId),
    });
    setSaveError(null);
    setResetEmailFeedback(null);
    setShowPassword(false);
    setShowPasswordConfirm(false);
    setDialogOpen(true);
  };

  const handleSendResetEmail = async () => {
    const email = form.email.trim();
    if (!email) {
      setResetEmailFeedback({
        kind: "error",
        message: t("errors.resetEmailRequired"),
      });
      return;
    }
    try {
      setResetEmailSending(true);
      setResetEmailFeedback(null);
      const res = await fetch(INTERNAL_API.authentication.forgetPassword, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ email }),
      });
      const json = (await res.json()) as { success?: boolean; message?: string };
      if (!res.ok || !json.success) {
        throw new Error(json.message ?? `Request failed (${res.status})`);
      }
      setResetEmailFeedback({
        kind: "success",
        message:
          json.message?.trim() || t("errors.resetEmailSent"),
      });
    } catch (e) {
      setResetEmailFeedback({
        kind: "error",
        message:
          e instanceof Error ? e.message : t("errors.resetEmailFailed"),
      });
    } finally {
      setResetEmailSending(false);
    }
  };

  const handleSave = async () => {
    if (!form.fullName || !form.email) {
      setSaveError(t("errors.fullNameEmailRequired"));
      return;
    }
    if (form.hasLogin && !form.isAdmin && !form.roleId) {
      setSaveError(t("errors.roleRequired"));
      return;
    }
    if (form.hasLogin && !form.isAdmin && form.farmIds.length === 0) {
      setSaveError(t("errors.farmRequired"));
      return;
    }
    if (form.hasLogin) {
      const mustProvidePassword = !editingId || !!form.resetPassword;
      if (mustProvidePassword) {
        if (!form.password || form.password.length < 6) {
          setSaveError(t("errors.passwordMinLength"));
          return;
        }
        if (form.password !== form.passwordConfirm) {
          setSaveError(t("errors.passwordMismatch"));
          return;
        }
      }
    }
    try {
      setSaveError(null);
      setSaving(true);
      await savePerson(editingId, form);
      setDialogOpen(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t("errors.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (id: string) => {
    if (!canEditPeople) return;
    try {
      setStatusPendingId(id);
      await togglePersonStatus(id);
    } catch (error) {
      console.error("Failed to toggle staff login status:", error);
    } finally {
      setStatusPendingId(null);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t("description")}{" "}
          <code className="text-xs">odooId</code> field.
        </p>
        {canCreatePeople ? (
          <button type="button" className={btnOutline} onClick={openCreate}>
            <Plus className="h-4 w-4" />
            {t("addPerson")}
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{t("stats.totalPeople")}</p>
            <p className="text-2xl font-bold">{stats.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{t("stats.staff")}</p>
            <p className="text-2xl font-bold">{stats.staff}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{t("stats.eligiblePics")}</p>
            <p className="text-2xl font-bold text-primary">{stats.pics}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{t("stats.appLogins")}</p>
            <p className="text-2xl font-bold">{stats.logins}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
          <input
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={cn(inputClass, "pl-9")}
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
          className={cn(inputClass, "w-[180px]")}
        >
          <option value="all">{t("filters.allTypes")}</option>
          <option value="staff">{t("types.staff")}</option>
          <option value="customer_contact">{t("types.customerContact")}</option>
          <option value="architect">{t("types.architect")}</option>
          <option value="other">{t("types.other")}</option>
        </select>
        <select
          value={accessFilter}
          onChange={(e) =>
            setAccessFilter(e.target.value as typeof accessFilter)
          }
          className={cn(inputClass, "w-[180px]")}
        >
          <option value="all">{t("filters.allAccess")}</option>
          <option value="login">{t("filters.hasAppLogin")}</option>
          <option value="directory">{t("filters.directoryOnly")}</option>
        </select>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className={cn(inputClass, "w-[220px]")}
        >
          <option value="all">{t("filters.allRoles")}</option>
          {people.some((p) => p.isAdmin) ? (
            <option value="__super_admin__">{t("superAdmin")}</option>
          ) : null}
          {roleOptions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </select>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-3 text-left font-medium">{t("table.person")}</th>
                  <th className="px-4 py-3 text-left font-medium">{t("table.type")}</th>
                  <th className="px-4 py-3 text-left font-medium">
                    {t("table.locationCompany")}
                  </th>
                  <th className="px-4 py-3 text-left font-medium">{t("table.access")}</th>
                  <th className="px-4 py-3 text-left font-medium">{t("table.status")}</th>
                  <th className="px-4 py-3 text-right font-medium">{t("table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                          {p.avatarUrl ? (
                            <img
                              src={p.avatarUrl}
                              alt={p.fullName}
                              className="h-8 w-8 rounded-full object-cover"
                            />
                          ) : (
                            <span className="text-xs font-bold text-primary">
                              {p.fullName
                                .split(" ")
                                .map((n) => n[0])
                                .join("")
                                .slice(0, 2)}
                            </span>
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium">{p.fullName}</p>
                            {p.isStsPic ? (
                              <span
                                className={cn(
                                  badgeBaseClass,
                                  "border-emerald-200 bg-emerald-50 text-emerald-700",
                                )}
                                title={t("form.eligibleProjectPic")}
                                aria-label={t("form.eligibleProjectPic")}
                              >
                                PIC
                              </span>
                            ) : null}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {p.email}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {personTypeLabel(t, p.type)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {p.location || p.company || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        {p.hasLogin && p.role ? (
                          <span
                            className={cn(
                              badgeBaseClass,
                              badgeVariantClass[getRoleBadgeVariant(p.role)],
                              "text-xs",
                            )}
                          >
                            {p.role}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {t("noLogin")}
                          </span>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {t("lastOnline")}: {formatLastOnline(p.lastOnline, t("lastOnlineNever"))}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {canEditPeople ? (
                          <button
                            type="button"
                            role="switch"
                            aria-checked={p.status === "Active"}
                            className={cn(
                              "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              p.status === "Active"
                                ? "bg-lime-500"
                                : "bg-muted-foreground/40",
                              statusPendingId === p.id &&
                                "cursor-not-allowed opacity-60",
                            )}
                            disabled={statusPendingId === p.id}
                            onClick={() => void handleToggleStatus(p.id)}
                          >
                            <span
                              className={cn(
                                "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                                p.status === "Active"
                                  ? "translate-x-5"
                                  : "translate-x-1",
                              )}
                            />
                          </button>
                        ) : null}
                        <span
                          className={cn(
                            "text-xs",
                            p.status === "Active"
                              ? "text-foreground"
                              : "text-muted-foreground",
                          )}
                        >
                          {statusPendingId === p.id
                            ? t("saving")
                            : p.status === "Active"
                              ? t("status.active")
                              : t("status.inactive")}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {canEditPeople ? (
                          <button
                            type="button"
                            className={btnGhost}
                            onClick={() => openEdit(p)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                        {canDeletePeople ? (
                          <button
                            type="button"
                            className={cn(btnGhost, "text-destructive")}
                            onClick={() => setDeleteTarget(p)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-muted-foreground"
                    >
                      {loading
                        ? t("loading")
                        : loadError
                          ? loadError
                          : t("empty")}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {dialogOpen ? (
        <div
          className="fixed inset-0 z-90 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1px]"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closePeopleDialog();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="people-dialog-title"
            className="flex max-h-[min(92vh,52rem)] w-full max-w-[640px] flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-4">
              <div className="min-w-0 pr-2">
                <h2
                  id="people-dialog-title"
                  className="text-lg font-semibold tracking-tight"
                >
                  {editingId ? t("editPerson") : t("addPerson")}
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {editingId ? t("dialog.editDescription") : t("dialog.addDescription")}
                </p>
              </div>
              <button
                type="button"
                className={cn(
                  btnGhost,
                  "h-9 w-9 shrink-0 rounded-full hover:bg-muted",
                )}
                aria-label={t("dialog.close")}
                onClick={closePeopleDialog}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              <div className="grid gap-5">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2 space-y-2">
                    <label className="text-sm font-medium">{t("form.fullName")} *</label>
                    <input
                      className={inputClass}
                      value={form.fullName}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, fullName: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t("form.email")} *</label>
                    <input
                      className={inputClass}
                      type="email"
                      value={form.email}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, email: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t("form.phone")}</label>
                    <input
                      className={inputClass}
                      value={form.phone ?? ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, phone: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t("form.jobTitle")}</label>
                    <input
                      className={inputClass}
                      value={form.jobTitle ?? ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, jobTitle: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t("form.company")}</label>
                    <input
                      className={inputClass}
                      value={form.company ?? ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, company: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t("form.type")} *</label>
                    <select
                      className={inputClass}
                      value={form.type}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          type: e.target.value as PersonType,
                        }))
                      }
                    >
                      <option value="staff">{t("types.staff")}</option>
                      <option value="customer_contact">{t("types.customerContact")}</option>
                      <option value="architect">{t("types.architect")}</option>
                      <option value="other">{t("types.other")}</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t("form.status")}</label>
                    <select
                      className={inputClass}
                      value={form.status}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          status: e.target.value as "Active" | "Inactive",
                        }))
                      }
                    >
                      <option value="Active">{t("status.active")}</option>
                      <option value="Inactive">{t("status.inactive")}</option>
                    </select>
                  </div>
                  <div className="col-span-2 space-y-2">
                    <label className="text-sm font-medium">
                      {t("form.odooId")}
                    </label>
                    <input
                      className={inputClass}
                      placeholder={t("form.odooIdPlaceholder")}
                      value={form.odooId ?? ""}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          odooId: e.target.value || null,
                        }))
                      }
                    />
                  </div>
                </div>

                {form.type === "staff" ? (
                  <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
                    <p className="text-sm font-medium">{t("form.staffSettings")}</p>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">{t("form.location")}</label>
                        <input
                          className={inputClass}
                          placeholder={t("form.locationPlaceholder")}
                          value={form.location ?? ""}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, location: e.target.value }))
                          }
                        />
                      </div>
                      <label className="mt-7 flex h-10 cursor-pointer items-center justify-between rounded-md border border-input px-3">
                        <span className="text-sm">{t("form.eligibleProjectPic")}</span>
                        <Checkbox
                          checked={!!form.isStsPic}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              isStsPic: e.target.checked,
                            }))
                          }
                          rootClassName="h-5 w-5"
                          boxClassName="h-5 w-5 rounded-md peer-focus-visible:ring-lime-300"
                          iconClassName="h-3.5 w-3.5"
                          checkedClassName="peer-checked:border-lime-500 peer-checked:bg-lime-500 peer-checked:text-white"
                          uncheckedClassName="border-lime-500/70"
                        />
                      </label>
                    </div>
                  </div>
                ) : null}

                <div className="space-y-3 rounded-lg border border-border p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{t("form.appAccess")}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("form.appAccessHint")}
                      </p>
                    </div>
                    <label className="relative inline-flex cursor-pointer items-center">
                      <Checkbox
                        checked={form.hasLogin}
                        onChange={(e) => {
                          const on = e.target.checked;
                          setForm((f) => ({
                            ...f,
                            hasLogin: on,
                            ...(!on ? { farmIds: [] } : {}),
                          }));
                        }}
                        rootClassName="h-5 w-5"
                        boxClassName="h-5 w-5 rounded-md peer-focus-visible:ring-lime-300"
                        iconClassName="h-3.5 w-3.5"
                        checkedClassName="peer-checked:border-lime-500 peer-checked:bg-lime-500 peer-checked:text-white"
                        uncheckedClassName="border-lime-500/70"
                      />
                    </label>
                  </div>
                  {form.hasLogin ? (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">{t("form.superAdmin")}</label>
                        <p className="text-xs text-muted-foreground">
                          {t("form.superAdminHint")}
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setForm((f) => {
                              const nextIsAdmin = !f.isAdmin;
                              return {
                                ...f,
                                isAdmin: nextIsAdmin,
                                role: nextIsAdmin ? "Super Admin" : undefined,
                                roleId: nextIsAdmin ? null : f.roleId,
                                farmIds: nextIsAdmin ? [] : f.farmIds,
                              };
                            });
                          }}
                          className="relative block w-full cursor-pointer text-left"
                        >
                          <span
                            className={cn(
                              "flex min-h-11 items-center rounded-md border px-3 pl-9 text-sm transition-colors",
                              form.isAdmin
                                ? "border-primary bg-primary/5 text-primary"
                                : "border-input bg-card text-foreground shadow-sm",
                            )}
                          >
                            {t("form.superAdmin")}
                          </span>
                          {form.isAdmin ? <CheckBadge /> : null}
                        </button>
                      </div>
                      {!form.isAdmin ? (
                      <div className="space-y-2">
                        <label className="text-sm font-medium">{t("form.role")} *</label>
                        <select
                          className={inputClass}
                          value={form.roleId ?? ""}
                          onChange={(e) => {
                            const newRoleId = e.target.value || null;
                            const newTitle =
                              roleOptions.find((r) => r.id === newRoleId)?.title ??
                              undefined;
                            setForm((f) => ({
                              ...f,
                              roleId: newRoleId,
                              role: newTitle,
                            }));
                          }}
                        >
                          <option value="" disabled>
                            {t("form.selectRole")}
                          </option>
                          {roleOptions.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.title}
                            </option>
                          ))}
                        </select>
                      </div>
                      ) : null}
                      {!form.isAdmin && form.roleId ? (
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("form.farms")} *</label>
                          <p className="text-xs text-muted-foreground">
                            {t("form.farmsHintPrefix")}{" "}
                            <code className="text-xs">sts_users_meta</code> {t("form.farmsHintAs")}{" "}
                            <code className="text-xs">farm_user_id</code>{" "}
                            {t("form.farmsHintSuffix")}
                          </p>
                          {farmsLoadError ? (
                            <p className="text-xs text-destructive">
                              {farmsLoadError}
                            </p>
                          ) : null}
                          <MultiSelect
                            options={farmMultiOptions}
                            values={form.farmIds}
                            onChange={(next) =>
                              setForm((f) => ({ ...f, farmIds: next }))
                            }
                            placeholder={t("form.selectFarms")}
                            showFullSelectedLabels
                            className={cn(farmSelectTriggerClass)}
                            rightIcon={farmSelectChevron}
                            disabled={!!farmsLoadError}
                          />
                        </div>
                      ) : null}
                      {editingId ? (
                        <label className="flex h-10 cursor-pointer items-center justify-between rounded-md border border-input px-3">
                          <span className="text-sm">{t("form.createNewPassword")}</span>
                          <Checkbox
                            checked={!!form.resetPassword}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                resetPassword: e.target.checked,
                                password: "",
                                passwordConfirm: "",
                              }))
                            }
                            rootClassName="h-5 w-5"
                            boxClassName="h-5 w-5 rounded-md peer-focus-visible:ring-lime-300"
                            iconClassName="h-3.5 w-3.5"
                            checkedClassName="peer-checked:border-lime-500 peer-checked:bg-lime-500 peer-checked:text-white"
                            uncheckedClassName="border-lime-500/70"
                          />
                        </label>
                      ) : null}
                      {!editingId || form.resetPassword ? (
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-sm font-medium">{t("form.password")} *</label>
                            <div className="relative">
                              <input
                                type={showPassword ? "text" : "password"}
                                className={cn(inputClass, "pr-9")}
                                value={form.password ?? ""}
                                onChange={(e) =>
                                  setForm((f) => ({ ...f, password: e.target.value }))
                                }
                                autoComplete="new-password"
                              />
                              <button
                                type="button"
                                onClick={() => setShowPassword((prev) => !prev)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                aria-label={showPassword ? t("form.hidePassword") : t("form.showPassword")}
                              >
                                {showPassword ? (
                                  <EyeOff className="h-4 w-4" />
                                ) : (
                                  <Eye className="h-4 w-4" />
                                )}
                              </button>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-medium">{t("form.confirmPassword")} *</label>
                            <div className="relative">
                              <input
                                type={showPasswordConfirm ? "text" : "password"}
                                className={cn(inputClass, "pr-9")}
                                value={form.passwordConfirm ?? ""}
                                onChange={(e) =>
                                  setForm((f) => ({
                                    ...f,
                                    passwordConfirm: e.target.value,
                                  }))
                                }
                                autoComplete="new-password"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setShowPasswordConfirm((prev) => !prev)
                                }
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                aria-label={
                                  showPasswordConfirm
                                    ? t("form.hideConfirmPassword")
                                    : t("form.showConfirmPassword")
                                }
                              >
                                {showPasswordConfirm ? (
                                  <EyeOff className="h-4 w-4" />
                                ) : (
                                  <Eye className="h-4 w-4" />
                                )}
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : null}
                      {editingId ? (
                        <div className="space-y-2 rounded-lg border border-dashed border-border/90 bg-muted/25 p-3">
                          <p className="text-sm font-medium">{t("form.passwordResetEmail")}</p>
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {t("form.passwordResetEmailHint")}
                          </p>
                          <button
                            type="button"
                            className={cn(btnOutline, "w-full gap-2 sm:w-auto")}
                            disabled={resetEmailSending || !form.email.trim()}
                            onClick={() => void handleSendResetEmail()}
                          >
                            {resetEmailSending ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                {t("form.sending")}
                              </>
                            ) : (
                              <>
                                <Mail className="h-4 w-4" />
                                {t("form.sendResetEmail")}
                              </>
                            )}
                          </button>
                          {resetEmailFeedback ? (
                            <p
                              className={cn(
                                "text-xs leading-relaxed",
                                resetEmailFeedback.kind === "success"
                                  ? "text-emerald-700 dark:text-emerald-400"
                                  : "text-destructive",
                              )}
                            >
                              {resetEmailFeedback.message}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-3 border-t border-border bg-muted/10 px-6 py-4">
              {saveError ? (
                <p className="text-sm text-destructive">{saveError}</p>
              ) : null}
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  className={btnOutline}
                  onClick={closePeopleDialog}
                >
                  {tCommon("cancel")}
                </button>
                <button
                  type="button"
                  className={btnPrimary}
                  onClick={() => void handleSave()}
                  disabled={saving}
                >
                  {saving
                    ? t("saving")
                    : editingId
                      ? t("form.saveChanges")
                      : t("form.addPerson")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDeleteDialog
        open={deleteTarget != null}
        title={tCommon("confirmDeleteTitle")}
        message={tCommon("confirmDeleteMessage")}
        cancelLabel={tCommon("cancel")}
        confirmLabel={tCommon("delete")}
        deleting={deleting}
        deletingLabel={tCommon("deleting")}
        onCancel={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        onConfirm={() => {
          if (!deleteTarget || deleting) return;
          void (async () => {
            try {
              setDeleting(true);
              await deletePerson(deleteTarget.id);
              setDeleteTarget(null);
            } finally {
              setDeleting(false);
            }
          })();
        }}
        titleId="delete-person-title"
      />
    </>
  );
}

