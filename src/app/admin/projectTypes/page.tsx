"use client";

import { useEffect, useState } from "react";
import RequireAuth from "@/features/auth/RequireAuth";
import { fetchProjectSettings, type ProjectSettingRow } from "@/features/admin/api/adminApi";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function AdminProjectTypesPage() {
  const [rows, setRows] = useState<ProjectSettingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchProjectSettings();
        if (!mounted) return;
        setRows(data.filter((x) => String(x.setting_key ?? "").trim() !== "architects"));
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : "Failed to load project settings.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="p-4 lg:p-8">
          <h1 className="text-2xl font-semibold text-gray-900 lg:text-3xl">Projects</h1>
          <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
            {loading ? <p className="p-4 text-sm text-gray-500">Loading project settings...</p> : null}
            {error ? <p className="p-4 text-sm text-red-600">{error}</p> : null}
            {!loading && !error ? (
              rows.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-left text-gray-700">
                      <tr>
                        <th className="px-4 py-2">Setting Key</th>
                        <th className="px-4 py-2">Label</th>
                        <th className="px-4 py-2">Route</th>
                        <th className="px-4 py-2">Sort</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id} className="border-t border-gray-100">
                          <td className="px-4 py-2">{row.setting_key}</td>
                          <td className="px-4 py-2">{row.label}</td>
                          <td className="px-4 py-2">{row.route}</td>
                          <td className="px-4 py-2">{row.sort_order}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="p-4 text-sm text-gray-600">No project settings found.</p>
              )
            ) : null}
          </div>
        </div>
      </DashboardLayout>
    </RequireAuth>
  );
}
