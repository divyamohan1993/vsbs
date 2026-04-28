import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { HELP_ARTICLES } from "../../content/help";
import { HelpSearch } from "./HelpSearch";

export default async function HelpIndexPage(): Promise<React.JSX.Element> {
  const t = await getTranslations();
  return (
    <section className="space-y-6 py-6">
      <header className="space-y-1">
        <p className="text-muted text-sm uppercase tracking-[0.2em]">{t("help.eyebrow")}</p>
        <h1 className="font-display text-3xl font-semibold">{t("help.title")}</h1>
        <p className="text-muted">{t("help.subtitle")}</p>
      </header>

      <HelpSearch />

      <section aria-labelledby="all-articles" className="space-y-3">
        <h2 id="all-articles" className="font-display text-xl font-semibold">
          {t("help.allArticles")}
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {HELP_ARTICLES.map((a) => (
            <li key={a.slug}>
              <Link
                href={`/help/${a.slug}` as `/help/${string}`}
                className="block rounded-[var(--radius-card)] border border-muted/30 p-4 hover:border-accent"
                style={{ backgroundColor: "oklch(20% 0.02 260)" }}
              >
                <p className="font-display text-base font-semibold">{a.title}</p>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
