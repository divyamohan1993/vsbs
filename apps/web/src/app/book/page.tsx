import { getTranslations } from "next-intl/server";
import { BookingWizard } from "./BookingWizard";

export default async function BookPage() {
  const t = await getTranslations();
  return (
    <section className="space-y-8 py-6">
      <header className="space-y-2">
        <p className="text-muted text-sm uppercase tracking-[0.2em]">{t("book.eyebrow")}</p>
        <h1 className="font-display text-4xl font-semibold">{t("book.title")}</h1>
        <p className="text-muted max-w-2xl">{t("book.subtitle")}</p>
      </header>
      <BookingWizard />
    </section>
  );
}
