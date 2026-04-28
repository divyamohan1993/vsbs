import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";

interface PageProps {
  params: Promise<{ locale: string }>;
}

const TILES: Array<{ key: string; href: `/${string}` }> = [
  { key: "bookings", href: "/bookings" },
  { key: "capacity", href: "/capacity" },
  { key: "routing", href: "/routing" },
  { key: "slots", href: "/slots" },
  { key: "fairness", href: "/fairness" },
  { key: "safetyOverrides", href: "/safety-overrides" },
  { key: "pricing", href: "/pricing" },
  { key: "sla", href: "/sla" },
  { key: "audit", href: "/audit" },
];

export default async function HomePage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  return (
    <section aria-labelledby="home-title" className="space-y-8">
      <header className="space-y-2">
        <h2 id="home-title" className="font-display text-3xl font-semibold">
          {t("home.title")}
        </h2>
        <p className="text-muted max-w-3xl text-base">{t("home.intro")}</p>
      </header>
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {TILES.map((tile) => (
          <li key={tile.key}>
            <Link
              href={`/${locale}${tile.href}` as never}
              className="block rounded-[var(--radius-card)] border border-[var(--color-border)] bg-surface-2 p-5 hover:bg-surface-3 focus-visible:bg-surface-3"
            >
              <div className="font-display text-lg font-semibold">
                {t(`nav.${tile.key}`)}
              </div>
              <div className="text-muted text-sm">{t("home.linkLabel")}</div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
