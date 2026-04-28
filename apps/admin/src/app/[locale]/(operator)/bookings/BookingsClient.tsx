"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { adminApi, AdminApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusPill } from "@/components/ui/StatusPill";

interface Labels {
  filterStatus: string;
  filterRegion: string;
  filterFrom: string;
  filterTo: string;
  apply: string;
  reset: string;
  empty: string;
  stream: string;
  streamOff: string;
  colId: string;
  colStatus: string;
  colVehicle: string;
  colOwner: string;
  colEta: string;
  colDispatch: string;
  colWellbeing: string;
  colSafety: string;
  actionReassign: string;
  actionCancel: string;
  actionEscalate: string;
}

interface Booking {
  id: string;
  status: "accepted" | "assigned" | "in_progress" | "at_bay" | "ready" | "cancelled" | "escalated";
  ownerHash: string;
  vehicle: { make: string; model: string; year: number; vin?: string };
  region: "asia-south1" | "us-central1";
  scId: string;
  technicianId: string | null;
  etaMinutes: number;
  dispatchMode: "drive-in" | "valet" | "tow" | "autonomous";
  wellbeing: number;
  safetyTier: "red" | "amber" | "green";
  createdAt: string;
  updatedAt: string;
}

const STATUS_TONE: Record<Booking["status"], "success" | "warn" | "info" | "muted" | "danger"> = {
  accepted: "info",
  assigned: "info",
  in_progress: "warn",
  at_bay: "warn",
  ready: "success",
  cancelled: "muted",
  escalated: "danger",
};

const SAFETY_TONE: Record<Booking["safetyTier"], "success" | "warn" | "danger"> = {
  green: "success",
  amber: "warn",
  red: "danger",
};

interface ApiResponse {
  data: Booking[];
  page?: { total: number; nextCursor: string | null; limit: number };
}

export function BookingsClient({ labels }: { labels: Labels }) {
  const [rows, setRows] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [filter, setFilter] = useState<{ status: string; region: string; from: string; to: string }>({
    status: "",
    region: "",
    from: "",
    to: "",
  });
  const [selection, setSelection] = useState<readonly string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q: Record<string, string | undefined> = {};
      if (filter.status) q.status = filter.status;
      if (filter.region) q.region = filter.region;
      if (filter.from) q.from = new Date(filter.from).toISOString();
      if (filter.to) q.to = new Date(filter.to).toISOString();
      const r = (await adminApi.bookings.list(q)) as unknown as ApiResponse;
      setRows(r.data);
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [filter.status, filter.region, filter.from, filter.to]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let aborted = false;
    let controller: AbortController | null = null;
    async function connect() {
      controller = new AbortController();
      try {
        const res = await fetch(adminApi.bookings.streamUrl(), {
          signal: controller.signal,
          credentials: "same-origin",
        });
        if (!res.ok || !res.body) {
          setStreaming(false);
          return;
        }
        setStreaming(true);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (!aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const record = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const dataLine = record.split("\n").find((l) => l.startsWith("data:"));
            const eventLine = record.split("\n").find((l) => l.startsWith("event:"));
            if (!dataLine) continue;
            const event = eventLine ? eventLine.slice(6).trim() : "message";
            try {
              const obj = JSON.parse(dataLine.slice(5).trim());
              if (event === "snapshot" || event === "update") {
                setRows((prev) => {
                  const next = prev.filter((b) => b.id !== obj.id);
                  return [obj as Booking, ...next].slice(0, 200);
                });
              }
            } catch {
              // Ignore malformed frames; stream stays open.
            }
          }
        }
      } catch {
        setStreaming(false);
      }
    }
    void connect();
    return () => {
      aborted = true;
      controller?.abort();
    };
  }, []);

  const columns = useMemo<Column<Booking>[]>(() => [
    {
      id: "id",
      header: labels.colId,
      sortable: true,
      sortBy: (r) => r.id,
      cell: (r) => <code className="font-mono text-xs">{r.id}</code>,
    },
    {
      id: "status",
      header: labels.colStatus,
      sortable: true,
      sortBy: (r) => r.status,
      cell: (r) => <StatusPill tone={STATUS_TONE[r.status]}>{r.status}</StatusPill>,
    },
    {
      id: "vehicle",
      header: labels.colVehicle,
      sortable: true,
      sortBy: (r) => `${r.vehicle.make} ${r.vehicle.model}`,
      cell: (r) => `${r.vehicle.year} ${r.vehicle.make} ${r.vehicle.model}`,
    },
    {
      id: "owner",
      header: labels.colOwner,
      sortable: false,
      cell: (r) => <code className="font-mono text-xs">{r.ownerHash}</code>,
    },
    {
      id: "eta",
      header: labels.colEta,
      sortable: true,
      sortBy: (r) => r.etaMinutes,
      align: "right",
      cell: (r) => r.etaMinutes,
    },
    {
      id: "dispatch",
      header: labels.colDispatch,
      sortable: true,
      sortBy: (r) => r.dispatchMode,
      cell: (r) => r.dispatchMode,
    },
    {
      id: "wellbeing",
      header: labels.colWellbeing,
      sortable: true,
      sortBy: (r) => r.wellbeing,
      align: "right",
      cell: (r) => r.wellbeing.toFixed(2),
    },
    {
      id: "safety",
      header: labels.colSafety,
      sortable: true,
      sortBy: (r) => r.safetyTier,
      cell: (r) => <StatusPill tone={SAFETY_TONE[r.safetyTier]}>{r.safetyTier}</StatusPill>,
    },
  ], [labels]);

  async function bulkAction(kind: "reassign" | "cancel" | "escalate") {
    const reason =
      typeof window !== "undefined"
        ? window.prompt(`Reason for ${kind}?`, `Operator ${kind} via admin console`)
        : null;
    if (!reason) return;
    try {
      for (const id of selection) {
        if (kind === "reassign") await adminApi.bookings.reassign(id, "tech-arun", reason);
        else if (kind === "cancel") await adminApi.bookings.cancel(id, reason);
        else await adminApi.bookings.escalate(id, reason);
      }
      await load();
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4">
      <Card
        title={
          <span className="flex items-center gap-2">
            <span aria-live="polite" className="text-muted text-xs">
              {streaming ? labels.stream : labels.streamOff}
            </span>
          </span>
        }
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col text-xs">
              <span className="text-muted">{labels.filterStatus}</span>
              <select
                aria-label={labels.filterStatus}
                value={filter.status}
                onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}
                className="mt-1 rounded-md border border-[var(--color-border)] bg-surface px-2 py-1"
              >
                <option value="">All</option>
                <option value="accepted">accepted</option>
                <option value="assigned">assigned</option>
                <option value="in_progress">in_progress</option>
                <option value="at_bay">at_bay</option>
                <option value="ready">ready</option>
                <option value="cancelled">cancelled</option>
                <option value="escalated">escalated</option>
              </select>
            </label>
            <label className="flex flex-col text-xs">
              <span className="text-muted">{labels.filterRegion}</span>
              <select
                aria-label={labels.filterRegion}
                value={filter.region}
                onChange={(e) => setFilter((f) => ({ ...f, region: e.target.value }))}
                className="mt-1 rounded-md border border-[var(--color-border)] bg-surface px-2 py-1"
              >
                <option value="">All</option>
                <option value="asia-south1">asia-south1</option>
                <option value="us-central1">us-central1</option>
              </select>
            </label>
            <label className="flex flex-col text-xs">
              <span className="text-muted">{labels.filterFrom}</span>
              <input
                type="datetime-local"
                aria-label={labels.filterFrom}
                value={filter.from}
                onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value }))}
                className="mt-1 rounded-md border border-[var(--color-border)] bg-surface px-2 py-1"
              />
            </label>
            <label className="flex flex-col text-xs">
              <span className="text-muted">{labels.filterTo}</span>
              <input
                type="datetime-local"
                aria-label={labels.filterTo}
                value={filter.to}
                onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value }))}
                className="mt-1 rounded-md border border-[var(--color-border)] bg-surface px-2 py-1"
              />
            </label>
            <Button onClick={() => void load()} variant="primary">
              {labels.apply}
            </Button>
            <Button
              onClick={() => {
                setFilter({ status: "", region: "", from: "", to: "" });
              }}
              variant="secondary"
            >
              {labels.reset}
            </Button>
          </div>
        }
      >
        {error ? (
          <div role="alert" className="mb-3 rounded-md bg-danger px-3 py-2 text-sm text-danger-on">
            {error}
          </div>
        ) : null}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            disabled={selection.length === 0}
            onClick={() => void bulkAction("reassign")}
          >
            {labels.actionReassign} ({selection.length})
          </Button>
          <Button
            variant="secondary"
            disabled={selection.length === 0}
            onClick={() => void bulkAction("cancel")}
          >
            {labels.actionCancel} ({selection.length})
          </Button>
          <Button
            variant="danger"
            disabled={selection.length === 0}
            onClick={() => void bulkAction("escalate")}
          >
            {labels.actionEscalate} ({selection.length})
          </Button>
        </div>
        <DataTable<Booking>
          caption="Active bookings"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          emptyState={loading ? "Loading..." : labels.empty}
          selectable
          onSelectionChange={setSelection}
        />
      </Card>
    </div>
  );
}
