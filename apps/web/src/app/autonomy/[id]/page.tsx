import { getTranslations } from "next-intl/server";
import { AutonomyDashboard } from "./AutonomyDashboard";

export default async function AutonomyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations();
  return (
    <section className="space-y-6 py-6">
      <header className="space-y-1">
        <p className="text-muted text-sm uppercase tracking-[0.2em]">{t("autonomy.eyebrow")}</p>
        <h1 className="font-display text-3xl font-semibold">
          {t("autonomy.title", { id })}
        </h1>
        <p className="text-muted">{t("autonomy.subtitle")}</p>
      </header>
      <AutonomyDashboard bookingId={id} />
    </section>
  );
}
