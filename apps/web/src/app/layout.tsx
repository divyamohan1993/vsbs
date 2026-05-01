import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { Cormorant_Garamond, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { TelemetryBoot } from "../lib/telemetry-boot";
import { AppBoot } from "../components/AppBoot";
import { AuroraGradient, SiteHeader, SiteFooter, GoldSeal } from "../components/luxe";

const sans = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
  weight: ["300", "400", "500", "600", "700"],
});

const display = Cormorant_Garamond({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
  weight: ["400", "500", "600"],
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "VSBS. Autonomous Vehicle Service.",
  description: "Your vehicle. Served. Autonomously, audited, and on your schedule.",
  robots: { index: true, follow: true },
  // Icon is auto-discovered from app/icon.tsx (next/og ImageResponse).
  // Browsers also fire a default GET /favicon.ico on first paint; that probe
  // is satisfied by the ico file shipped at app/favicon.ico.
};

export const viewport: Viewport = {
  themeColor: "#08090C",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

function isDemoMode(): boolean {
  return process.env.APP_DEMO_MODE !== "false";
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const t = await getTranslations();
  const demo = isDemoMode();
  const region = process.env.APP_REGION ?? "asia-south1";
  const otlp = process.env.NEXT_PUBLIC_OTLP_BROWSER_URL;
  return (
    <html lang={locale} className={`${sans.variable} ${display.variable} ${mono.variable}`}>
      <body className="min-h-dvh bg-obsidian text-pearl antialiased">
        <AuroraGradient />
        <TelemetryBoot region={region} version="0.1.0" {...(otlp ? { exporterUrl: otlp } : {})} />
        <AppBoot />
        <NextIntlClientProvider locale={locale} messages={messages}>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:left-6 focus:top-6 focus:z-50 focus:rounded-[var(--radius-sm)] focus:bg-pearl focus:px-4 focus:py-2 focus:text-obsidian"
          >
            {t("a11y.skipToContent")}
          </a>
          <SiteHeader
            demo={demo}
            locale={locale}
            labels={{
              book: t("home.bookCta"),
              autonomy: t("home.cards.transparent.title"),
              consent: t("home.quickLinks.consent.title"),
              help: t("home.quickLinks.help.title"),
              demoPill: "Demo",
            }}
          />
          {demo ? (
            <aside
              role="status"
              aria-live="polite"
              className="luxe-glass-muted mx-auto mt-6 flex max-w-[1180px] items-center justify-center gap-3 rounded-[var(--radius-md)] border-l-2 border-[var(--color-copper)] px-5 py-3 text-[length:var(--text-control)] text-pearl-muted"
            >
              <GoldSeal label="demo" size={16} />
              <span>{t("demo.banner")}</span>
            </aside>
          ) : null}
          <main id="main" className="mx-auto w-full max-w-[1440px] px-6 py-10 md:px-10 md:py-14">
            {children}
          </main>
          <SiteFooter
            labels={{
              safety: t("home.quickLinks.help.title"),
              repo: "GitHub",
              privacy: t("home.quickLinks.consent.title"),
              region: "Region",
            }}
          />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
