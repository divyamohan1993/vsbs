import { setRequestLocale } from "next-intl/server";

interface PageProps {
  params: Promise<{ locale: string }>;
}

const ALERTS = [
  {
    name: "API availability",
    target: "99.9 %",
    window: "30 d",
    description: "vsbs_http_requests_total{status!~\"5..\"} / vsbs_http_requests_total",
  },
  {
    name: "API latency p99",
    target: "99 % under 1 s",
    window: "7 d",
    description: "histogram_quantile(0.99, vsbs_http_request_duration_seconds_bucket) ≤ 1",
  },
  {
    name: "Concierge turn success",
    target: "99.5 %",
    window: "7 d",
    description: "vsbs_concierge_turns_total{result=\"ok\"} / vsbs_concierge_turns_total",
  },
  {
    name: "Autonomy handoff success",
    target: "99.9 %",
    window: "30 d",
    description: "vsbs_autonomy_handoff_total{result=\"ok\"} / vsbs_autonomy_handoff_total",
  },
];

const THRESHOLDS = [
  { name: "fast-burn", window: "1 h", multiplier: "14.4×", severity: "page" },
  { name: "slow-burn", window: "6 h", multiplier: "6×", severity: "page" },
  { name: "ticket", window: "3 d", multiplier: "1×", severity: "ticket" },
];

export default async function AlertsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <section aria-labelledby="alerts-title" className="space-y-8">
      <header className="space-y-1">
        <h2 id="alerts-title" className="font-display text-2xl font-semibold">
          SLOs and burn-rate alerts
        </h2>
        <p className="text-muted text-sm">
          Per the Google SRE workbook. Alerts fire on multi-window burn rates against the
          published targets below.
        </p>
      </header>

      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-border)]">
        <table className="w-full text-sm">
          <caption className="sr-only">Canonical SLOs</caption>
          <thead className="bg-surface-2">
            <tr>
              <th scope="col" className="px-3 py-2 text-left">SLO</th>
              <th scope="col" className="px-3 py-2 text-left">Target</th>
              <th scope="col" className="px-3 py-2 text-left">Window</th>
              <th scope="col" className="px-3 py-2 text-left">SLI</th>
            </tr>
          </thead>
          <tbody>
            {ALERTS.map((a) => (
              <tr key={a.name} className="border-t border-[var(--color-border)]">
                <th scope="row" className="px-3 py-2 text-left font-medium">{a.name}</th>
                <td className="px-3 py-2">{a.target}</td>
                <td className="px-3 py-2">{a.window}</td>
                <td className="px-3 py-2 font-mono text-xs">{a.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-border)]">
        <table className="w-full text-sm">
          <caption className="sr-only">Burn-rate thresholds</caption>
          <thead className="bg-surface-2">
            <tr>
              <th scope="col" className="px-3 py-2 text-left">Threshold</th>
              <th scope="col" className="px-3 py-2 text-left">Window</th>
              <th scope="col" className="px-3 py-2 text-left">Multiplier</th>
              <th scope="col" className="px-3 py-2 text-left">Severity</th>
            </tr>
          </thead>
          <tbody>
            {THRESHOLDS.map((t) => (
              <tr key={t.name} className="border-t border-[var(--color-border)]">
                <th scope="row" className="px-3 py-2 text-left font-medium">{t.name}</th>
                <td className="px-3 py-2">{t.window}</td>
                <td className="px-3 py-2">{t.multiplier}</td>
                <td className="px-3 py-2">{t.severity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
