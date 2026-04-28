"use client";

import { useCallback, useEffect, useState } from "react";

import { adminApi, AdminApiError } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";

interface Slot {
  slotId: string;
  scId: string;
  dayOfWeek: number;
  start: string;
  end: string;
  capacity: number;
  mode: string;
}

interface Labels {
  create: string;
  save: string;
  delete: string;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function SlotsClient({ labels }: { labels: Labels }) {
  const [rows, setRows] = useState<Slot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ scId: string; dayOfWeek: number; start: string; end: string; capacity: number; mode: string }>({
    scId: "sc-blr-01",
    dayOfWeek: 1,
    start: "09:00",
    end: "12:00",
    capacity: 4,
    mode: "drive-in",
  });

  const load = useCallback(async () => {
    try {
      const r = await adminApi.slots.list();
      setRows(r.data as Slot[]);
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    try {
      await adminApi.slots.upsert(draft);
      await load();
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : String(e));
    }
  }

  async function remove(id: string) {
    if (!window.confirm(`Delete slot ${id}?`)) return;
    try {
      await adminApi.slots.remove(id);
      await load();
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : String(e));
    }
  }

  const columns: Column<Slot>[] = [
    { id: "slotId", header: "Slot ID", sortable: true, sortBy: (r) => r.slotId, cell: (r) => <code className="font-mono text-xs">{r.slotId}</code> },
    { id: "scId", header: "SC", sortable: true, sortBy: (r) => r.scId, cell: (r) => r.scId },
    { id: "day", header: "Day", sortable: true, sortBy: (r) => r.dayOfWeek, cell: (r) => DAYS[r.dayOfWeek] ?? "?" },
    { id: "start", header: "Start", sortable: true, sortBy: (r) => r.start, cell: (r) => r.start },
    { id: "end", header: "End", sortable: true, sortBy: (r) => r.end, cell: (r) => r.end },
    { id: "capacity", header: "Capacity", sortable: true, sortBy: (r) => r.capacity, align: "right", cell: (r) => r.capacity },
    { id: "mode", header: "Mode", sortable: true, sortBy: (r) => r.mode, cell: (r) => r.mode },
    {
      id: "actions",
      header: "Actions",
      cell: (r) => (
        <Button variant="danger" onClick={() => void remove(r.slotId)}>
          {labels.delete}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <Card title={labels.create}>
        <form
          aria-label={labels.create}
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
          className="grid gap-3 md:grid-cols-6"
        >
          <label className="flex flex-col text-xs">
            <span className="text-muted">Service centre</span>
            <input
              value={draft.scId}
              onChange={(e) => setDraft((d) => ({ ...d, scId: e.target.value }))}
              required
              className="mt-1 rounded-md border border-[var(--color-border)] bg-surface px-2 py-1"
            />
          </label>
          <label className="flex flex-col text-xs">
            <span className="text-muted">Day</span>
            <select
              value={draft.dayOfWeek}
              onChange={(e) => setDraft((d) => ({ ...d, dayOfWeek: Number(e.target.value) }))}
              className="mt-1 rounded-md border border-[var(--color-border)] bg-surface px-2 py-1"
            >
              {DAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-xs">
            <span className="text-muted">Start</span>
            <input
              type="time"
              value={draft.start}
              onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value }))}
              required
              className="mt-1 rounded-md border border-[var(--color-border)] bg-surface px-2 py-1"
            />
          </label>
          <label className="flex flex-col text-xs">
            <span className="text-muted">End</span>
            <input
              type="time"
              value={draft.end}
              onChange={(e) => setDraft((d) => ({ ...d, end: e.target.value }))}
              required
              className="mt-1 rounded-md border border-[var(--color-border)] bg-surface px-2 py-1"
            />
          </label>
          <label className="flex flex-col text-xs">
            <span className="text-muted">Capacity</span>
            <input
              type="number"
              min={0}
              max={64}
              value={draft.capacity}
              onChange={(e) => setDraft((d) => ({ ...d, capacity: Number(e.target.value) }))}
              required
              className="mt-1 rounded-md border border-[var(--color-border)] bg-surface px-2 py-1"
            />
          </label>
          <label className="flex flex-col text-xs">
            <span className="text-muted">Mode</span>
            <select
              value={draft.mode}
              onChange={(e) => setDraft((d) => ({ ...d, mode: e.target.value }))}
              className="mt-1 rounded-md border border-[var(--color-border)] bg-surface px-2 py-1"
            >
              <option value="drive-in">drive-in</option>
              <option value="valet">valet</option>
              <option value="tow">tow</option>
              <option value="autonomous">autonomous</option>
            </select>
          </label>
          <div className="md:col-span-6">
            <Button type="submit" variant="primary">
              {labels.save}
            </Button>
          </div>
        </form>
      </Card>
      <Card title="Existing slots">
        {error ? (
          <div role="alert" className="mb-3 rounded-md bg-danger px-3 py-2 text-sm text-danger-on">
            {error}
          </div>
        ) : null}
        <DataTable<Slot>
          caption="Service centre slot definitions"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.slotId}
          emptyState="No slots defined."
        />
      </Card>
    </div>
  );
}
