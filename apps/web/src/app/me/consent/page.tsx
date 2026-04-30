import { getTranslations } from "next-intl/server";
import { ConsentDashboard } from "./ConsentToggles";

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

export default async function ConsentPage(): Promise<React.JSX.Element> {
  const t = await getTranslations();
  return (
    <section
      aria-labelledby="consent-h"
      className="mx-auto w-full max-w-[1180px] py-6"
    >
      <h1 id="consent-h" className="sr-only">
        {t("consent.title")}
      </h1>
      <ConsentDashboard purposes={[...CONSENT_PURPOSES]} />
    </section>
  );
}
