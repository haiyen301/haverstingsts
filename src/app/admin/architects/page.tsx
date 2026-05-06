"use client";

import { useEffect, useState } from "react";
import RequireAuth from "@/features/auth/RequireAuth";
import { fetchArchitects, type ArchitectRow } from "@/features/admin/api/adminApi";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function AdminArchitectsPage() {
  const [rows, setRows] = useState<ArchitectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchArchitects();
        if (!mounted) return;
        setRows(data);
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : "Failed to load architects.");
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
          <h1 className="text-2xl font-semibold text-gray-900 lg:text-3xl">Architects</h1>
          <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
            {loading ? <p className="p-4 text-sm text-gray-500">Loading architects...</p> : null}
            {error ? <p className="p-4 text-sm text-red-600">{error}</p> : null}
            {!loading && !error ? (
              rows.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-left text-gray-700">
                      <tr>
                        <th className="px-4 py-2">Name</th>
                        <th className="px-4 py-2">Email</th>
                        <th className="px-4 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, idx) => {
                        const name =
                          `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() ||
                          row.name ||
                          `Architect ${idx + 1}`;
                        return (
                          <tr key={`${row.id ?? idx}`} className="border-t border-gray-100">
                            <td className="px-4 py-2">{name}</td>
                            <td className="px-4 py-2">{row.email ?? "-"}</td>
                            <td className="px-4 py-2">{row.status ?? "-"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="p-4 text-sm text-gray-600">No staff data found.</p>
              )
            ) : null}
          </div>
        </div>
      </DashboardLayout>
    </RequireAuth>
  );
}
