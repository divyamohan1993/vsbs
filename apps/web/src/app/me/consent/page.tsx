import { getTranslations } from "next-intl/server";
import { ConsentToggles } from "./ConsentToggles";

// Mirror of `ConsentPurposeSchema` from packages/shared/src/schema/consent.ts.
// Kept as a local const so the web bundler never pulls shared-package source
// into the client graph (shared imports use .js specifiers that confuse the
// Next resolver when TS path-mapped to the src tree).
const CONSENT_PURPOSES = [
  "service-fulfilment",
  "diagnostic-telemetry",
  "voice-photo-processing",
  "marketing",
  "ml-improvement-anonymised",
  "autonomy-delegation",
  "autopay-within-cap",
] as const;

export default async function ConsentPage() {
  const t = await getTranslations();
  return (
    <section className="space-y-6 py-6">
      <header className="space-y-1">
        <p className="text-muted text-sm uppercase tracking-[0.2em]">{t("consent.eyebrow")}</p>
        <h1 className="font-display text-3xl font-semibold">{t("consent.title")}</h1>
        <p className="text-muted max-w-2xl">{t("consent.subtitle")}</p>
      </header>
      <ConsentToggles purposes={[...CONSENT_PURPOSES]} />
    </section>
  );
}
