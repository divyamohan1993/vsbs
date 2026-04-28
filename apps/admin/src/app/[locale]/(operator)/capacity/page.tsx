import { getTranslations, setRequestLocale } from "next-intl/server";
import { CapacityClient } from "./CapacityClient";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function CapacityPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  return (
    <section aria-labelledby="cap-title" className="space-y-6">
      <header className="space-y-1">
        <h2 id="cap-title" className="font-display text-2xl font-semibold">
          {t("capacity.title")}
        </h2>
        <p className="text-muted text-sm">{t("capacity.subtitle")}</p>
      </header>
      <CapacityClient
        labels={{
          selectSc: t("capacity.selectSc"),
          scaleLabel: t("capacity.scaleLabel"),
          low: t("capacity.low"),
          medium: t("capacity.medium"),
          high: t("capacity.high"),
        }}
      />
    </section>
  );
}
