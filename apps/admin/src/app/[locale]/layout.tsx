import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { OperatorNav } from "@/components/OperatorNav";

const SUPPORTED = new Set<string>(["en", "hi"]);

export function generateStaticParams() {
  return [{ locale: "en" }, { locale: "hi" }];
}

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

function isDemoMode(): boolean {
  return process.env.APP_DEMO_MODE !== "false";
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;
  if (!SUPPORTED.has(locale)) notFound();
  setRequestLocale(locale);
  const messages = await getMessages({ locale });
  const t = await getTranslations({ locale });
  const demo = isDemoMode();

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <a href="#main" className="sr-only focus:not-sr-only">
        {t("a11y.skipToContent")}
      </a>
      <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[16rem_1fr]">
        <OperatorNav locale={locale} />
        <div className="flex min-w-0 flex-col">
          <header className="border-b border-[var(--color-border)] bg-surface-2 px-6 py-4">
            <h1 className="font-display text-xl font-semibold">{t("app.name")}</h1>
            <p className="text-muted text-sm">{t("app.tagline")}</p>
          </header>
          <main
            id="main"
            aria-label={t("a11y.mainLandmark")}
            className="min-w-0 flex-1 overflow-x-auto px-6 py-6"
          >
            {demo ? (
              <aside
                role="status"
                aria-live="polite"
                className="mb-6 rounded-[var(--radius-card)] border-2 border-accent bg-accent px-4 py-3 text-sm font-semibold text-accent-on"
              >
                {t("demo.banner")}
              </aside>
            ) : null}
            {children}
          </main>
        </div>
      </div>
    </NextIntlClientProvider>
  );
}
