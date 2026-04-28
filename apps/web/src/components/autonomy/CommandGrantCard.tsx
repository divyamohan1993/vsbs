"use client";

import { useMemo } from "react";
import { Badge } from "../ui/Form";
import { cn } from "../ui/cn";

export interface CommandGrantSummary {
  id: string;
  status: "active" | "revoked" | "expired" | "pending";
  scope: string[];
  tier: string;
  ttlSeconds: number;
  ttlRemainingSeconds: number;
  canonicalBytesPreview: string;
  signatureHash: string;
  algorithm: "ES256" | "RS256" | "Ed25519" | "ML-DSA";
  witnessChain: { witnessId: string; merkleRoot: string }[];
  issuedAt: string;
  oem: string;
  vehicleVin?: string;
}

interface Props {
  grant: CommandGrantSummary | null;
  className?: string;
}

export function CommandGrantCard({ grant, className }: Props): React.JSX.Element {
  const ttlPercent = useMemo(() => {
    if (!grant || grant.ttlSeconds <= 0) return 0;
    return Math.max(0, Math.min(100, (grant.ttlRemainingSeconds / grant.ttlSeconds) * 100));
  }, [grant]);

  if (!grant) {
    return (
      <section
        aria-labelledby="grant-title"
        className={cn(
          "flex flex-col gap-3 rounded-[var(--radius-card)] border border-muted/40 p-5",
          className,
        )}
        style={{ backgroundColor: "oklch(20% 0.02 260)" }}
      >
        <h2 id="grant-title" className="font-display text-lg font-semibold">Command grant</h2>
        <p className="text-muted">No grant is active for this booking.</p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="grant-title"
      className={cn(
        "flex flex-col gap-3 rounded-[var(--radius-card)] border-2 p-5",
        grant.status === "active" ? "border-accent" : "border-muted/40",
        className,
      )}
      style={{ backgroundColor: "oklch(20% 0.02 260)" }}
    >
      <header className="flex items-center justify-between">
        <h2 id="grant-title" className="font-display text-lg font-semibold">Command grant</h2>
        <Badge tone={grant.status === "active" ? "success" : grant.status === "revoked" ? "danger" : "neutral"}>
          {grant.status.toUpperCase()}
        </Badge>
      </header>

      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">Tier</dt>
          <dd className="font-mono">{grant.tier}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">OEM</dt>
          <dd className="font-mono">{grant.oem}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs uppercase tracking-wide text-muted">Grant ID</dt>
          <dd className="break-all font-mono text-xs">{grant.id}</dd>
        </div>
        {grant.vehicleVin ? (
          <div className="sm:col-span-2">
            <dt className="text-xs uppercase tracking-wide text-muted">VIN</dt>
            <dd className="break-all font-mono text-xs">{grant.vehicleVin}</dd>
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <dt className="text-xs uppercase tracking-wide text-muted">Scopes</dt>
          <dd className="mt-1 flex flex-wrap gap-1">
            {grant.scope.map((s) => (
              <Badge key={s} tone="info">{s}</Badge>
            ))}
          </dd>
        </div>
      </dl>

      <div>
        <p className="flex justify-between text-xs">
          <span className="uppercase tracking-wide text-muted">TTL remaining</span>
          <span className="font-mono">{Math.max(0, grant.ttlRemainingSeconds)} s</span>
        </p>
        <div
          role="progressbar"
          aria-label="Grant time remaining"
          aria-valuemin={0}
          aria-valuemax={grant.ttlSeconds}
          aria-valuenow={grant.ttlRemainingSeconds}
          className="mt-1 h-2 overflow-hidden rounded-full bg-muted/30"
        >
          <div className="h-full bg-accent" style={{ width: `${ttlPercent}%` }} aria-hidden="true" />
        </div>
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-sm font-semibold text-on-surface">Signature chain</summary>
        <dl className="mt-2 space-y-2 font-mono text-xs">
          <div>
            <dt className="text-muted">Algorithm</dt>
            <dd>{grant.algorithm}</dd>
          </div>
          <div>
            <dt className="text-muted">Canonical bytes (RFC 8785)</dt>
            <dd className="break-all rounded bg-on-surface/5 p-2">{grant.canonicalBytesPreview}</dd>
          </div>
          <div>
            <dt className="text-muted">Signature hash</dt>
            <dd className="break-all">{grant.signatureHash}</dd>
          </div>
          <div>
            <dt className="text-muted">Witness chain</dt>
            <dd>
              <ul className="space-y-1">
                {grant.witnessChain.map((w, i) => (
                  <li key={`${w.witnessId}-${i}`} className="break-all">
                    <span className="text-on-surface/70">{i + 1}. {w.witnessId}</span>{" "}
                    <span>{w.merkleRoot}</span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
          <div>
            <dt className="text-muted">Issued at</dt>
            <dd>{grant.issuedAt}</dd>
          </div>
        </dl>
      </details>
    </section>
  );
}
