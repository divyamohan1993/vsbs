import { setRequestLocale } from "next-intl/server";
import { LogsClient } from "./LogsClient";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function LogsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <section aria-labelledby="logs-title" className="space-y-6">
      <header className="space-y-1">
        <h2 id="logs-title" className="font-display text-2xl font-semibold">
          Live structured logs
        </h2>
        <p className="text-muted text-sm">
          Streamed from <code>/v1/admin/logs/stream</code>. Every entry is PII-redacted. Filter by level
          or substring. The connection auto-recovers if it drops.
        </p>
      </header>
      <LogsClient />
    </section>
  );
}
