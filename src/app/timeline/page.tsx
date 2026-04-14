"use client";

import { useState } from "react";

import RequireAuth from "@/features/auth/RequireAuth";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import { TimelineWorkspace } from "@/widgets/timeline/TimelineWorkspace";

export default function TimelinePage() {
  const [hideAppNav, setHideAppNav] = useState(false);

  return (
    <RequireAuth>
      <DashboardLayout hideAppNav={hideAppNav}>
        <TimelineWorkspace
          immersiveMode={hideAppNav}
          onImmersiveModeChange={setHideAppNav}
        />
      </DashboardLayout>
    </RequireAuth>
  );
}
