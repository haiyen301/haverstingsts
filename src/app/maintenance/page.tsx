"use client";

import { Suspense } from "react";

import { MaintenanceScreen } from "@/features/system/ui/MaintenanceScreen";

export default function MaintenancePage() {
  return (
    <Suspense fallback={null}>
      <MaintenanceScreen />
    </Suspense>
  );
}
