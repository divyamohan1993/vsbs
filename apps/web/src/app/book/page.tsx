import { getTranslations } from "next-intl/server";
import { BookingWizard } from "./BookingWizard";
import { AmbientGlow } from "../../components/luxe";

export default async function BookPage(): Promise<React.JSX.Element> {
  const t = await getTranslations();
  return (
    <section
      aria-labelledby="book-h"
      className="relative isolate mx-auto w-full max-w-[720px] px-6 py-[56px] md:py-[120px]"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[var(--radius-xl)]"
      >
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: 'url("/images/wizard-bay.webp")',
            backgroundSize: "cover",
            backgroundPosition: "center",
            opacity: 0.08,
            filter: "blur(32px) saturate(110%)",
          }}
        />
        <AmbientGlow tone="sky" className="!inset-[-30%_auto_auto_-20%]" />
        <AmbientGlow
          tone="copper"
          className="!inset-[auto_-20%_-30%_auto] !w-[60%] !h-[60%]"
        />
      </div>
      <h1 id="book-h" className="sr-only">
        {t("book.title")}
      </h1>
      <BookingWizard />
    </section>
  );
}
