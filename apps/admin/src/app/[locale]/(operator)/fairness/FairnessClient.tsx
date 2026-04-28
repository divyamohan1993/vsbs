"use client";

import { useEffect, useState } from "react";

import { adminApi, AdminApiError } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";

interface FairnessRow {
  region: string;
  cohort: string;
  totalBookings: number;
  modeMix: Record<string, number>;
  meanWaitMinutes: number;
  p95WaitMinutes: number;
  complaintRate: number;
}

interface Labels {
  byCohort: string;
  waitDist: string;
  complaintRate: string;
}

export function FairnessClient({ labels }: { labels: Labels }) {
  const [rows, setRows] = useState<FairnessRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function go() {
      try {
        const r = await adminApi.fairness.metrics();
        if (!cancelled) setRows(r.data as FairnessRow[]);
      } catch (e) {
        if (!cancelled) setError(e instanceof AdminApiError ? e.message : String(e));
      }
    }
    void go();
    return () => {
      cancelled = true;
    };
  }, []);

  const columns: Column<FairnessRow>[] = [
    { id: "region", header: "Region", sortable: true, sortBy: (r) => r.region, cell: (r) => r.region },
    { id: "cohort", header: "Cohort", sortable: true, sortBy: (r) => r.cohort, cell: (r) => r.cohort },
    { id: "total", header: "Bookings", sortable: true, sortBy: (r) => r.totalBookings, align: "right", cell: (r) => r.totalBookings },
    {
      id: "mix",
      header: "Mode mix",
      cell: (r) => (
        <span className="text-muted font-mono text-xs">
          {Object.entries(r.modeMix)
            .map(([m, c]) => `${m}:${c}`)
            .join(" · ")}
        </span>
      ),
    },
    { id: "mean", header: "Mean wait (min)", sortable: true, sortBy: (r) => r.meanWaitMinutes, align: "right", cell: (r) => r.meanWaitMinutes },
    { id: "p95", header: "p95 wait (min)", sortable: true, sortBy: (r) => r.p95WaitMinutes, align: "right", cell: (r) => r.p95WaitMinutes },
    {
      id: "complaint",
      header: labels.complaintRate,
      sortable: true,
      sortBy: (r) => r.complaintRate,
      align: "right",
      cell: (r) => `${(r.complaintRate * 100).toFixed(2)}%`,
    },
  ];

  return (
    <Card title={labels.byCohort} description={labels.waitDist}>
      {error ? (
        <div role="alert" className="mb-3 rounded-md bg-danger px-3 py-2 text-sm text-danger-on">
          {error}
        </div>
      ) : null}
      <DataTable<FairnessRow>
        caption="Fairness metrics by region and cohort"
        columns={columns}
        rows={rows}
        rowKey={(r) => `${r.region}-${r.cohort}`}
        emptyState="No fairness data available."
      />
    </Card>
  );
}
