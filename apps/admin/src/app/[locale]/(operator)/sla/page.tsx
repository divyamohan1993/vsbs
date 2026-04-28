import { getTranslations, setRequestLocale } from "next-intl/server";
import { SlaClient } from "./SlaClient";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function SlaPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  return (
    <section aria-labelledby="sla-title" className="space-y-6">
      <header className="space-y-1">
        <h2 id="sla-title" className="font-display text-2xl font-semibold">
          {t("sla.title")}
        </h2>
        <p className="text-muted text-sm">{t("sla.subtitle")}</p>
      </header>
      <SlaClient
        labels={{
          response: t("sla.responseMinutes"),
          resolution: t("sla.resolutionMinutes"),
          escalation: t("sla.escalation"),
          save: t("sla.save"),
        }}
      />
    </section>
  );
}
