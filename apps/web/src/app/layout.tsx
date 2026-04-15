import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "VSBS — Autonomous Vehicle Service",
  description: "Zero-touch, safety-first, explainable vehicle service booking.",
  robots: { index: true, follow: true },
  icons: { icon: "/favicon.ico" },
};

export const viewport: Viewport = {
  themeColor: "#0b0f1a",
  colorScheme: "dark light",
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
  return (
    <html lang={locale}>
      <body className="min-h-dvh bg-surface text-on-surface antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <a href="#main" className="sr-only focus:not-sr-only">
            {t("a11y.skipToContent")}
          </a>
          <main id="main" className="mx-auto w-full max-w-6xl px-4 py-8">
            {demo ? (
              <aside
                role="status"
                aria-live="polite"
                className="mb-6 rounded-[var(--radius-card)] border-2 border-accent bg-accent px-4 py-3 text-base font-semibold text-accent-on"
              >
                {t("demo.banner")}
              </aside>
            ) : null}
            {children}
          </main>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
