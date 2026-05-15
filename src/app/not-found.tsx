import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ShieldAlert } from "lucide-react";

export default async function NotFoundPage() {
  const t = await getTranslations("NotFound");

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <p className="mb-1 text-sm font-medium text-muted-foreground">{t("code")}</p>
        <h1 className="mb-3 text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mb-6 text-sm text-muted-foreground">{t("description")}</p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/dashboard"
            className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            {t("goDashboard")}
          </Link>
          <Link
            href="/"
            className="inline-flex h-9 items-center justify-center rounded-md border border-input px-4 text-sm font-medium hover:bg-muted/70"
          >
            {t("backLogin")}
          </Link>
        </div>
      </div>
    </main>
  );
}
