import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { HELP_ARTICLES } from "../../content/help";
import { HelpSearch } from "./HelpSearch";
import { GlassPanel, SpecLabel } from "../../components/luxe";

export default async function HelpIndexPage(): Promise<React.JSX.Element> {
  const t = await getTranslations();
  return (
    <section
      aria-labelledby="help-h"
      className="mx-auto w-full max-w-[1180px] space-y-12 py-6"
    >
      <header className="flex flex-col gap-4">
        <SpecLabel>{t("help.eyebrow")}</SpecLabel>
        <h1
          id="help-h"
          className="font-[family-name:var(--font-display)] text-[clamp(2.5rem,6vw,4.25rem)] font-medium leading-[1.02] tracking-[var(--tracking-tight)] text-pearl"
        >
          {t("help.title")}
        </h1>
        <p className="max-w-[60ch] text-[var(--text-lg)] leading-[1.55] text-pearl-muted">
          {t("help.subtitle")}
        </p>
      </header>

      <HelpSearch />

      <section aria-labelledby="all-articles" className="space-y-6">
        <div className="flex flex-col gap-2">
          <SpecLabel>{t("help.allArticles")}</SpecLabel>
          <h2
            id="all-articles"
            className="font-[family-name:var(--font-display)] text-[var(--text-h2)] font-medium tracking-[var(--tracking-tight)] text-pearl"
          >
            {t("help.browseAll")}
          </h2>
          <p className="text-[var(--text-control)] text-pearl-muted">
            {t("help.browseAllSub")}
          </p>
        </div>
        <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {HELP_ARTICLES.map((a) => (
            <li key={a.slug}>
              <Link
                href={`/help/${a.slug}` as `/help/${string}`}
                className="block h-full"
              >
                <GlassPanel
                  interactive
                  className="group flex h-full flex-col gap-4 !py-7 transition-[transform] duration-[var(--duration-state)] ease-[var(--ease-enter)] hover:-translate-y-0.5"
                >
                  <h3 className="font-[family-name:var(--font-display)] text-[var(--text-h4)] font-medium leading-[1.25] tracking-[var(--tracking-tight)] text-pearl">
                    {a.title}
                  </h3>
                  <p className="text-[var(--text-control)] leading-[1.6] text-pearl-muted">
                    {t(`help.snippet.${a.slug}`)}
                  </p>
                  <span className="mt-auto inline-flex items-center gap-2 text-[var(--text-caption)] tracking-[var(--tracking-wide)] uppercase text-pearl-soft">
                    <span>{t("help.read")}</span>
                    <span
                      aria-hidden="true"
                      className="inline-block transition-transform duration-[var(--duration-state)] ease-[var(--ease-enter)] group-hover:translate-x-1"
                    >
                      →
                    </span>
                  </span>
                </GlassPanel>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
