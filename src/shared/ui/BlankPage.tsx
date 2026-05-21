import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

type BlankPageProps = {
  title?: string;
  subtitle?: string;
};

export function BlankPage({ title, subtitle }: BlankPageProps) {
  return (
    <DashboardLayout>
      <main className="min-h-[calc(100vh-3.5rem)] p-4 lg:p-8">
        {title ? (
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight lg:text-3xl">
              {title}
            </h1>
            {subtitle ? (
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
        ) : null}
      </main>
    </DashboardLayout>
  );
}

export default BlankPage;
