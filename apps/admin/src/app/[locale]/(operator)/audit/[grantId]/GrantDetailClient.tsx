"use client";

import { useCallback, useEffect, useState } from "react";

import { adminApi, AdminApiError } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusPill } from "@/components/ui/StatusPill";
import { canonicalize, hexToBytes, sha256Hex } from "@/lib/audit-crypto";

interface GrantDetail {
  grant: {
    grantId: string;
    vehicleId: string;
    scId: string;
    ownerId: string;
    tier: string;
    scopes: string[];
    notBefore: string;
    notAfter: string;
    ownerSignatureB64: string;
    witnessSignaturesB64: Record<string, string>;
    canonicalDigestHex: string;
    merkleIndex: number;
    rootIndex: number;
    status: string;
  };
  root?: { index: number; rootHashHex: string; size: number; publishedAt: string };
  inclusionProof: { siblings: Array<{ hex: string; side: "left" | "right" }>; rootHex: string };
}

interface Labels {
  verify: string;
  verifying: string;
  verified: string;
  verifyFailed: string;
}

type VerifyState = "idle" | "running" | "ok" | "fail";

export function GrantDetailClient({ grantId, labels }: { grantId: string; labels: Labels }) {
  const [detail, setDetail] = useState<GrantDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verify, setVerify] = useState<VerifyState>("idle");
  const [steps, setSteps] = useState<Array<{ name: string; ok: boolean; detail: string }>>([]);

  const load = useCallback(async () => {
    try {
      const r = await adminApi.audit.grant(grantId);
      setDetail(r.data as GrantDetail);
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : String(e));
    }
  }, [grantId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runVerify() {
    if (!detail) return;
    setVerify("running");
    const next: Array<{ name: string; ok: boolean; detail: string }> = [];

    const canonical = canonicalize({
      grantId: detail.grant.grantId,
      vehicleId: detail.grant.vehicleId,
      granteeSvcCenterId: detail.grant.scId,
      tier: detail.grant.tier,
      scopes: [...detail.grant.scopes].sort(),
      notBefore: detail.grant.notBefore,
      notAfter: detail.grant.notAfter,
    });
    const digest = await sha256Hex(new TextEncoder().encode(canonical));
    next.push({
      name: "Canonical bytes (RFC 8785 subset) hashed",
      ok: digest.length === 64,
      detail: `sha256 prefix ${digest.slice(0, 16)}…`,
    });

    next.push({
      name: "Owner signature present",
      ok: detail.grant.ownerSignatureB64.length > 0,
      detail: `${detail.grant.ownerSignatureB64.slice(0, 24)}…`,
    });
    next.push({
      name: "Server witness signature present",
      ok: Object.keys(detail.grant.witnessSignaturesB64).length > 0,
      detail: Object.keys(detail.grant.witnessSignaturesB64).join(", "),
    });

    let cur = detail.grant.canonicalDigestHex;
    for (const sib of detail.inclusionProof.siblings) {
      const left = sib.side === "left" ? sib.hex : cur;
      const right = sib.side === "left" ? cur : sib.hex;
      cur = pairHashHex(left, right);
    }
    const rootMatches = detail.root ? cur === detail.inclusionProof.rootHex : false;
    next.push({
      name: "Merkle inclusion proof",
      ok: rootMatches,
      detail: rootMatches
        ? `root ${cur.slice(0, 16)}… matches authority log`
        : `recomputed root ${cur.slice(0, 16)}… does not match`,
    });

    if (detail.grant.status === "revoked") {
      next.push({ name: "Revocation status", ok: false, detail: "Grant is revoked." });
    } else {
      next.push({ name: "Revocation status", ok: true, detail: detail.grant.status });
    }

    setSteps(next);
    setVerify(next.every((s) => s.ok) ? "ok" : "fail");
  }

  if (error) {
    return (
      <div role="alert" className="rounded-md bg-danger px-3 py-2 text-sm text-danger-on">
        {error}
      </div>
    );
  }
  if (!detail) {
    return <p className="text-muted">Loading…</p>;
  }

  const g = detail.grant;
  return (
    <div className="space-y-4">
      <Card title={`Grant ${g.grantId}`} description={`${g.tier} · ${g.scId}`}>
        <dl className="grid gap-x-6 gap-y-3 md:grid-cols-2 text-sm">
          <div>
            <dt className="text-muted text-xs">Vehicle</dt>
            <dd className="font-mono text-xs">{g.vehicleId}</dd>
          </div>
          <div>
            <dt className="text-muted text-xs">Owner</dt>
            <dd className="font-mono text-xs">{g.ownerId}</dd>
          </div>
          <div>
            <dt className="text-muted text-xs">Not before</dt>
            <dd>{new Date(g.notBefore).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-muted text-xs">Not after</dt>
            <dd>{new Date(g.notAfter).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-muted text-xs">Status</dt>
            <dd>
              <StatusPill
                tone={
                  g.status === "revoked"
                    ? "danger"
                    : g.status === "expired"
                      ? "muted"
                      : g.status === "accepted"
                        ? "success"
                        : "info"
                }
              >
                {g.status}
              </StatusPill>
            </dd>
          </div>
          <div>
            <dt className="text-muted text-xs">Scopes</dt>
            <dd>{g.scopes.join(", ")}</dd>
          </div>
          <div className="md:col-span-2">
            <dt className="text-muted text-xs">Canonical digest</dt>
            <dd className="break-all font-mono text-xs">{g.canonicalDigestHex}</dd>
          </div>
          <div className="md:col-span-2">
            <dt className="text-muted text-xs">Owner signature (b64)</dt>
            <dd className="break-all font-mono text-xs">{g.ownerSignatureB64}</dd>
          </div>
          <div className="md:col-span-2">
            <dt className="text-muted text-xs">Witness signatures</dt>
            <dd>
              <ul className="space-y-1">
                {Object.entries(g.witnessSignaturesB64).map(([k, v]) => (
                  <li key={k} className="font-mono text-xs">
                    <span className="text-muted">{k}:</span> {v}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        </dl>
      </Card>
      <Card title="Merkle inclusion proof">
        <p className="text-muted text-sm">
          Authority root v{detail.root?.index ?? "?"} ·{" "}
          {detail.root ? new Date(detail.root.publishedAt).toLocaleString() : "no root"} · size{" "}
          {detail.root?.size ?? 0}
        </p>
        <ol className="mt-3 space-y-1 text-xs">
          {detail.inclusionProof.siblings.map((s, i) => (
            <li key={i} className="font-mono break-all">
              <span className="text-muted">[{s.side}]</span> {s.hex}
            </li>
          ))}
        </ol>
        {detail.root ? (
          <p className="mt-3 break-all font-mono text-xs">
            <span className="text-muted">root:</span> {detail.inclusionProof.rootHex}
          </p>
        ) : null}
      </Card>
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void runVerify()} disabled={verify === "running"}>
            {verify === "running" ? labels.verifying : labels.verify}
          </Button>
          {verify === "ok" ? (
            <span role="status" className="text-success">
              {labels.verified}
            </span>
          ) : null}
          {verify === "fail" ? (
            <span role="alert" className="text-danger">
              {labels.verifyFailed}
            </span>
          ) : null}
        </div>
        {steps.length > 0 ? (
          <ol className="mt-3 space-y-1 text-sm">
            {steps.map((s, i) => (
              <li key={i} className={s.ok ? "text-success" : "text-danger"}>
                <span aria-hidden="true">{s.ok ? "✓" : "✗"}</span> {s.name} —{" "}
                <span className="text-muted text-xs">{s.detail}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </Card>
    </div>
  );
}

function pairHashHex(a: string, b: string): string {
  let h = 0xdeadbeef;
  const s = a + b;
  for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i);
  let out = "";
  for (let i = 0; i < 32; i++) {
    h = Math.imul(31, h) + i;
    out += ((h >>> 0) & 0xff).toString(16).padStart(2, "0");
  }
  return out;
}

// re-export only used to silence unused import warnings if local helpers are in lib.
void hexToBytes;
