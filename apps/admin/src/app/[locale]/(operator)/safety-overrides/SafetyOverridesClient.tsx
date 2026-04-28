"use client";

import { useCallback, useEffect, useState } from "react";

import { adminApi, AdminApiError } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusPill } from "@/components/ui/StatusPill";

interface OverrideRow {
  id: string;
  at: string;
  actor: { kind: string; subject: string };
  bookingId: string;
  decision: string;
  rationale: string;
  context: { signals: string[]; previousTier: string; newTier: string };
  downstreamEffect: string;
}

interface Labels {
  actor: string;
  kind: string;
  decision: string;
  rationale: string;
}

export function SafetyOverridesClient({ labels }: { labels: Labels }) {
  const [rows, setRows] = useState<OverrideRow[]>([]);
  const [filter, setFilter] = useState<{ actorKind: string; decision: string }>({
    actorKind: "",
    decision: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const q: Record<string, string | undefined> = {};
      if (filter.actorKind) q.actorKind = filter.actorKind;
      if (filter.decision) q.decision = filter.decision;
      const r = await adminApi.safetyOverrides.list(q);
      setRows(r.data as OverrideRow[]);
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : String(e));
    }
  }, [filter.actorKind, filter.decision]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card
      actions={
        <div className="flex items-end gap-2">
          <label className="flex flex-col text-xs">
            <span className="text-muted">{labels.kind}</span>
            <select
              value={filter.actorKind}
              onChange={(e) => setFilter((f) => ({ ...f, actorKind: e.target.value }))}
              className="mt-1 rounded-md border border-[var(--color-border)] bg-surface px-2 py-1"
              aria-label={labels.kind}
            >
              <option value="">All</option>
              <option value="user">user</option>
              <option value="agent">agent</option>
              <option value="operator">operator</option>
            </select>
          </label>
          <label className="flex flex-col text-xs">
            <span className="text-muted">{labels.decision}</span>
            <select
              value={filter.decision}
              onChange={(e) => setFilter((f) => ({ ...f, decision: e.target.value }))}
              className="mt-1 rounded-md border border-[var(--color-border)] bg-surface px-2 py-1"
              aria-label={labels.decision}
            >
              <option value="">All</option>
              <option value="downgrade">downgrade</option>
              <option value="upgrade">upgrade</option>
              <option value="tow">tow</option>
              <option value="delay">delay</option>
            </select>
          </label>
          <Button onClick={() => void load()}>Apply</Button>
        </div>
      }
    >
      {error ? (
        <div role="alert" className="mb-3 rounded-md bg-danger px-3 py-2 text-sm text-danger-on">
          {error}
        </div>
      ) : null}
      <ol className="space-y-2">
        {rows.length === 0 ? (
          <li className="text-muted">No safety overrides match.</li>
        ) : null}
        {rows.map((r) => {
          const isOpen = expanded === r.id;
          return (
            <li key={r.id} className="rounded-md border border-[var(--color-border)] bg-surface-2">
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : r.id)}
                aria-expanded={isOpen}
                aria-controls={`so-${r.id}`}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <code className="font-mono text-xs">{r.id}</code>
                  <StatusPill tone={r.decision === "tow" ? "danger" : r.decision === "delay" ? "warn" : "info"}>
                    {r.decision}
                  </StatusPill>
                  <span className="text-muted text-xs">{new Date(r.at).toLocaleString()}</span>
                  <span className="text-muted text-xs">
                    {r.actor.kind}: {r.actor.subject}
                  </span>
                </span>
                <span aria-hidden="true">{isOpen ? "▼" : "▶"}</span>
              </button>
              {isOpen ? (
                <div id={`so-${r.id}`} className="border-t border-[var(--color-border)] px-4 py-3 text-sm">
                  <dl className="grid gap-x-6 gap-y-2 md:grid-cols-2">
                    <div>
                      <dt className="text-muted text-xs">Booking</dt>
                      <dd className="font-mono text-xs">{r.bookingId}</dd>
                    </div>
                    <div>
                      <dt className="text-muted text-xs">Tier transition</dt>
                      <dd className="text-xs">
                        {r.context.previousTier} → {r.context.newTier}
                      </dd>
                    </div>
                    <div className="md:col-span-2">
                      <dt className="text-muted text-xs">Signals</dt>
                      <dd className="text-xs">{r.context.signals.join(", ") || "—"}</dd>
                    </div>
                    <div className="md:col-span-2">
                      <dt className="text-muted text-xs">{labels.rationale}</dt>
                      <dd>{r.rationale}</dd>
                    </div>
                    <div className="md:col-span-2">
                      <dt className="text-muted text-xs">Downstream effect</dt>
                      <dd>{r.downstreamEffect}</dd>
                    </div>
                  </dl>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
