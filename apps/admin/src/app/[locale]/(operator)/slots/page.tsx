import { getTranslations, setRequestLocale } from "next-intl/server";
import { SlotsClient } from "./SlotsClient";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function SlotsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  return (
    <section aria-labelledby="sl-title" className="space-y-6">
      <header className="space-y-1">
        <h2 id="sl-title" className="font-display text-2xl font-semibold">
          {t("slots.title")}
        </h2>
        <p className="text-muted text-sm">{t("slots.subtitle")}</p>
      </header>
      <SlotsClient
        labels={{
          create: t("slots.create"),
          save: t("slots.save"),
          delete: t("slots.delete"),
        }}
      />
    </section>
  );
}
