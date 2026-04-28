"use client";

import { useCallback, useEffect, useState } from "react";

import { adminApi, AdminApiError } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";

interface Route {
  routeId: string;
  technicianId: string;
  scId: string;
  pickups: string[];
  currentEtaMinutes: number;
  optimisedEtaMinutes: number;
  lastSolvedAt: string;
}

interface Labels {
  rerun: string;
  currentEta: string;
  newEta: string;
  override: string;
  submit: string;
}

export function RoutingClient({ labels }: { labels: Labels }) {
  const [rows, setRows] = useState<Route[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<readonly string[]>([]);
  const [overrideForm, setOverrideForm] = useState<{ routeId: string; technicianId: string; reason: string }>({
    routeId: "",
    technicianId: "",
    reason: "",
  });

  const load = useCallback(async () => {
    try {
      const r = await adminApi.routing.list();
      setRows(r.data as Route[]);
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function rerun() {
    try {
      const ids = selection.length > 0 ? Array.from(selection) : rows.map((r) => r.routeId);
      await adminApi.routing.rerun(ids);
      await load();
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : String(e));
    }
  }

  async function applyOverride() {
    if (!overrideForm.routeId || !overrideForm.reason) return;
    try {
      const body: Parameters<typeof adminApi.routing.override>[0] = {
        routeId: overrideForm.routeId,
        reason: overrideForm.reason,
      };
      if (overrideForm.technicianId) body.technicianId = overrideForm.technicianId;
      await adminApi.routing.override(body);
      setOverrideForm({ routeId: "", technicianId: "", reason: "" });
      await load();
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : String(e));
    }
  }

  const columns: Column<Route>[] = [
    {
      id: "routeId",
      header: "Route",
      sortable: true,
      sortBy: (r) => r.routeId,
      cell: (r) => <code className="font-mono text-xs">{r.routeId}</code>,
    },
    { id: "tech", header: "Technician", sortable: true, sortBy: (r) => r.technicianId, cell: (r) => r.technicianId },
    { id: "sc", header: "SC", sortable: true, sortBy: (r) => r.scId, cell: (r) => r.scId },
    {
      id: "pickups",
      header: "Pickups",
      cell: (r) => (
        <span className="text-muted font-mono text-xs">{r.pickups.join(", ")}</span>
      ),
    },
    {
      id: "current",
      header: labels.currentEta,
      sortable: true,
      sortBy: (r) => r.currentEtaMinutes,
      align: "right",
      cell: (r) => `${r.currentEtaMinutes} min`,
    },
    {
      id: "new",
      header: labels.newEta,
      sortable: true,
      sortBy: (r) => r.optimisedEtaMinutes,
      align: "right",
      cell: (r) => `${r.optimisedEtaMinutes} min`,
    },
    {
      id: "solved",
      header: "Solved at",
      sortable: true,
      sortBy: (r) => r.lastSolvedAt,
      cell: (r) => new Date(r.lastSolvedAt).toLocaleTimeString(),
    },
  ];

  return (
    <div className="space-y-4">
      <Card title="Active routes" actions={<Button onClick={() => void rerun()}>{labels.rerun}</Button>}>
        {error ? (
          <div role="alert" className="mb-3 rounded-md bg-danger px-3 py-2 text-sm text-danger-on">
            {error}
          </div>
        ) : null}
        <DataTable<Route>
          caption="Active routes"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.routeId}
          emptyState="No active routes."
          selectable
          onSelectionChange={setSelection}
        />
      </Card>
      <Card title={labels.override}>
        <form
          aria-label={labels.override}
          onSubmit={(e) => {
            e.preventDefault();
            void applyOverride();
          }}
          className="grid gap-3 md:grid-cols-4"
        >
          <label className="flex flex-col text-xs">
            <span className="text-muted">Route</span>
            <select
              value={overrideForm.routeId}
              onChange={(e) => setOverrideForm((f) => ({ ...f, routeId: e.target.value }))}
              className="mt-1 rounded-md border border-[var(--color-border)] bg-surface px-2 py-1"
              required
            >
              <option value="">Select route</option>
              {rows.map((r) => (
                <option key={r.routeId} value={r.routeId}>
                  {r.routeId}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-xs">
            <span className="text-muted">Technician (optional)</span>
            <input
              value={overrideForm.technicianId}
              onChange={(e) => setOverrideForm((f) => ({ ...f, technicianId: e.target.value }))}
              className="mt-1 rounded-md border border-[var(--color-border)] bg-surface px-2 py-1"
            />
          </label>
          <label className="flex flex-col text-xs md:col-span-2">
            <span className="text-muted">Reason</span>
            <input
              value={overrideForm.reason}
              onChange={(e) => setOverrideForm((f) => ({ ...f, reason: e.target.value }))}
              className="mt-1 rounded-md border border-[var(--color-border)] bg-surface px-2 py-1"
              required
            />
          </label>
          <div className="md:col-span-4">
            <Button type="submit" variant="primary">
              {labels.submit}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
