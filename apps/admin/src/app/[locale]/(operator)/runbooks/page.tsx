import { setRequestLocale } from "next-intl/server";

interface PageProps {
  params: Promise<{ locale: string }>;
}

const RUNBOOKS: Array<{ name: string; href: string; summary: string }> = [
  {
    name: "High error rate",
    href: "https://github.com/dmj-one/vsbs/blob/main/docs/runbooks/high-error-rate.md",
    summary: "5xx exceeds 1 % of requests over a 5-minute rolling window. Detect → assess → contain → fix.",
  },
  {
    name: "High latency (p99 > 1 s)",
    href: "https://github.com/dmj-one/vsbs/blob/main/docs/runbooks/high-latency.md",
    summary: "p99 over 1 s for 10 consecutive minutes. Heavy concierge turn? Cold cache? Cross-region call?",
  },
  {
    name: "Safety override spike",
    href: "https://github.com/dmj-one/vsbs/blob/main/docs/runbooks/safety-override-spike.md",
    summary: "Operator-issued safety overrides above the daily baseline. Investigate before continuing.",
  },
  {
    name: "Autonomy handoff failure",
    href: "https://github.com/dmj-one/vsbs/blob/main/docs/runbooks/autonomy-handoff-failure.md",
    summary: "Failed grant or revocation rate above 0.1 %. Check OEM adapter, signing keys, MRM ladder.",
  },
  {
    name: "Canary rollback",
    href: "https://github.com/dmj-one/vsbs/blob/main/docs/runbooks/canary-rollback.md",
    summary: "How to demote a canary to 0 % and restore the prior revision in under 60 seconds.",
  },
];

export default async function RunbooksPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <section aria-labelledby="rb-title" className="space-y-6">
      <header className="space-y-1">
        <h2 id="rb-title" className="font-display text-2xl font-semibold">
          Runbooks
        </h2>
        <p className="text-muted text-sm">
          Each runbook follows the same structure: detect → assess → contain → fix → post-mortem.
        </p>
      </header>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {RUNBOOKS.map((r) => (
          <li
            key={r.name}
            className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-surface-2 p-4"
          >
            <h3 className="font-display text-lg font-semibold">{r.name}</h3>
            <p className="text-muted mt-1 text-sm">{r.summary}</p>
            <a
              className="mt-3 inline-block underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              href={r.href}
              rel="noopener noreferrer"
              target="_blank"
            >
              Open runbook
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
