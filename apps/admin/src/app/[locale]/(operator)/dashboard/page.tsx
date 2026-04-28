import { setRequestLocale } from "next-intl/server";

interface PageProps {
  params: Promise<{ locale: string }>;
}

const TILES: Array<{ title: string; href: string; body: string }> = [
  {
    title: "Live logs",
    href: "/dashboard/../logs",
    body: "SSE feed from /v1/admin/logs/stream - every redacted log line, filterable by level and full-text query.",
  },
  {
    title: "Alerts + SLOs",
    href: "/dashboard/../alerts",
    body: "Burn-rate evaluations against the four canonical VSBS SLOs. Fast-burn (1h), slow-burn (6h), ticket (3d).",
  },
  {
    title: "Runbooks",
    href: "/dashboard/../runbooks",
    body: "Operator playbooks - high-error-rate, high-latency, safety-override spike, autonomy-handoff failure, canary rollback.",
  },
  {
    title: "Canary control",
    href: "/dashboard/../canary",
    body: "Per-agent + per-adapter feature flags and the kill switch. Promote at 5 / 25 / 50 / 100 %.",
  },
];

export default async function DashboardPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <section aria-labelledby="dash-title" className="space-y-8">
      <header className="space-y-2">
        <h2 id="dash-title" className="font-display text-3xl font-semibold">
          Observability dashboard
        </h2>
        <p className="text-muted max-w-3xl text-base">
          The operator-facing view of the production telemetry surface. Every panel is sourced from
          OpenTelemetry traces, structured logs, and Prometheus metrics. Click into any tile to drill
          down.
        </p>
      </header>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {TILES.map((t) => (
          <li
            key={t.title}
            className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-surface-2 p-6"
          >
            <a
              href={t.href}
              className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <h3 className="font-display text-xl font-semibold">{t.title}</h3>
              <p className="text-muted mt-2 text-sm">{t.body}</p>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
