import { getTranslations, setRequestLocale } from "next-intl/server";
import { BookingsClient } from "./BookingsClient";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function BookingsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });

  return (
    <section aria-labelledby="bk-title" className="space-y-6">
      <header className="space-y-1">
        <h2 id="bk-title" className="font-display text-2xl font-semibold">
          {t("bookings.title")}
        </h2>
        <p className="text-muted text-sm">{t("bookings.subtitle")}</p>
      </header>
      <BookingsClient
        labels={{
          filterStatus: t("bookings.filterStatus"),
          filterRegion: t("bookings.filterRegion"),
          filterFrom: t("bookings.filterFrom"),
          filterTo: t("bookings.filterTo"),
          apply: t("bookings.apply"),
          reset: t("bookings.reset"),
          empty: t("bookings.empty"),
          stream: t("bookings.stream"),
          streamOff: t("bookings.streamOff"),
          colId: t("bookings.columns.id"),
          colStatus: t("bookings.columns.status"),
          colVehicle: t("bookings.columns.vehicle"),
          colOwner: t("bookings.columns.owner"),
          colEta: t("bookings.columns.etaMin"),
          colDispatch: t("bookings.columns.dispatch"),
          colWellbeing: t("bookings.columns.wellbeing"),
          colSafety: t("bookings.columns.safety"),
          actionReassign: t("bookings.actions.reassign"),
          actionCancel: t("bookings.actions.cancel"),
          actionEscalate: t("bookings.actions.escalate"),
        }}
      />
    </section>
  );
}
