import { notFound } from "next/navigation";

import { DevForecastingFormulaClient } from "../formula-explainer-client";

export default function DevForecastingFormulaPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  return <DevForecastingFormulaClient />;
}
