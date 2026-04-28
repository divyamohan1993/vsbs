import { getTranslations, setRequestLocale } from "next-intl/server";
import { FairnessClient } from "./FairnessClient";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function FairnessPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  return (
    <section aria-labelledby="fr-title" className="space-y-6">
      <header className="space-y-1">
        <h2 id="fr-title" className="font-display text-2xl font-semibold">
          {t("fairness.title")}
        </h2>
        <p className="text-muted text-sm">{t("fairness.subtitle")}</p>
      </header>
      <FairnessClient
        labels={{
          byCohort: t("fairness.byCohort"),
          waitDist: t("fairness.waitDist"),
          complaintRate: t("fairness.complaintRate"),
        }}
      />
    </section>
  );
}
