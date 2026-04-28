import { getTranslations, setRequestLocale } from "next-intl/server";
import { PricingClient } from "./PricingClient";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function PricingPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  return (
    <section aria-labelledby="pr-title" className="space-y-6">
      <header className="space-y-1">
        <h2 id="pr-title" className="font-display text-2xl font-semibold">
          {t("pricing.title")}
        </h2>
        <p className="text-muted text-sm">{t("pricing.subtitle")}</p>
      </header>
      <PricingClient
        labels={{
          draft: t("pricing.draft"),
          review: t("pricing.review"),
          publish: t("pricing.publish"),
          diff: t("pricing.diff"),
        }}
      />
    </section>
  );
}
