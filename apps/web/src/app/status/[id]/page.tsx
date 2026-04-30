import { getTranslations } from "next-intl/server";
import { LiveTicker } from "./LiveTicker";

export default async function StatusPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const t = await getTranslations();
  return (
    <section
      aria-labelledby="status-h"
      className="mx-auto w-full max-w-[1180px] space-y-10 py-6"
    >
      <h1 id="status-h" className="sr-only">
        {t("status.title", { id })}
      </h1>
      <LiveTicker id={id} />
    </section>
  );
}
