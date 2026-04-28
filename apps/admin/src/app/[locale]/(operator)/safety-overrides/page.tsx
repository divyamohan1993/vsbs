import { getTranslations, setRequestLocale } from "next-intl/server";
import { SafetyOverridesClient } from "./SafetyOverridesClient";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function SafetyOverridesPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  return (
    <section aria-labelledby="so-title" className="space-y-6">
      <header className="space-y-1">
        <h2 id="so-title" className="font-display text-2xl font-semibold">
          {t("safetyOverrides.title")}
        </h2>
        <p className="text-muted text-sm">{t("safetyOverrides.subtitle")}</p>
      </header>
      <SafetyOverridesClient
        labels={{
          actor: t("safetyOverrides.actor"),
          kind: t("safetyOverrides.kind"),
          decision: t("safetyOverrides.decision"),
          rationale: t("safetyOverrides.rationale"),
        }}
      />
    </section>
  );
}
