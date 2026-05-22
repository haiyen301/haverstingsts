import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { ThemeProvider } from "@/shared/theme/ThemeProvider";
import { AppToasts } from "@/shared/ui/AppToasts";
import { MaintenanceGate } from "@/widgets/system/MaintenanceGate";
import { TestServerBanner } from "@/widgets/system/TestServerBanner";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "STS Portal",
  description: "STS Portal",
  icons: {
    icon: [
      {
        url: "/assets/images/_file68f0b5eb3bdef-favicon.png",
        type: "image/png",
      },
    ],
    shortcut: "/assets/images/_file68f0b5eb3bdef-favicon.png",
    apple: "/assets/images/_file68f0b5eb3bdef-favicon.png",
  },
};


export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  const themeBootScript = `(function(){try{var k='stsrenew-theme';var t=localStorage.getItem(k);var d=t!=='light';if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

  return (
    <html
      lang={locale}
      className={`${plusJakartaSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body
        className="flex min-h-full flex-col bg-background text-foreground"
        suppressHydrationWarning={true}
      >
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider>
            <TestServerBanner />
            <Suspense fallback={null}>
              <MaintenanceGate />
            </Suspense>
            {children}
            <AppToasts />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
