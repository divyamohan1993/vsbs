import { getTranslations } from "next-intl/server";
import Link from "next/link";

interface OperatorNavProps {
  locale: string;
}

const ITEMS: Array<{ key: string; href: `/${string}`; fallback?: string }> = [
  { key: "bookings", href: "/bookings" },
  { key: "capacity", href: "/capacity" },
  { key: "routing", href: "/routing" },
  { key: "slots", href: "/slots" },
  { key: "fairness", href: "/fairness" },
  { key: "safetyOverrides", href: "/safety-overrides" },
  { key: "pricing", href: "/pricing" },
  { key: "sla", href: "/sla" },
  { key: "audit", href: "/audit" },
  // Observability surface (Phase 7).
  { key: "obsDashboard", href: "/dashboard", fallback: "Dashboard" },
  { key: "obsLogs", href: "/logs", fallback: "Logs" },
  { key: "obsAlerts", href: "/alerts", fallback: "Alerts" },
  { key: "obsRunbooks", href: "/runbooks", fallback: "Runbooks" },
  { key: "obsCanary", href: "/canary", fallback: "Canary" },
];

export async function OperatorNav({ locale }: OperatorNavProps) {
  const t = await getTranslations({ locale });
  return (
    <nav
      aria-label={t("a11y.navLandmark")}
      className="border-b border-[var(--color-border)] bg-surface-2 lg:border-b-0 lg:border-r"
    >
      <div className="px-6 py-4">
        <Link
          href={`/${locale}` as never}
          className="font-display text-base font-semibold"
        >
          {t("app.name")}
        </Link>
      </div>
      <ul className="flex flex-wrap gap-1 px-3 pb-4 lg:flex-col lg:gap-1">
        {ITEMS.map((item) => (
          <li key={item.key}>
            <Link
              href={`/${locale}${item.href}` as never}
              className="block rounded-md px-3 py-2 text-sm hover:bg-surface-3 focus-visible:bg-surface-3"
            >
              {item.fallback ?? t(`nav.${item.key}`)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
