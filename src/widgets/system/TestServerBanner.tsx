import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

import { shouldShowTestServerBanner } from "@/shared/config/deploymentEnvironment";

export async function TestServerBanner() {
  const headerList = await headers();
  const host =
    headerList.get("x-forwarded-host") ??
    headerList.get("host") ??
    "";

  if (!shouldShowTestServerBanner(host)) {
    return null;
  }

  const t = await getTranslations("DeploymentBanner");

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-50 w-full bg-red-600 px-4 py-2 text-center text-sm font-semibold tracking-wide text-white shadow-sm"
    >
      {t("testServerMessage")}
    </div>
  );
}
