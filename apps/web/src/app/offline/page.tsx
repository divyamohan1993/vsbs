import { getTranslations } from "next-intl/server";
import Link from "next/link";

export default async function OfflinePage(): Promise<React.JSX.Element> {
  const t = await getTranslations();
  return (
    <section className="space-y-6 py-12 text-center">
      <p className="text-muted text-sm uppercase tracking-[0.2em]">{t("offline.eyebrow")}</p>
      <h1 className="font-display text-4xl font-semibold">{t("offline.title")}</h1>
      <p className="mx-auto max-w-xl text-on-surface">{t("offline.body")}</p>
      <ul className="mx-auto max-w-md list-disc text-left text-sm text-on-surface">
        <li>{t("offline.points.cached")}</li>
        <li>{t("offline.points.queued")}</li>
        <li>{t("offline.points.safety")}</li>
      </ul>
      <div className="flex justify-center">
        <Link
          href={{ pathname: "/" }}
          className="inline-flex items-center justify-center rounded-[var(--radius-card)] bg-accent px-6 py-3 text-base font-semibold text-accent-on"
        >
          {t("offline.backHome")}
        </Link>
      </div>
    </section>
  );
}
