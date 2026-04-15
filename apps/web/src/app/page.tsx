import { getTranslations } from "next-intl/server";
import Link from "next/link";

export default async function HomePage() {
  const t = await getTranslations();
  const cards = [
    { key: "safety", title: t("home.cards.safety.title"), body: t("home.cards.safety.body") },
    { key: "explainable", title: t("home.cards.explainable.title"), body: t("home.cards.explainable.body") },
    { key: "transparent", title: t("home.cards.transparent.title"), body: t("home.cards.transparent.body") },
  ];
  return (
    <section className="space-y-12 py-6">
      <header className="space-y-4">
        <p className="text-muted text-sm uppercase tracking-[0.2em]">{t("app.name")}</p>
        <h1 className="font-display text-5xl font-semibold leading-[1.05] md:text-7xl">
          {t("app.tagline")}
        </h1>
        <p className="text-muted max-w-2xl text-lg">{t("home.whyWeCare")}</p>
      </header>
      <div className="flex flex-wrap items-center gap-4">
        <Link
          href={{ pathname: "/book" }}
          className="inline-flex items-center justify-center rounded-[var(--radius-card)] bg-accent px-6 py-3 text-base font-semibold text-accent-on"
        >
          {t("home.bookCta")}
        </Link>
        <ul className="flex flex-wrap gap-2 text-sm">
          <li className="rounded-full border border-muted/30 px-3 py-1">{t("home.badges.wcag")}</li>
          <li className="rounded-full border border-muted/30 px-3 py-1">{t("home.badges.dpdp")}</li>
          <li className="rounded-full border border-muted/30 px-3 py-1">{t("home.badges.pq")}</li>
        </ul>
      </div>
      <section aria-labelledby="why-vsbs" className="space-y-6">
        <h2 id="why-vsbs" className="font-display text-3xl font-semibold">
          {t("home.whyTitle")}
        </h2>
        <ul className="grid gap-4 md:grid-cols-3">
          {cards.map((c) => (
            <li
              key={c.key}
              className="rounded-[var(--radius-card)] border border-muted/30 bg-surface p-6"
              style={{ backgroundColor: "oklch(18% 0.02 260)" }}
            >
              <h3 className="font-display text-xl font-semibold text-on-surface">{c.title}</h3>
              <p className="mt-2 text-on-surface">{c.body}</p>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
