import { notFound } from "next/navigation";

import { DevImportTestClient } from "./test-client";

export default function DevImportTestPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  return <DevImportTestClient />;
}

