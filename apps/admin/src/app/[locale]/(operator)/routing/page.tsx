import { getTranslations, setRequestLocale } from "next-intl/server";
import { RoutingClient } from "./RoutingClient";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function RoutingPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  return (
    <section aria-labelledby="rt-title" className="space-y-6">
      <header className="space-y-1">
        <h2 id="rt-title" className="font-display text-2xl font-semibold">
          {t("routing.title")}
        </h2>
        <p className="text-muted text-sm">{t("routing.subtitle")}</p>
      </header>
      <RoutingClient
        labels={{
          rerun: t("routing.rerun"),
          currentEta: t("routing.currentEta"),
          newEta: t("routing.newEta"),
          override: t("routing.override"),
          submit: t("routing.submit"),
        }}
      />
    </section>
  );
}
