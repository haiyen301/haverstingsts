"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Pencil, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  countryDisplayName,
  fetchAdminCountries,
  isCountryActive,
  saveAdminCountry,
  type CountryRow,
} from "@/features/admin/api/countriesApi";
import { ActiveStatusSwitch } from "@/features/admin/ui/ActiveStatusSwitch";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { useModuleAccess } from "@/shared/auth/useModuleAccess";

const inputClass =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-50";

const btnGhost =
  "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";

const btnConfirm =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-lime-500 text-white shadow-sm transition-colors hover:bg-lime-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400 disabled:pointer-events-none disabled:opacity-50";

const btnDismiss =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-input bg-background text-muted-foreground shadow-sm transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

function cellText(value: string | null | undefined): string {
  const s = String(value ?? "").trim();
  return s || "—";
}

function EditableColumnLabel({ label, hint }: { label: string; hint: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {label}
      <span
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-lime-500"
        title={hint}
        aria-label={hint}
      />
    </span>
  );
}

export function CountriesCatalogTab() {
  const t = useTranslations("AdminCountries");
  const { canEdit } = useModuleAccess("admin_countries");
  const [rows, setRows] = useState<CountryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [pendingId, setPendingId] = useState<number | null>(null);
  const fetchAllHarvestingReferenceData = useHarvestingDataStore(
    (s) => s.fetchAllHarvestingReferenceData,
  );

  const editableHint = t("editableHint");

  const load = useCallback(async () => {
    const data = await fetchAdminCountries();
    setRows(data);
  }, []);

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const hay = [
        row.country_code,
        row.name,
        row.country_name,
        row.iso_3166_1_alpha_2,
        row.iso_3166_1_alpha_3,
        row.sovereignty,
        row.tld,
      ]
        .map((v) => String(v ?? "").toLowerCase())
        .join(" ");
      return hay.includes(q);
    });
  }, [rows, search]);

  const beginEditName = (row: CountryRow) => {
    if (pendingId !== null) return;
    setEditingId(Number(row.id));
    setEditName(countryDisplayName(row));
    setError(null);
  };

  const cancelEditName = () => {
    setEditingId(null);
    setEditName("");
  };

  const commitEditName = async (row: CountryRow) => {
    const id = Number(row.id);
    const name = editName.trim();
    if (!name) {
      setError(t("errors.nameRequired"));
      return;
    }
    if (name === countryDisplayName(row)) {
      cancelEditName();
      return;
    }
    try {
      setPendingId(id);
      setError(null);
      await saveAdminCountry({ id, name });
      cancelEditName();
      await load();
      void fetchAllHarvestingReferenceData(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.save"));
    } finally {
      setPendingId(null);
    }
  };

  const toggleActive = async (row: CountryRow) => {
    const id = Number(row.id);
    const nextActive = !isCountryActive(row);
    try {
      setPendingId(id);
      setError(null);
      await saveAdminCountry({ id, active: nextActive });
      await load();
      void fetchAllHarvestingReferenceData(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.save"));
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="space-y-6 p-4 text-foreground lg:p-8">
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground lg:text-3xl">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {!loading ? (
        <>
          <Card>
            <CardContent className="p-4">
              <div className="relative">
                <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
                <input
                  className={cn(inputClass, "pl-9")}
                  placeholder={t("searchPlaceholder")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {t("rowCount", { count: filtered.length, total: rows.length })}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] caption-bottom text-sm">
                  <thead className="border-b border-border [&_tr]:border-b">
                    <tr className="border-b border-border transition-colors">
                      <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                        {t("columns.code")}
                      </th>
                      <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                        <EditableColumnLabel label={t("columns.name")} hint={editableHint} />
                      </th>
                      <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                        {t("columns.sovereignty")}
                      </th>
                      <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                        {t("columns.alpha2")}
                      </th>
                      <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                        {t("columns.alpha3")}
                      </th>
                      <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                        {t("columns.numeric")}
                      </th>
                      <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                        {t("columns.iso3166_2")}
                      </th>
                      <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                        {t("columns.tld")}
                      </th>
                      <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                        {t("columns.status")}
                      </th>
                      <th className="h-10 px-4 text-right align-middle font-medium text-muted-foreground">
                        {t("columns.actions")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="[&_tr:last-child]:border-0">
                    {filtered.length === 0 ? (
                      <tr>
                        <td
                          colSpan={10}
                          className="p-2 px-4 py-8 text-center align-middle text-muted-foreground"
                        >
                          {t("empty")}
                        </td>
                      </tr>
                    ) : (
                      filtered.map((row) => {
                        const id = Number(row.id);
                        const isEditing = editingId === id;
                        const isPending = pendingId === id;
                        const active = isCountryActive(row);
                        const displayName = countryDisplayName(row);

                        return (
                          <tr
                            key={id}
                            className="border-b border-border transition-colors hover:bg-muted/40"
                          >
                            <td className="p-2 px-4 align-middle font-mono text-xs font-semibold uppercase">
                              {cellText(row.country_code ?? row.iso_3166_1_alpha_2)}
                            </td>
                            <td className="p-2 px-4 align-middle">
                              {isEditing ? (
                                <div className="flex min-w-56 items-center gap-1.5">
                                  <input
                                    className={cn(inputClass, "h-8 min-w-0 flex-1")}
                                    value={editName}
                                    autoFocus
                                    disabled={isPending}
                                    onChange={(e) => setEditName(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") void commitEditName(row);
                                      if (e.key === "Escape") cancelEditName();
                                    }}
                                  />
                                  <button
                                    type="button"
                                    className={btnConfirm}
                                    disabled={isPending || !editName.trim()}
                                    title={t("confirmEdit")}
                                    aria-label={t("confirmEdit")}
                                    onClick={() => void commitEditName(row)}
                                  >
                                    <Check className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    className={btnDismiss}
                                    disabled={isPending}
                                    title={t("cancelEdit")}
                                    aria-label={t("cancelEdit")}
                                    onClick={cancelEditName}
                                  >
                                    <X className="h-4 w-4" />
                                  </button>
                                </div>
                              ) : canEdit ? (
                                <button
                                  type="button"
                                  className="group inline-flex max-w-full items-center gap-1.5 text-left text-sm font-medium text-foreground"
                                  disabled={isPending || editingId !== null}
                                  title={editableHint}
                                  onClick={() => beginEditName(row)}
                                >
                                  <span
                                    className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-lime-500 opacity-80 group-hover:opacity-100"
                                    aria-hidden
                                  />
                                  <span className="truncate group-hover:underline">
                                    {displayName}
                                  </span>
                                </button>
                              ) : (
                                <span className="text-sm font-medium">{displayName}</span>
                              )}
                            </td>
                            <td className="p-2 px-4 align-middle text-sm text-muted-foreground">
                              {cellText(row.sovereignty)}
                            </td>
                            <td className="p-2 px-4 align-middle font-mono text-xs text-muted-foreground">
                              {cellText(row.iso_3166_1_alpha_2 ?? row.country_code)}
                            </td>
                            <td className="p-2 px-4 align-middle font-mono text-xs text-muted-foreground">
                              {cellText(row.iso_3166_1_alpha_3)}
                            </td>
                            <td className="p-2 px-4 align-middle font-mono text-xs text-muted-foreground">
                              {cellText(row.iso_3166_1_numeric)}
                            </td>
                            <td className="p-2 px-4 align-middle text-xs text-muted-foreground">
                              {cellText(row.iso_3166_2_link)}
                            </td>
                            <td className="p-2 px-4 align-middle font-mono text-xs text-muted-foreground">
                              {cellText(row.tld)}
                            </td>
                            <td className="p-2 px-4 align-middle">
                              <ActiveStatusSwitch
                                checked={active}
                                pending={isPending}
                                disabled={!canEdit || isPending || isEditing}
                                onCheckedChange={() => void toggleActive(row)}
                                activeLabel={t("status.active")}
                                inactiveLabel={t("status.inactive")}
                              />
                            </td>
                            <td className="p-2 px-4 text-right align-middle">
                              {canEdit && !isEditing ? (
                                <button
                                  type="button"
                                  className={btnGhost}
                                  disabled={isPending || editingId !== null}
                                  title={editableHint}
                                  aria-label={editableHint}
                                  onClick={() => beginEditName(row)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
