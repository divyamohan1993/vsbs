import { getTranslations, setRequestLocale } from "next-intl/server";
import { GrantDetailClient } from "./GrantDetailClient";

interface PageProps {
  params: Promise<{ locale: string; grantId: string }>;
}

export default async function GrantDetailPage({ params }: PageProps) {
  const { locale, grantId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  return (
    <section aria-labelledby="grant-title" className="space-y-6">
      <header className="space-y-1">
        <h2 id="grant-title" className="font-display text-2xl font-semibold">
          {t("audit.title")}
        </h2>
        <p className="text-muted text-sm">{t("audit.subtitle")}</p>
      </header>
      <GrantDetailClient
        grantId={grantId}
        labels={{
          verify: t("audit.verify"),
          verifying: t("audit.verifying"),
          verified: t("audit.verified"),
          verifyFailed: t("audit.verifyFailed"),
        }}
      />
    </section>
  );
}
