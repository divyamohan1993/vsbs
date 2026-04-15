import { getTranslations } from "next-intl/server";
import { LiveTicker } from "./LiveTicker";

export default async function StatusPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations();
  return (
    <section className="space-y-6 py-6">
      <header className="space-y-1">
        <p className="text-muted text-sm uppercase tracking-[0.2em]">{t("status.eyebrow")}</p>
        <h1 className="font-display text-3xl font-semibold">
          {t("status.title", { id })}
        </h1>
      </header>
      <LiveTicker id={id} />
    </section>
  );
}
