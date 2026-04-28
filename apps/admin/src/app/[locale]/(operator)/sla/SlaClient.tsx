"use client";

import { useCallback, useEffect, useState } from "react";

import { adminApi, AdminApiError } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

interface SlaRow {
  scId: string;
  responseMinutes: number;
  resolutionMinutes: number;
  escalationChain: string[];
  burnPct: number;
  updatedAt: string;
}

interface Labels {
  response: string;
  resolution: string;
  escalation: string;
  save: string;
}

export function SlaClient({ labels }: { labels: Labels }) {
  const [rows, setRows] = useState<SlaRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<Record<string, SlaRow>>({});

  const load = useCallback(async () => {
    try {
      const r = await adminApi.sla.list();
      const rs = r.data as SlaRow[];
      setRows(rs);
      const next: Record<string, SlaRow> = {};
      for (const row of rs) next[row.scId] = row;
      setEdit(next);
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(scId: string) {
    const row = edit[scId];
    if (!row) return;
    try {
      await adminApi.sla.save({
        scId,
        responseMinutes: row.responseMinutes,
        resolutionMinutes: row.resolutionMinutes,
        escalationChain: row.escalationChain,
      });
      await load();
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div role="alert" className="rounded-md bg-danger px-3 py-2 text-sm text-danger-on">
          {error}
        </div>
      ) : null}
      <ul className="grid gap-4 md:grid-cols-2">
        {rows.map((row) => {
          const e = edit[row.scId] ?? row;
          const burnTone = row.burnPct > 75 ? "danger" : row.burnPct > 50 ? "warn" : "success";
          return (
            <li key={row.scId}>
              <Card
                title={row.scId}
                description={
                  <span>
                    Burn{" "}
                    <span
                      className={
                        burnTone === "danger"
                          ? "text-danger"
                          : burnTone === "warn"
                            ? "text-warn"
                            : "text-success"
                      }
                    >
                      {row.burnPct}%
                    </span>
                  </span>
                }
              >
                <form
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    void save(row.scId);
                  }}
                  className="grid gap-3"
                >
                  <label className="flex flex-col text-xs">
                    <span className="text-muted">{labels.response}</span>
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      value={e.responseMinutes}
                      onChange={(ev) =>
                        setEdit((s) => ({
                          ...s,
                          [row.scId]: { ...e, responseMinutes: Number(ev.target.value) },
                        }))
                      }
                      className="mt-1 rounded-md border border-[var(--color-border)] bg-surface px-2 py-1"
                    />
                  </label>
                  <label className="flex flex-col text-xs">
                    <span className="text-muted">{labels.resolution}</span>
                    <input
                      type="number"
                      min={1}
                      value={e.resolutionMinutes}
                      onChange={(ev) =>
                        setEdit((s) => ({
                          ...s,
                          [row.scId]: { ...e, resolutionMinutes: Number(ev.target.value) },
                        }))
                      }
                      className="mt-1 rounded-md border border-[var(--color-border)] bg-surface px-2 py-1"
                    />
                  </label>
                  <label className="flex flex-col text-xs">
                    <span className="text-muted">{labels.escalation}</span>
                    <textarea
                      rows={3}
                      value={e.escalationChain.join("\n")}
                      onChange={(ev) =>
                        setEdit((s) => ({
                          ...s,
                          [row.scId]: {
                            ...e,
                            escalationChain: ev.target.value
                              .split(/\n+/)
                              .map((x) => x.trim())
                              .filter(Boolean),
                          },
                        }))
                      }
                      className="mt-1 rounded-md border border-[var(--color-border)] bg-surface px-2 py-1 font-mono text-xs"
                    />
                  </label>
                  <Button type="submit">{labels.save}</Button>
                </form>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
