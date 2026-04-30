import { getTranslations } from "next-intl/server";
import { OfflineSurface } from "./OfflineSurface";

export default async function OfflinePage(): Promise<React.JSX.Element> {
  const t = await getTranslations();
  return (
    <section
      aria-labelledby="offline-h"
      className="mx-auto w-full max-w-[1180px] py-6"
    >
      <h1 id="offline-h" className="sr-only">
        {t("offline.title")}
      </h1>
      <OfflineSurface
        labels={{
          eyebrow: t("offline.eyebrow"),
          title: t("offline.title"),
          subtitle: t("offline.subtitle"),
          cached: t("offline.points.cached"),
          queued: t("offline.points.queued"),
          safety: t("offline.points.safety"),
          diagnostics: t("offline.diagnostics"),
          swVersion: t("offline.diagnosticsSwVersion"),
          queueLength: t("offline.diagnosticsQueue"),
          lastOnline: t("offline.diagnosticsLastOnline"),
          swUnavailable: t("offline.diagnosticsSwUnavailable"),
          lastOnlineNever: t("offline.diagnosticsLastOnlineNever"),
          tryAgain: t("offline.tryAgain"),
          tryingAgain: t("offline.tryingAgain"),
        }}
      />
    </section>
  );
}
