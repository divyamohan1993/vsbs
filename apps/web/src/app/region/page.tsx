import { getTranslations } from "next-intl/server";
import { RegionSwitcher } from "../../components/region-switcher";

export default async function RegionPage() {
  const t = await getTranslations();
  return (
    <section className="space-y-8 py-6">
      <header className="space-y-2">
        <p className="text-muted text-sm uppercase tracking-[0.2em]">{t("region.eyebrow")}</p>
        <h1 className="font-display text-3xl font-semibold">{t("region.title")}</h1>
        <p className="text-muted max-w-2xl">{t("region.subtitle")}</p>
      </header>
      <RegionSwitcher />
      <aside
        role="note"
        aria-labelledby="region-residency-note"
        className="rounded-[var(--radius-card)] border border-muted/30 p-4"
      >
        <h2 id="region-residency-note" className="font-display text-lg font-semibold">
          {t("region.residencyTitle")}
        </h2>
        <p className="text-muted mt-2">{t("region.residencyBody")}</p>
      </aside>
    </section>
  );
}
