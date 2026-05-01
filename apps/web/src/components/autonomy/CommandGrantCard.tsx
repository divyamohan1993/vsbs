"use client";

// CommandGrantCard — the moment of premium on the autonomy hyperscreen.
// Treat it like a digital boarding pass: a copper seal, the issuing OEM, the
// vehicle, an authority chain row of three witnesses, the scope pills, the
// expiry countdown, and the override CTA.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "../ui/cn";
import { GlassPanel, GoldSeal, SpecLabel } from "../luxe";
import { StatusPill, type StatusPillTone } from "./luxe/StatusPill";

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
  vehicleLabel?: string;
  oemLabel?: string;
}

interface Props {
  grant: CommandGrantSummary | null;
  override?: ReactNode;
  className?: string;
}

const STATUS_TONE: Record<CommandGrantSummary["status"], StatusPillTone> = {
  active: "ok",
  pending: "watch",
  expired: "neutral",
  revoked: "halt",
};

const STATUS_LABEL: Record<CommandGrantSummary["status"], string> = {
  active: "ACTIVE",
  pending: "PENDING",
  expired: "EXPIRED",
  revoked: "REVOKED",
};

export function CommandGrantCard({ grant, override, className }: Props): React.JSX.Element {
  if (!grant) {
    return (
      <GlassPanel
        variant="elevated"
        as="section"
        aria-labelledby="grant-title"
        className={cn(
          "flex flex-col gap-4 !p-8",
          className,
        )}
      >
        <div className="flex items-center gap-3">
          <GoldSeal size={40} label="no grant" />
          <div className="flex flex-col gap-1">
            <SpecLabel>Command grant</SpecLabel>
            <h2
              id="grant-title"
              className="font-[family-name:var(--font-display)] text-[length:var(--text-h4)] tracking-[var(--tracking-tight)] text-pearl"
            >
              No active grant.
            </h2>
          </div>
        </div>
        <p className="text-pearl-muted text-[length:var(--text-control)] leading-[1.6]">
          No grant is active for this booking. The vehicle stays under your control until you
          issue one from the booking flow.
        </p>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel
      variant="elevated"
      as="section"
      aria-labelledby="grant-title"
      className={cn(
        "relative grid gap-8 !p-8 md:grid-cols-[1fr_1fr_1fr] md:gap-10",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-8 top-0 h-px"
        style={{ background: "linear-gradient(90deg, transparent, rgba(201,163,106,0.45), transparent)" }}
      />
      <SealColumn grant={grant} />
      <ChainColumn grant={grant} />
      <ExpiryColumn grant={grant} override={override} />
    </GlassPanel>
  );
}

function SealColumn({ grant }: { grant: CommandGrantSummary }): React.JSX.Element {
  const vehicle = grant.vehicleLabel ?? "Vehicle";
  const oem = grant.oemLabel ?? grant.oem;
  return (
    <div className="flex flex-col gap-4">
      <span className="luxe-mono text-[length:var(--text-caption)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
        {grant.tier}
      </span>
      <div className="flex items-center gap-4">
        <GoldSeal size={56} label={`grant ${grant.id} verified`} />
        <div className="flex flex-col gap-1">
          <SpecLabel>Vehicle</SpecLabel>
          <h2
            id="grant-title"
            className="font-[family-name:var(--font-display)] text-[length:var(--text-h3)] leading-[1.05] tracking-[var(--tracking-tight)] text-pearl"
          >
            {vehicle}
          </h2>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <SpecLabel>Issued by</SpecLabel>
        <span className="text-[length:var(--text-control)] text-pearl">{oem}</span>
      </div>
      {grant.vehicleVin ? (
        <div className="flex flex-col gap-1">
          <SpecLabel>VIN</SpecLabel>
          <span className="luxe-mono text-[length:var(--text-small)] text-pearl-muted break-all">
            {grant.vehicleVin}
          </span>
        </div>
      ) : null}
      <StatusPill tone={STATUS_TONE[grant.status]}>
        {STATUS_LABEL[grant.status]}
      </StatusPill>
    </div>
  );
}

function ChainColumn({ grant }: { grant: CommandGrantSummary }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <SpecLabel>Authority chain</SpecLabel>
      <div className="relative flex items-center justify-between">
        <span
          aria-hidden="true"
          className="absolute left-7 right-7 top-1/2 h-px -translate-y-1/2"
          style={{ background: "var(--color-hairline-strong)" }}
        />
        {(grant.witnessChain.length > 0
          ? grant.witnessChain
          : [{ witnessId: "owner", merkleRoot: "" }]
        )
          .slice(0, 3)
          .map((w, i) => (
            <Witness key={`${w.witnessId}-${i}`} index={i} witness={w} verified={grant.status === "active"} />
          ))}
      </div>
      <dl className="mt-2 grid grid-cols-1 gap-2 text-[length:var(--text-small)]">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="luxe-mono uppercase tracking-[var(--tracking-caps)] text-[length:var(--text-micro)] text-pearl-soft">
            Algorithm
          </dt>
          <dd className="luxe-mono text-pearl">{grant.algorithm}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="luxe-mono uppercase tracking-[var(--tracking-caps)] text-[length:var(--text-micro)] text-pearl-soft">
            Signature
          </dt>
          <dd className="luxe-mono text-pearl-muted truncate" title={grant.signatureHash}>
            {grant.signatureHash}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="luxe-mono uppercase tracking-[var(--tracking-caps)] text-[length:var(--text-micro)] text-pearl-soft">
            Issued
          </dt>
          <dd className="luxe-mono text-pearl-muted">{formatIssued(grant.issuedAt)}</dd>
        </div>
      </dl>
    </div>
  );
}

function Witness({
  index,
  witness,
  verified,
}: {
  index: number;
  witness: { witnessId: string; merkleRoot: string };
  verified: boolean;
}): React.JSX.Element {
  const role = ["Owner passkey", "OEM witness", "Regulator"][index] ?? "Witness";
  return (
    <div
      className="relative z-10 flex flex-col items-center gap-2"
      title={`${role}: ${witness.witnessId}${witness.merkleRoot ? ` (${witness.merkleRoot})` : ""}`}
    >
      <span
        className="relative inline-flex h-12 w-12 items-center justify-center rounded-full"
        style={{
          background: "var(--color-glass-elevated)",
          border: "1px solid var(--color-hairline-strong)",
        }}
      >
        <span className="luxe-mono text-[length:var(--text-caption)] uppercase text-pearl">
          {witness.witnessId.slice(0, 2)}
        </span>
        {verified ? (
          <span aria-hidden="true" className="absolute -bottom-1 -right-1">
            <GoldSeal size={16} label={`${role} verified`} />
          </span>
        ) : null}
      </span>
      <span className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
        {role}
      </span>
    </div>
  );
}

function ExpiryColumn({ grant, override }: { grant: CommandGrantSummary; override?: ReactNode }): React.JSX.Element {
  const remaining = useCountdown(grant.ttlRemainingSeconds, grant.status === "active");
  const ttlPercent = useMemo(() => {
    if (grant.ttlSeconds <= 0) return 0;
    return Math.max(0, Math.min(100, (remaining / grant.ttlSeconds) * 100));
  }, [grant.ttlSeconds, remaining]);
  return (
    <div className="flex h-full flex-col gap-4">
      <SpecLabel>Scopes</SpecLabel>
      <ul className="flex flex-wrap gap-2">
        {grant.scope.map((s) => (
          <li key={s}>
            <span
              className="inline-flex items-center rounded-full border px-3 py-1 luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl"
              style={{
                borderColor: "var(--color-hairline-strong)",
                backgroundColor: "rgba(255,255,255,0.03)",
              }}
            >
              {s}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-col gap-2">
        <SpecLabel>Time remaining</SpecLabel>
        <span
          className="luxe-spec-value tabular-nums text-[length:var(--text-h3)]"
          style={{ lineHeight: 1 }}
        >
          {formatCountdown(remaining)}
        </span>
        <div
          role="progressbar"
          aria-label="Grant time remaining"
          aria-valuemin={0}
          aria-valuemax={grant.ttlSeconds}
          aria-valuenow={remaining}
          className="h-[2px] w-full overflow-hidden rounded-full"
          style={{ background: "var(--color-hairline)" }}
        >
          <div
            aria-hidden="true"
            className="h-full"
            style={{
              width: `${ttlPercent}%`,
              background: grant.status === "active"
                ? "linear-gradient(90deg, var(--color-copper), var(--color-emerald))"
                : "var(--color-pearl-soft)",
              transition: "width 720ms var(--ease-enter)",
            }}
          />
        </div>
      </div>
      {override ? <div className="mt-auto pt-2">{override}</div> : null}
    </div>
  );
}

function useCountdown(initial: number, running: boolean): number {
  const [n, setN] = useState<number>(Math.max(0, initial));
  const last = useRef<number>(initial);
  useEffect(() => {
    if (last.current !== initial) {
      last.current = initial;
      setN(Math.max(0, initial));
    }
  }, [initial]);
  useEffect(() => {
    if (!running) return;
    const handle = setInterval(() => {
      setN((v) => (v > 0 ? v - 1 : 0));
    }, 1000);
    return () => clearInterval(handle);
  }, [running]);
  return n;
}

function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function formatIssued(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toISOString().slice(0, 10);
  const time = d.toISOString().slice(11, 16);
  return `${date} ${time}Z`;
}
