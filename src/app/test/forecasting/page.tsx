import { notFound } from "next/navigation";

import { DevForecastingAvailableSourceClient } from "./available-source-client";

export default function DevForecastingPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  return <DevForecastingAvailableSourceClient />;
}
