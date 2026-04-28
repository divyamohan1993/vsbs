"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { adminApi, AdminApiError } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusPill } from "@/components/ui/StatusPill";

interface Grant {
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
  status: "minted" | "accepted" | "revoked" | "expired";
}

interface Labels {
  search: string;
}

const STATUS_TONE: Record<Grant["status"], "success" | "warn" | "info" | "muted" | "danger"> = {
  minted: "info",
  accepted: "success",
  revoked: "danger",
  expired: "muted",
};

export function AuditListClient({ labels, locale }: { labels: Labels; locale: string }) {
  const [rows, setRows] = useState<Grant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState<string>("");
  const [status, setStatus] = useState<string>("");

  const load = useCallback(async () => {
    try {
      const filter: Record<string, string | undefined> = {};
      if (q) filter.q = q;
      if (status) filter.status = status;
      const r = await adminApi.audit.grants(filter);
      setRows(r.data as Grant[]);
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : String(e));
    }
  }, [q, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: Column<Grant>[] = [
    {
      id: "grantId",
      header: "Grant",
      sortable: true,
      sortBy: (r) => r.grantId,
      cell: (r) => (
        <Link
          href={`/${locale}/audit/${encodeURIComponent(r.grantId)}` as never}
          className="text-accent underline"
        >
          {r.grantId}
        </Link>
      ),
    },
    { id: "vehicle", header: "Vehicle", sortable: true, sortBy: (r) => r.vehicleId, cell: (r) => <code className="font-mono text-xs">{r.vehicleId}</code> },
    { id: "owner", header: "Owner", sortable: true, sortBy: (r) => r.ownerId, cell: (r) => <code className="font-mono text-xs">{r.ownerId}</code> },
    { id: "tier", header: "Tier", sortable: true, sortBy: (r) => r.tier, cell: (r) => r.tier },
    { id: "scopes", header: "Scopes", cell: (r) => <span className="text-muted text-xs">{r.scopes.join(", ")}</span> },
    {
      id: "status",
      header: "Status",
      sortable: true,
      sortBy: (r) => r.status,
      cell: (r) => <StatusPill tone={STATUS_TONE[r.status]}>{r.status}</StatusPill>,
    },
    { id: "merkle", header: "Merkle idx", sortable: true, sortBy: (r) => r.merkleIndex, align: "right", cell: (r) => r.merkleIndex },
    { id: "root", header: "Root idx", sortable: true, sortBy: (r) => r.rootIndex, align: "right", cell: (r) => r.rootIndex },
  ];

  return (
    <Card
      actions={
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void load();
          }}
          className="flex flex-wrap items-end gap-2"
          aria-label={labels.search}
        >
          <label className="flex flex-col text-xs">
            <span className="text-muted">{labels.search}</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="mt-1 rounded-md border border-[var(--color-border)] bg-surface px-2 py-1"
            />
          </label>
          <label className="flex flex-col text-xs">
            <span className="text-muted">Status</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="mt-1 rounded-md border border-[var(--color-border)] bg-surface px-2 py-1"
              aria-label="Status"
            >
              <option value="">All</option>
              <option value="minted">minted</option>
              <option value="accepted">accepted</option>
              <option value="revoked">revoked</option>
              <option value="expired">expired</option>
            </select>
          </label>
          <Button type="submit">Search</Button>
        </form>
      }
    >
      {error ? (
        <div role="alert" className="mb-3 rounded-md bg-danger px-3 py-2 text-sm text-danger-on">
          {error}
        </div>
      ) : null}
      <DataTable<Grant>
        caption="Command grants"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.grantId}
        emptyState="No grants match."
      />
    </Card>
  );
}
