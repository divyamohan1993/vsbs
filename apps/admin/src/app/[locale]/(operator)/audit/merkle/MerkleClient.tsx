"use client";

import { useCallback, useEffect, useState } from "react";

import { adminApi, AdminApiError } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";

interface Root {
  index: number;
  rootHashHex: string;
  size: number;
  publishedAt: string;
}

interface Labels {
  verify: string;
  verified: string;
  verifyFailed: string;
}

export function MerkleClient({ labels }: { labels: Labels }) {
  const [rows, setRows] = useState<Root[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<{ grantId: string; status: "idle" | "running" | "ok" | "fail"; message: string }>({
    grantId: "",
    status: "idle",
    message: "",
  });

  const load = useCallback(async () => {
    try {
      const r = await adminApi.audit.roots();
      setRows(r.data as Root[]);
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function verifyInclusion() {
    if (!check.grantId) return;
    setCheck((c) => ({ ...c, status: "running", message: "Resolving inclusion proof..." }));
    try {
      const r = await adminApi.audit.grant(check.grantId);
      const data = r.data;
      let cur = data.grant.canonicalDigestHex;
      for (const sib of data.inclusionProof.siblings) {
        const left = sib.side === "left" ? sib.hex : cur;
        const right = sib.side === "left" ? cur : sib.hex;
        cur = pairHashHex(left, right);
      }
      const ok = cur === data.inclusionProof.rootHex;
      setCheck((c) => ({
        ...c,
        status: ok ? "ok" : "fail",
        message: ok
          ? `${labels.verified} (root ${cur.slice(0, 16)}…)`
          : `${labels.verifyFailed} — recomputed ${cur.slice(0, 16)}… does not match root.`,
      }));
    } catch (e) {
      setCheck((c) => ({
        ...c,
        status: "fail",
        message: e instanceof AdminApiError ? e.message : String(e),
      }));
    }
  }

  const columns: Column<Root>[] = [
    { id: "idx", header: "Index", sortable: true, sortBy: (r) => r.index, align: "right", cell: (r) => r.index },
    { id: "size", header: "Size", sortable: true, sortBy: (r) => r.size, align: "right", cell: (r) => r.size },
    {
      id: "root",
      header: "Root hash",
      cell: (r) => <code className="break-all font-mono text-xs">{r.rootHashHex}</code>,
    },
    {
      id: "at",
      header: "Published at",
      sortable: true,
      sortBy: (r) => r.publishedAt,
      cell: (r) => new Date(r.publishedAt).toLocaleString(),
    },
  ];

  return (
    <div className="space-y-4">
      {error ? (
        <div role="alert" className="rounded-md bg-danger px-3 py-2 text-sm text-danger-on">
          {error}
        </div>
      ) : null}
      <Card title="Authority log roots">
        <DataTable<Root>
          caption="Published authority log roots"
          columns={columns}
          rows={rows}
          rowKey={(r) => String(r.index)}
          emptyState="No roots published."
        />
      </Card>
      <Card title="Verify a grant's inclusion">
        <form
          aria-label="Verify inclusion"
          onSubmit={(e) => {
            e.preventDefault();
            void verifyInclusion();
          }}
          className="flex flex-wrap items-end gap-2"
        >
          <label className="flex flex-col text-xs">
            <span className="text-muted">Grant ID</span>
            <input
              value={check.grantId}
              onChange={(e) => setCheck((c) => ({ ...c, grantId: e.target.value }))}
              className="mt-1 rounded-md border border-[var(--color-border)] bg-surface px-2 py-1"
              required
            />
          </label>
          <Button type="submit" disabled={check.status === "running"}>
            {labels.verify}
          </Button>
        </form>
        {check.status !== "idle" ? (
          <p
            role={check.status === "fail" ? "alert" : "status"}
            className={`mt-3 text-sm ${check.status === "ok" ? "text-success" : check.status === "fail" ? "text-danger" : "text-muted"}`}
          >
            {check.message}
          </p>
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
