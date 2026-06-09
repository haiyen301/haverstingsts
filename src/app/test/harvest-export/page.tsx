import { Suspense } from "react";

import { HarvestExportDemoClient } from "./harvest-export-demo-client";

export const metadata = {
  title: "Harvest Export Demo | STS Portal",
  description:
    "Public demo of Harvest list export with sample data, filters, CSV, Excel, and Google Sheet.",
};

export default function HarvestExportDemoPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading…</div>}>
      <HarvestExportDemoClient />
    </Suspense>
  );
}
