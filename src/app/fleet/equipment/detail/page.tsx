"use client";

import { useSearchParams } from "next/navigation";

import RequireAuth from "@/features/auth/RequireAuth";
import { EquipmentDetailTab } from "@/features/fleet/EquipmentDetailTab";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

export default function EquipmentDetailPage() {
  const searchParams = useSearchParams();
  const id = Number(searchParams.get("id") ?? "");
  const returnTo = searchParams.get("returnTo")?.trim() || "/fleet/equipment";

  return (
    <RequireAuth>
      <DashboardLayout>
        {Number.isFinite(id) && id > 0 ? (
          <EquipmentDetailTab equipmentId={id} returnTo={returnTo} />
        ) : (
          <p className="p-8 text-sm text-muted-foreground">Invalid equipment id.</p>
        )}
      </DashboardLayout>
    </RequireAuth>
  );
}
