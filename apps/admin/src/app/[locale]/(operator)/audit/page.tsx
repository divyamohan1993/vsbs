import { getTranslations, setRequestLocale } from "next-intl/server";
import { AuditListClient } from "./AuditListClient";
import Link from "next/link";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AuditPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  return (
    <section aria-labelledby="audit-title" className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 id="audit-title" className="font-display text-2xl font-semibold">
            {t("audit.title")}
          </h2>
          <p className="text-muted text-sm">{t("audit.subtitle")}</p>
        </div>
        <Link
          href={`/${locale}/audit/merkle` as never}
          className="rounded-md bg-surface-3 px-4 py-2 text-sm font-semibold"
        >
          {t("audit.merkle")}
        </Link>
      </header>
      <AuditListClient
        locale={locale}
        labels={{
          search: t("audit.search"),
        }}
      />
    </section>
  );
}
