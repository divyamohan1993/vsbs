import { setRequestLocale } from "next-intl/server";

interface PageProps {
  params: Promise<{ locale: string }>;
}

const FLAGS: Array<{ name: string; description: string; default: string }> = [
  { name: "agent.langgraph.v2", description: "Switch the supervisor to the v2 hierarchical graph.", default: "off" },
  { name: "adapter.smartcar", description: "Live Smartcar bridge for US vehicles. Sim driver otherwise.", default: "sim" },
  { name: "adapter.obd_ble", description: "ELM327 BLE dongle ingestion path for India BS6 vehicles.", default: "sim" },
  { name: "autonomy.mercedes_ipp", description: "Mercedes-Bosch Intelligent Park Pilot adapter.", default: "sim" },
  { name: "kb.alloydb_pgvector", description: "AlloyDB + pgvector hybrid retrieval. Sim returns deterministic shards.", default: "sim" },
  { name: "kill_switch.autonomy", description: "Hard-disables every autonomy code path. Pulls grants on activation.", default: "off" },
];

export default async function CanaryPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <section aria-labelledby="canary-title" className="space-y-6">
      <header className="space-y-1">
        <h2 id="canary-title" className="font-display text-2xl font-semibold">
          Canary control + kill switch
        </h2>
        <p className="text-muted text-sm">
          Feature flags managed via the operator console. Promotion ladder is 5 % → 25 % → 50 % → 100 %.
          Auto-rollback fires on any SLO burn-rate page. Editing requires a privileged role; this view is
          read-only.
        </p>
      </header>
      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-border)]">
        <table className="w-full text-sm">
          <caption className="sr-only">Canary feature flags</caption>
          <thead className="bg-surface-2">
            <tr>
              <th scope="col" className="px-3 py-2 text-left">Flag</th>
              <th scope="col" className="px-3 py-2 text-left">Description</th>
              <th scope="col" className="px-3 py-2 text-left">Default</th>
            </tr>
          </thead>
          <tbody>
            {FLAGS.map((f) => (
              <tr key={f.name} className="border-t border-[var(--color-border)]">
                <th scope="row" className="px-3 py-2 text-left font-mono text-xs">{f.name}</th>
                <td className="px-3 py-2">{f.description}</td>
                <td className="px-3 py-2 font-mono text-xs">{f.default}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
