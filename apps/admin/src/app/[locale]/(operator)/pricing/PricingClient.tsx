"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { adminApi, AdminApiError } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusPill } from "@/components/ui/StatusPill";

interface Part {
  sku: string;
  name: string;
  inr: number;
}
interface Labour {
  code: string;
  name: string;
  minutes: number;
  inr: number;
}
interface PricingVersion {
  id: string;
  scId: string;
  version: number;
  state: "draft" | "review" | "published";
  effectiveFrom: string;
  parts: Part[];
  labour: Labour[];
  createdBy: string;
  createdAt: string;
}

interface Labels {
  draft: string;
  review: string;
  publish: string;
  diff: string;
}

const SCS = ["sc-blr-01", "sc-blr-02", "sc-pune-01", "sc-sfo-01"] as const;

export function PricingClient({ labels }: { labels: Labels }) {
  const [scId, setScId] = useState<string>(SCS[0]);
  const [versions, setVersions] = useState<PricingVersion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [diffPair, setDiffPair] = useState<{ a: string; b: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await adminApi.pricing.list(scId);
      setVersions(r.data as PricingVersion[]);
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : String(e));
    }
  }, [scId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function transition(versionId: string, to: "review" | "published") {
    try {
      await adminApi.pricing.transition(versionId, to);
      await load();
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : String(e));
    }
  }

  async function newDraft() {
    const last = versions.at(-1);
    if (!last) return;
    try {
      await adminApi.pricing.draft({
        scId,
        parts: last.parts.map((p) => ({ ...p, inr: Math.round(p.inr * 1.05) })),
        labour: last.labour,
      });
      await load();
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : String(e));
    }
  }

  const diff = useMemo(() => {
    if (!diffPair) return null;
    const a = versions.find((v) => v.id === diffPair.a);
    const b = versions.find((v) => v.id === diffPair.b);
    if (!a || !b) return null;
    const partsA = new Map(a.parts.map((p) => [p.sku, p.inr]));
    const partsB = new Map(b.parts.map((p) => [p.sku, p.inr]));
    const skus = new Set([...partsA.keys(), ...partsB.keys()]);
    const partsDiff = Array.from(skus).map((sku) => ({
      sku,
      a: partsA.get(sku),
      b: partsB.get(sku),
      delta: (partsB.get(sku) ?? 0) - (partsA.get(sku) ?? 0),
    }));
    return { a, b, partsDiff };
  }, [diffPair, versions]);

  return (
    <div className="space-y-4">
      <Card
        title="Service centre"
        actions={
          <select
            value={scId}
            onChange={(e) => setScId(e.target.value)}
            aria-label="Service centre"
            className="rounded-md border border-[var(--color-border)] bg-surface px-2 py-1 text-sm"
          >
            {SCS.map((sc) => (
              <option key={sc} value={sc}>
                {sc}
              </option>
            ))}
          </select>
        }
      >
        {error ? (
          <div role="alert" className="mb-3 rounded-md bg-danger px-3 py-2 text-sm text-danger-on">
            {error}
          </div>
        ) : null}
        <div className="space-y-3">
          <Button onClick={() => void newDraft()}>{labels.draft} (5% increment)</Button>
          <ol className="space-y-2">
            {versions.map((v) => (
              <li key={v.id} className="rounded-md border border-[var(--color-border)] bg-surface-2 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="font-display font-semibold">v{v.version}</span>
                    <StatusPill tone={v.state === "published" ? "success" : v.state === "review" ? "warn" : "muted"}>
                      {v.state}
                    </StatusPill>
                    <span className="text-muted text-xs">
                      {new Date(v.effectiveFrom).toLocaleString()}
                    </span>
                    <span className="text-muted text-xs">{v.createdBy}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    {v.state === "draft" ? (
                      <Button variant="secondary" onClick={() => void transition(v.id, "review")}>
                        {labels.review}
                      </Button>
                    ) : null}
                    {v.state === "review" ? (
                      <Button variant="primary" onClick={() => void transition(v.id, "published")}>
                        {labels.publish}
                      </Button>
                    ) : null}
                    <Button
                      variant="secondary"
                      onClick={() => {
                        const prev = versions.find((p) => p.version === v.version - 1);
                        if (prev) setDiffPair({ a: prev.id, b: v.id });
                      }}
                      disabled={v.version === 1}
                    >
                      {labels.diff}
                    </Button>
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </Card>
      {diff ? (
        <Card title={`${labels.diff}: v${diff.a.version} -> v${diff.b.version}`}>
          <table className="w-full text-sm">
            <caption className="sr-only">Pricing diff between two versions</caption>
            <thead className="bg-surface-3">
              <tr>
                <th scope="col" className="px-3 py-2 text-left">SKU</th>
                <th scope="col" className="px-3 py-2 text-right">v{diff.a.version}</th>
                <th scope="col" className="px-3 py-2 text-right">v{diff.b.version}</th>
                <th scope="col" className="px-3 py-2 text-right">Δ</th>
              </tr>
            </thead>
            <tbody>
              {diff.partsDiff.map((p) => (
                <tr key={p.sku} className="border-t border-[var(--color-border)]">
                  <td className="px-3 py-2 font-mono text-xs">{p.sku}</td>
                  <td className="px-3 py-2 text-right">{p.a ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{p.b ?? "—"}</td>
                  <td className={`px-3 py-2 text-right ${p.delta > 0 ? "text-warn" : p.delta < 0 ? "text-success" : ""}`}>
                    {p.delta > 0 ? "+" : ""}
                    {p.delta}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}
