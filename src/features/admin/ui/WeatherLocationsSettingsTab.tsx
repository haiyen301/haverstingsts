"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CloudRain, MapPin, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";

import { fetchFarms, type FarmRow } from "@/features/admin/api/adminApi";
import {
  fetchWeatherLocations,
  geocodeWeatherLocation,
  saveWeatherLocation,
  verifyWeatherLocation,
  type WeatherLocationRow,
} from "@/features/admin/api/weatherLocationsApi";
import { ActiveStatusSwitch } from "@/features/admin/ui/ActiveStatusSwitch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";

const inputClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";

function emptyRow(): WeatherLocationRow {
  return {
    location_id: "",
    label: "",
    country_code: "",
    latitude: 0,
    longitude: 0,
    timezone: "auto",
    is_active: 1,
    sort_order: 0,
    farm_id: null,
  };
}

export function WeatherLocationsSettingsTab() {
  const t = useTranslations("AdminWeatherLocations");
  const [rows, setRows] = useState<WeatherLocationRow[]>([]);
  const [farmOptions, setFarmOptions] = useState<FarmRow[]>([]);
  const [form, setForm] = useState<WeatherLocationRow>(emptyRow());
  const [isCreating, setIsCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [geocodeName, setGeocodeName] = useState("");
  const didPickInitialForm = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, farms] = await Promise.all([
        fetchWeatherLocations(),
        fetchFarms().catch(() => [] as FarmRow[]),
      ]);
      setRows(data);
      setFarmOptions(farms);
      if (!didPickInitialForm.current && data.length > 0) {
        didPickInitialForm.current = true;
        setForm(data[0]!);
        setIsCreating(false);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.load"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const assignedFarmIds = useMemo(() => {
    const ids = new Set<number>();
    for (const row of rows) {
      if (!row.farm_id || row.location_id === form.location_id) continue;
      ids.add(Number(row.farm_id));
    }
    return ids;
  }, [rows, form.location_id]);

  const persist = async () => {
    const locationId = form.location_id.trim();
    const label = form.label.trim();
    const latitude = Number(form.latitude);
    const longitude = Number(form.longitude);
    if (!locationId || !label) {
      toast.error(t("errors.requiredFields"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      return;
    }
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || (latitude === 0 && longitude === 0)) {
      toast.error(t("errors.coordinatesRequired"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      return;
    }
    try {
      setSaving(true);
      const saved = await saveWeatherLocation({
        ...form,
        location_id: locationId,
        label,
        latitude,
        longitude,
        farm_id: form.farm_id ? Number(form.farm_id) : null,
        is_active: form.is_active ? 1 : 0,
      });
      toast.success(t("saved"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      setForm(saved);
      setIsCreating(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.save"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    } finally {
      setSaving(false);
    }
  };

  const verify = async () => {
    try {
      setSaving(true);
      const result = await verifyWeatherLocation({
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
        timezone: form.timezone || "auto",
      });
      setForm((prev) => ({ ...prev, timezone: result.timezone || prev.timezone }));
      toast.success(`${t("verified")} ${result.rainfall_mm} mm`, {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.verify"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    } finally {
      setSaving(false);
    }
  };

  const geocode = async () => {
    if (!geocodeName.trim()) return;
    try {
      setSaving(true);
      const result = await geocodeWeatherLocation(geocodeName.trim(), form.country_code ?? undefined);
      setForm((prev) => ({
        ...prev,
        latitude: result.latitude,
        longitude: result.longitude,
        timezone: result.timezone || prev.timezone,
      }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.geocode"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <CloudRain className="h-6 w-6 text-info" />
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("locationsTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <p className="text-sm text-muted-foreground">{t("loading")}</p>
            ) : (
              rows.map((row) => (
                <button
                  key={row.location_id}
                  type="button"
                  onClick={() => {
                    setIsCreating(false);
                    setForm(row);
                  }}
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                    !isCreating && form.location_id === row.location_id
                      ? "border-primary bg-primary/5"
                      : "border-border"
                  }`}
                >
                  <div className="font-medium">{row.label}</div>
                  <div className="text-xs text-muted-foreground">{row.location_id}</div>
                  {row.farm_name ? (
                    <div className="mt-0.5 text-xs text-info">{row.farm_name}</div>
                  ) : (
                    <div className="mt-0.5 text-xs text-muted-foreground">{t("noFarmLinked")}</div>
                  )}
                </button>
              ))
            )}
            <button
              type="button"
              className={`inline-flex h-9 w-full items-center gap-2 rounded-md border px-3 text-sm ${
                isCreating ? "border-primary bg-primary/5" : "border-input"
              }`}
              onClick={() => {
                setIsCreating(true);
                setForm(emptyRow());
                setGeocodeName("");
              }}
            >
              <Plus className="h-4 w-4" />
              {t("add")}
            </button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="h-4 w-4" />
              {isCreating ? t("add") : form.label || t("add")}
            </CardTitle>
            <CardDescription>{t("forecastPoint")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span>{t("locationId")}</span>
                <input className={inputClass} value={form.location_id} onChange={(e) => setForm({ ...form, location_id: e.target.value })} />
              </label>
              <label className="space-y-1 text-sm">
                <span>{t("label")}</span>
                <input className={inputClass} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
              </label>
              <label className="space-y-1 text-sm sm:col-span-2">
                <span>{t("farm")}</span>
                <select
                  className={inputClass}
                  value={form.farm_id ?? ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      farm_id: e.target.value ? Number(e.target.value) : null,
                      farm_name:
                        farmOptions.find((f) => String(f.id) === e.target.value)?.name ?? null,
                    })
                  }
                >
                  <option value="">{t("farmPlaceholder")}</option>
                  {farmOptions.map((farm) => {
                    const farmId = Number(farm.id);
                    const taken = assignedFarmIds.has(farmId);
                    return (
                      <option key={farm.id} value={farm.id} disabled={taken}>
                        {farm.name}
                        {taken ? ` (${t("farmTaken")})` : ""}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span>{t("countryCode")}</span>
                <input className={inputClass} value={form.country_code ?? ""} onChange={(e) => setForm({ ...form, country_code: e.target.value })} />
              </label>
              <label className="space-y-1 text-sm">
                <span>{t("timezone")}</span>
                <input className={inputClass} value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
              </label>
              <label className="space-y-1 text-sm">
                <span>{t("latitude")}</span>
                <input className={inputClass} type="number" step="any" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} />
              </label>
              <label className="space-y-1 text-sm">
                <span>{t("longitude")}</span>
                <input className={inputClass} type="number" step="any" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <ActiveStatusSwitch
                checked={Boolean(form.is_active)}
                onCheckedChange={(checked) => setForm({ ...form, is_active: checked ? 1 : 0 })}
                label={t("active")}
              />
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <input
                className={inputClass}
                placeholder={t("geocodePlaceholder")}
                value={geocodeName}
                onChange={(e) => setGeocodeName(e.target.value)}
              />
              <button type="button" className="h-9 rounded-md border px-3 text-sm" disabled={saving} onClick={() => void geocode()}>
                {t("geocode")}
              </button>
              <button type="button" className="h-9 rounded-md border px-3 text-sm" disabled={saving} onClick={() => void verify()}>
                {t("verify")}
              </button>
              <button type="button" className="h-9 rounded-md bg-primary px-4 text-sm text-primary-foreground" disabled={saving} onClick={() => void persist()}>
                {t("save")}
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
