"use client";

import RequireAuth from "@/features/auth/RequireAuth";
import { CountriesCatalogTab } from "@/features/admin/ui/CountriesCatalogTab";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function AdminCountriesPage() {
  return (
    <RequireAuth>
      <DashboardLayout>
        <CountriesCatalogTab />
      </DashboardLayout>
    </RequireAuth>
  );
}
