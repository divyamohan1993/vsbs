import { getTranslations, setRequestLocale } from "next-intl/server";
import { MerkleClient } from "./MerkleClient";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function MerklePage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  return (
    <section aria-labelledby="mk-title" className="space-y-6">
      <header className="space-y-1">
        <h2 id="mk-title" className="font-display text-2xl font-semibold">
          {t("audit.merkle")}
        </h2>
        <p className="text-muted text-sm">{t("audit.rootsSubtitle")}</p>
      </header>
      <MerkleClient
        labels={{
          verify: t("audit.verify"),
          verified: t("audit.verified"),
          verifyFailed: t("audit.verifyFailed"),
        }}
      />
    </section>
  );
}
