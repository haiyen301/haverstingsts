import { Suspense } from "react";

import { HarvestExportDemoClient } from "./harvest-export-demo-client";
import { HARVEST_EXPORT_DEMO_OAUTH_APP_NAME } from "./constants";

export const metadata = {
  title: HARVEST_EXPORT_DEMO_OAUTH_APP_NAME,
  description:
    "Sports Turf Solutions Export — harvest list export demo with sample data, filters, CSV, Excel, and Google Sheet.",
  openGraph: {
    title: HARVEST_EXPORT_DEMO_OAUTH_APP_NAME,
  },
};

export default function HarvestExportDemoPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading…</div>}>
      <HarvestExportDemoClient />
    </Suspense>
  );
}
